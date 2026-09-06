package expo.modules.vescapecore.replay

import expo.modules.vescapecore.warnings.BoardWarningSeverity
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fault-injection scenarios on the replay harness (ADR 0024): decode-level transforms layered onto
 * the clean fixture's decoded frames — never byte mutation, never a second fixture. Fault windows
 * are anchored relative to the fixture's own first timestamp, so swapping the placeholder fixture
 * for a real recording keeps every scenario valid.
 *
 * @parity /modules/vescape-core/ios/replay/WarningReplayScenarioTests.swift
 */
class WarningReplayScenarioTest {
  private val jsonl =
    javaClass.classLoader!!.getResourceAsStream("fixtures/replay-synthetic-bms.jsonl")!!
      .bufferedReader().readText()

  /** The fixture's known cell-group count; scenario counts are chosen distinct from it. */
  private val fixtureSeries = 16

  /** First recorded timestamp — all fault windows anchor relative to this, not absolute ms. */
  private val t0 = ReplayChunkDecoder.bmsFrames(jsonl).first().capturedAt

  private fun window(startMs: Long, endMs: Long) = (t0 + startMs)..(t0 + endMs)

  /** Lift one cell group by [deltaV] inside [range] — the canonical spread fault. */
  private fun spread(range: LongRange, group: Int, deltaV: Double) =
    { bms: expo.modules.vescapecore.protocol.BmsTelemetry, t: Long ->
      if (t in range) {
        bms.copy(
          cellVoltages = bms.cellVoltages.mapIndexed { i, v -> if (i == group) v + deltaV else v },
        )
      } else {
        bms
      }
    }

  @Test
  fun sustainedSpreadFiresWarnWithWorstGroup() {
    val result = WarningReplayHarness.run(
      jsonl, configuredSeries = fixtureSeries,
      transform = spread(window(10_000, 20_000), group = 3, deltaV = 0.30),
    )
    assertTrue("fault window produced no findings", result.cellSpreadFindings.isNotEmpty())
    assertTrue(result.cellSpreadFindings.all { it.severity == BoardWarningSeverity.WARN })
    val payload = JSONObject(result.cellSpreadFindings.last().payloadJson)
    assertTrue(payload.getDouble("peakSpread") >= 0.30)
    assertEquals(3, payload.getInt("worstGroup"))
    assertFalse(payload.getBoolean("charging"))
    assertFalse(result.cellSpreadSessionEndClean)
    assertTrue(result.mismatchFindings.isEmpty())
  }

  @Test
  fun spreadGrowingPastCriticalEscalatesAndPeakIsMonotonic() {
    val warn = spread(window(10_000, 20_000), group = 3, deltaV = 0.30)
    val critical = spread(window(40_000, 50_000), group = 3, deltaV = 0.60)
    val result = WarningReplayHarness.run(
      jsonl, configuredSeries = fixtureSeries,
      transform = { bms, t -> critical(warn(bms, t), t) },
    )
    assertTrue(result.cellSpreadFindings.size >= 2)
    assertEquals(BoardWarningSeverity.WARN, result.cellSpreadFindings.first().severity)
    assertEquals(BoardWarningSeverity.CRITICAL, result.cellSpreadFindings.last().severity)
    // Severity is monotonic: once critical, no later finding may downgrade back to warn.
    val firstCritical = result.cellSpreadFindings.indexOfFirst { it.severity == BoardWarningSeverity.CRITICAL }
    assertTrue(
      result.cellSpreadFindings.drop(firstCritical).all { it.severity == BoardWarningSeverity.CRITICAL },
    )
    val peaks = result.cellSpreadFindings.map { JSONObject(it.payloadJson).getDouble("peakSpread") }
    assertTrue("peak must only rise", peaks.zipWithNext().all { (a, b) -> b >= a })
    assertTrue(peaks.last() >= 0.60)
  }

  @Test
  fun singleFrameSpikeNeverFires() {
    var spiked = false
    val result = WarningReplayHarness.run(
      jsonl, configuredSeries = fixtureSeries,
      transform = { bms, t ->
        if (!spiked && t >= t0 + 10_000) {
          spiked = true
          bms.copy(cellVoltages = bms.cellVoltages.mapIndexed { i, v -> if (i == 3) v + 0.6 else v })
        } else {
          bms
        }
      },
    )
    assertTrue("spike was never injected", spiked)
    assertEquals(emptyList<Any>(), result.cellSpreadFindings)
    assertTrue(result.cellSpreadSessionEndClean)
  }

  @Test
  fun configMismatchFiresOnceAfterStableFrames() {
    // 18 BMS groups vs 15 configured — both distinct from the fixture's 16. Padding repeats the
    // frame's own last group value so the spread detector sees an unchanged spread.
    val result = WarningReplayHarness.run(
      jsonl, configuredSeries = 15,
      transform = { bms, _ ->
        bms.copy(
          cellVoltages = bms.cellVoltages + List(2) { bms.cellVoltages.last() },
          balancing = bms.balancing + List(2) { false },
        )
      },
    )
    assertEquals(1, result.mismatchFindings.size)
    val payload = JSONObject(result.mismatchFindings.single())
    assertEquals(18, payload.getInt("bmsCellCount"))
    assertEquals(15, payload.getInt("configuredSeries"))
    assertFalse(result.mismatchSessionEndClean)
    assertTrue(result.cellSpreadFindings.isEmpty())
  }

  @Test
  fun flappingCellCountNeverFires() {
    var frameIndex = 0
    val result = WarningReplayHarness.run(
      jsonl, configuredSeries = 15,
      transform = { bms, _ ->
        // Alternate 16/15 groups every frame — the count is never stable for 3 consecutive frames.
        (frameIndex++).let { i ->
          if (i % 2 == 0) bms else bms.copy(cellVoltages = bms.cellVoltages.dropLast(1))
        }
      },
    )
    assertEquals(emptyList<String>(), result.mismatchFindings)
    // Never stable means never evaluated — not a clean pass that would clear a stored warning.
    assertFalse(result.mismatchSessionEndClean)
  }

  @Test
  fun chargingSpreadRecordsChargingContext() {
    val range = window(10_000, 20_000)
    val liftGroup = spread(range, group = 3, deltaV = 0.30)
    val result = WarningReplayHarness.run(
      jsonl, configuredSeries = fixtureSeries,
      transform = { bms, t -> liftGroup(bms, t).let { if (t in range) it.copy(vCharge = 42.0) else it } },
    )
    assertTrue(result.cellSpreadFindings.isNotEmpty())
    val payload = JSONObject(result.cellSpreadFindings.last().payloadJson)
    assertTrue(payload.getBoolean("charging"))
    assertEquals(3, payload.getInt("worstGroup"))
  }
}
