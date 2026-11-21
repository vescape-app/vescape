package expo.modules.vescapecore.replay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/replay/WarningReplayHarnessTests.swift
 */
class WarningReplayCleanRunTest {
  private val jsonl =
    javaClass.classLoader!!.getResourceAsStream("fixtures/replay-synthetic-bms.jsonl")!!
      .bufferedReader().readText()

  private val fixtureSeries = 16

  @Test
  fun decoderYieldsOrderedBmsFramesFromRxChunksOnly() {
    val frames = ReplayChunkDecoder.bmsFrames(jsonl)
    assertTrue("fixture yielded zero BMS frames", frames.isNotEmpty())
    assertEquals(fixtureSeries, frames.first().cellVoltages.size)
    assertEquals(480, frames.size)
    assertEquals(250L, frames.first().capturedAt)
    assertEquals(120_000L, frames.last().capturedAt)
    assertTrue(frames.zipWithNext().all { (a, b) -> b.capturedAt - a.capturedAt == 250L })
  }

  @Test
  fun cleanFixtureProducesZeroFindingsAndCleanSessionEnd() {
    val result = WarningReplayHarness.run(jsonl, configuredSeries = fixtureSeries)
    assertTrue("fixture yielded zero BMS frames", result.frameCount > 0)
    assertEquals(emptyList<Any>(), result.cellSpreadFindings)
    assertEquals(emptyList<String>(), result.mismatchFindings)
    assertTrue(result.cellSpreadSessionEndClean)
    assertTrue(result.mismatchSessionEndClean)
  }
}
