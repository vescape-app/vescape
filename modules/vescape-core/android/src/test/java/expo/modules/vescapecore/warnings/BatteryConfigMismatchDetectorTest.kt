package expo.modules.vescapecore.warnings

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/warnings/BatteryConfigMismatchDetectorTests.swift
 */
class BatteryConfigMismatchDetectorTest {

  private fun assertPayload(payloadJson: String?, bmsCellCount: Int, configuredSeries: Int) {
    assertNotNull(payloadJson)
    val json = JSONObject(payloadJson!!)
    assertEquals(bmsCellCount, json.getInt("bmsCellCount"))
    assertEquals(configuredSeries, json.getInt("configuredSeries"))
  }

  @Test
  fun stableMismatchFiresOneWarnWithBothCounts() {
    val detector = BatteryConfigMismatchDetector()
    assertNull(detector.onFrame(18, 15))
    assertNull(detector.onFrame(18, 15))
    assertPayload(detector.onFrame(18, 15), bmsCellCount = 18, configuredSeries = 15)
    assertNull(detector.onFrame(18, 15))
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun liveConfigChangeReReportsWithNewSeries() {
    val detector = BatteryConfigMismatchDetector()
    repeat(2) { assertNull(detector.onFrame(18, 15)) }
    assertPayload(detector.onFrame(18, 15), bmsCellCount = 18, configuredSeries = 15)
    assertPayload(detector.onFrame(18, 16), bmsCellCount = 18, configuredSeries = 16)
    assertNull(detector.onFrame(18, 16))
  }

  @Test
  fun singleOddFrameDoesNotFire() {
    val detector = BatteryConfigMismatchDetector()
    assertNull(detector.onFrame(15, 15))
    assertNull(detector.onFrame(18, 15))
    assertNull(detector.onFrame(15, 15))
    assertNull(detector.onFrame(15, 15))
    assertNull(detector.onFrame(15, 15))
    assertTrue(detector.sessionEndClean())
  }

  @Test
  fun stableMatchIsCleanEvaluation() {
    val detector = BatteryConfigMismatchDetector()
    repeat(4) { assertNull(detector.onFrame(15, 15)) }
    assertTrue(detector.sessionEndClean())
  }

  @Test
  fun noBmsDataIsNotClean() {
    val detector = BatteryConfigMismatchDetector()
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun noConfiguredSeriesIsNotClean() {
    val detector = BatteryConfigMismatchDetector()
    repeat(4) { assertNull(detector.onFrame(18, null)) }
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun zeroBmsCountIgnored() {
    val detector = BatteryConfigMismatchDetector()
    repeat(4) { assertNull(detector.onFrame(0, 15)) }
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun resetClearsState() {
    val detector = BatteryConfigMismatchDetector()
    repeat(3) { detector.onFrame(18, 15) }
    assertFalse(detector.sessionEndClean())
    detector.reset()
    assertFalse(detector.sessionEndClean())
    repeat(3) { assertNull(detector.onFrame(15, 15)) }
    assertTrue(detector.sessionEndClean())
  }
}
