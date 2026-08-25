package expo.modules.vescapecore.replay

import expo.modules.vescapecore.config.BoardConfigFreshness
import expo.modules.vescapecore.warnings.BoardWarningKind
import expo.modules.vescapecore.warnings.ConfigSafetyDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Config-scoped replay guard (ADR 0024): reconstruct Thor301's real Refloat config read through the
 * live ConfigRW FSM + decoder and assert (1) the byte→schema→decode pipeline yields its known values
 * from the recorded bytes, and (2) the config-safety detector surfaces the board's genuinely-unsafe
 * settings on real data. This is the config-scoped analogue of the BMS clean-run test: a real-data
 * guard for the config Board Warnings, not a re-test of the detector's pure rules.
 *
 * @parity /modules/vescape-core/ios/replay/ConfigReplayHarnessTests.swift
 */
class ConfigReplayHarnessTest {
  private val jsonl =
    javaClass.classLoader!!.getResourceAsStream("fixtures/replay-thor301.jsonl")!!
      .bufferedReader().readText()

  @Test
  fun realRecordingDecodesKnownSafetyValues() {
    val values = ConfigReplayHarness.decodeBoardConfigValues(jsonl)
    assertNotNull("config read must decode from the real recording", values)
    values!!
    assertEquals(2.0, values.number("fault_adc1")!!, 1e-9)
    assertEquals(2.0, values.number("fault_adc2")!!, 1e-9)
    assertEquals(62.0, values.number("tiltback_lv")!!, 1e-9)
    assertEquals(86.0, values.number("tiltback_hv")!!, 1e-9)
    assertEquals(1.0, values.number("tiltback_duty")!!, 1e-9)
    // Schema does not carry the moving-fault flag -> the rule is skipped, never guessed.
    // The schema types this id as a number, so it is not a Boolean the rule can read: the rule stays
    // skipped rather than guessing from a numeric value.
    assertNull(values.bool("fault_moving_fault_disabled"))
    // The read retains its own write base and is fresh; the decoded map spans the whole schema, not
    // just the curated tune groups.
    assertEquals(BoardConfigFreshness.FRESH, values.freshness)
    assertNotNull(values.writeBase)
    assertTrue(values.values.size > 6)
  }

  // Thor301 runs 20s pack-mode Refloat: the tiltback voltages are pack totals, not per-cell.
  @Test
  fun realConfigSurfacesUnsafeDutyPushback() {
    val values = ConfigReplayHarness.decodeBoardConfigValues(jsonl)!!
    val report = ConfigSafetyDetector.evaluate(values, seriesCount = 20, perCell = false)
    // Duty pushback recorded at 1.0 (100%) — a genuinely unsafe setting on the real board.
    assertTrue(report.findings.any { it.kind == BoardWarningKind.DUTY_PUSHBACK_HIGH })
    // Footpad configured (ADC != 0) and LV pushback above the floor -> those rules evaluate clean.
    assertTrue(BoardWarningKind.FOOTPAD_DISABLED in report.cleanKinds)
    assertTrue(BoardWarningKind.LV_PUSHBACK_LOW in report.cleanKinds)
  }
}
