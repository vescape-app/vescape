package expo.modules.vescapecore.warnings

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cell-spread detector behavior: sustain gating (transient spikes never fire), warn/critical tiers on
 * the peak spread, charging/balancing payload context, peak tracking through re-reports, worst-group
 * selection, and the session-end clean-evaluation contract. Payload assertions decode the JSON (its
 * key order is serializer-dependent) and check each field, rather than matching an exact string.
 * @parity /modules/vescape-core/ios/warnings/CellSpreadDetectorTests.swift
 */
class CellSpreadDetectorTest {
  private val noBalance = listOf(false, false)

  @Test
  fun singleFrameSpikeDoesNotFire() {
    val detector = CellSpreadDetector()
    // One frame well over threshold, then it drops — a transient spike must never fire.
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L))
    assertNull(detector.onFrame(listOf(3.90, 3.91), noBalance, 0.0, 100L))
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 5_000L))
  }

  @Test
  fun sustainedSpreadFiresWarnWithPayload() {
    val detector = CellSpreadDetector()
    // Spread 0.24 V: over warn (0.20), under critical (0.50).
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L))
    val finding = detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 3_000L)
    assertNotNull(finding)
    assertEquals(BoardWarningSeverity.WARN, finding!!.severity)
    val payload = JSONObject(finding.payloadJson)
    assertEquals(0.24, payload.getDouble("peakSpread"), 0.0)
    assertEquals(0, payload.getInt("worstGroup"))
    assertFalse(payload.getBoolean("charging"))
    assertFalse(payload.getBoolean("balancing"))
  }

  @Test
  fun sustainedSpreadOverCriticalFiresCritical() {
    val detector = CellSpreadDetector()
    // Spread 0.58 V: over critical (0.50).
    assertNull(detector.onFrame(listOf(3.40, 3.98), noBalance, 0.0, 0L))
    val finding = detector.onFrame(listOf(3.40, 3.98), noBalance, 0.0, 3_000L)
    assertNotNull(finding)
    assertEquals(BoardWarningSeverity.CRITICAL, finding!!.severity)
  }

  @Test
  fun payloadRecordsChargingAndBalancingContext() {
    val detector = CellSpreadDetector()
    val balancing = listOf(false, true)
    assertNull(detector.onFrame(listOf(3.80, 4.04), balancing, 55.0, 0L))
    val finding = detector.onFrame(listOf(3.80, 4.04), balancing, 55.0, 3_000L)
    assertNotNull(finding)
    val payload = JSONObject(finding!!.payloadJson)
    assertEquals(0.24, payload.getDouble("peakSpread"), 0.0)
    assertEquals(0, payload.getInt("worstGroup"))
    assertTrue(payload.getBoolean("charging"))
    assertTrue(payload.getBoolean("balancing"))
  }

  @Test
  fun chargeDetectionMirrorsThreshold() {
    val detector = CellSpreadDetector()
    // vCharge just under the 10 V floor is not charging.
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 9.5, 0L))
    val finding = detector.onFrame(listOf(3.80, 4.04), noBalance, 9.5, 3_000L)
    assertFalse(JSONObject(finding!!.payloadJson).getBoolean("charging"))
  }

  @Test
  fun risingPeakReReportsAboveEpsilonOnly() {
    val detector = CellSpreadDetector()
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L))
    val first = detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 3_000L)
    assertNotNull(first)
    assertEquals(0.24, JSONObject(first!!.payloadJson).getDouble("peakSpread"), 0.0)

    // Peak climbs to 0.32 V (still warn): re-report with the new peak.
    val second = detector.onFrame(listOf(3.80, 4.12), noBalance, 0.0, 3_100L)
    assertNotNull(second)
    assertEquals(0.32, JSONObject(second!!.payloadJson).getDouble("peakSpread"), 0.0)

    // A 2 mV further climb is below the report epsilon (5 mV): nothing new.
    assertNull(detector.onFrame(listOf(3.80, 4.122), noBalance, 0.0, 3_200L))
  }

  @Test
  fun escalatesWarnToCritical() {
    val detector = CellSpreadDetector()
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L))
    val warn = detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 3_000L)
    assertEquals(BoardWarningSeverity.WARN, warn!!.severity)

    val critical = detector.onFrame(listOf(3.40, 3.98), noBalance, 0.0, 3_100L)
    assertNotNull(critical)
    assertEquals(BoardWarningSeverity.CRITICAL, critical!!.severity)
  }

  @Test
  fun worstGroupIsFurthestFromAverage() {
    val detector = CellSpreadDetector()
    // Cells 3.70 / 3.85 / 3.98: group 0 is furthest below the 3.843 average.
    val cells = listOf(3.70, 3.85, 3.98)
    val balancing = listOf(false, false, false)
    assertNull(detector.onFrame(cells, balancing, 0.0, 0L))
    val finding = detector.onFrame(cells, balancing, 0.0, 3_000L)
    assertNotNull(finding)
    assertEquals(0, JSONObject(finding!!.payloadJson).getInt("worstGroup"))
  }

  @Test
  fun invalidCellsAreFilteredAndCountAsNoData() {
    val detector = CellSpreadDetector()
    // No finite positive cells: not usable data, never fires, not clean at session end.
    assertNull(detector.onFrame(listOf(0.0, Double.NaN), listOf(false, false), 0.0, 0L))
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun singleValidCellIsNotUsableData() {
    val detector = CellSpreadDetector()
    // Only one valid group: spread is undefined, so the frame is not usable data and never fires.
    assertNull(detector.onFrame(listOf(3.80, 0.0), listOf(false, false), 0.0, 0L))
    assertNull(detector.onFrame(listOf(3.80, -1.0), listOf(false, false), 0.0, 3_000L))
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun longGapBreaksSustainContinuity() {
    val detector = CellSpreadDetector()
    // Over threshold, then a gap longer than the continuity tolerance (reconnect / interruption):
    // the unobserved time must not count toward the sustain window.
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L))
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 5_000L))
    // Sustain restarts at the post-gap frame, so it fires only 3 s after that.
    val finding = detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 8_000L)
    assertNotNull(finding)
    assertEquals(BoardWarningSeverity.WARN, finding!!.severity)
  }

  @Test
  fun laterWeakerEpisodeDoesNotDowngrade() {
    val detector = CellSpreadDetector()
    // Critical episode fires and then falls back under threshold.
    assertNull(detector.onFrame(listOf(3.40, 3.98), noBalance, 0.0, 0L))
    val critical = detector.onFrame(listOf(3.40, 3.98), noBalance, 0.0, 3_000L)
    assertEquals(BoardWarningSeverity.CRITICAL, critical!!.severity)
    assertNull(detector.onFrame(listOf(3.90, 3.91), noBalance, 0.0, 3_100L))

    // A later sustained warn episode must not overwrite the stored critical with weaker data.
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 4_000L))
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 7_000L))
  }

  @Test
  fun inFlightEpisodeAtSessionEndBlocksClean() {
    val detector = CellSpreadDetector()
    // Session ends while spread is over threshold but before it sustained: not a clean session.
    detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L)
    assertFalse(detector.sessionEndClean())
  }

  @Test
  fun sessionEndCleanOnlyWhenDataFlowedAndNeverFired() {
    val quietData = CellSpreadDetector()
    quietData.onFrame(listOf(3.90, 3.91), noBalance, 0.0, 0L)
    assertTrue(quietData.sessionEndClean())

    val noData = CellSpreadDetector()
    assertFalse(noData.sessionEndClean())

    val transientOnly = CellSpreadDetector()
    // Over-threshold spikes that never sustain do not block the clean clear.
    transientOnly.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L)
    transientOnly.onFrame(listOf(3.90, 3.91), noBalance, 0.0, 100L)
    assertTrue(transientOnly.sessionEndClean())

    val fired = CellSpreadDetector()
    fired.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L)
    fired.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 3_000L)
    assertFalse(fired.sessionEndClean())
  }

  @Test
  fun resetRestoresCleanState() {
    val detector = CellSpreadDetector()
    detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 0L)
    detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 3_000L)
    assertFalse(detector.sessionEndClean())

    detector.reset()
    assertFalse(detector.sessionEndClean())
    // After reset the sustain window starts fresh: a lone over-threshold frame does not fire.
    assertNull(detector.onFrame(listOf(3.80, 4.04), noBalance, 0.0, 10_000L))
  }
}
