package expo.modules.vescapecore.replay

import expo.modules.vescapecore.config.BoardConfigFreshness
import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.REFLOAT_LIGHTS_CONTROL
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.warnings.BoardWarningKind
import expo.modules.vescapecore.warnings.ConfigSafetyDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
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
    assertEquals(true, values.bool("fault_moving_fault_disabled"))
    assertEquals(BoardConfigFreshness.FRESH, values.freshness)
    assertNotNull(values.writeBase)
    assertTrue(values.values.size > 6)
  }

  @Test
  fun realConfigSurfacesUnsafeDutyPushback() {
    val values = ConfigReplayHarness.decodeBoardConfigValues(jsonl)!!
    val report = ConfigSafetyDetector.evaluate(values, seriesCount = 20, perCell = false)
    assertTrue(report.findings.any { it.kind == BoardWarningKind.DUTY_PUSHBACK_HIGH })
    assertTrue(BoardWarningKind.FOOTPAD_DISABLED in report.cleanKinds)
    assertTrue(BoardWarningKind.LV_PUSHBACK_LOW in report.cleanKinds)
  }

  @Test
  fun replayRoutesTelemetryAndLightsDuringInFlightConfigRead() {
    val lightsEcho = byteArrayOf(
      COMM_CUSTOM_APP_DATA.toByte(),
      REFLOAT_MAGIC.toByte(),
      REFLOAT_LIGHTS_CONTROL.toByte(),
      3,
    )
    val result = ConfigReplayHarness.replayRouting(jsonl, injectedDuringInFlight = listOf(lightsEcho))

    assertNotNull(result.values)
    assertTrue("recorded telemetry must still reach its handler while config read is in flight", result.telemetryCountDuringInFlight > 0)
    assertEquals(listOf(BoardLightsState(enabled = true, headlightsEnabled = true)), result.lightsDuringInFlight)
  }
}
