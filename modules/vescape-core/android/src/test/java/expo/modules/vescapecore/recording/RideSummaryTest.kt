package expo.modules.vescapecore.recording

import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import expo.modules.vescapecore.telemetry.TelemetryMinuteBucketEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/recording/RideSummaryTests.swift */
class RideSummaryTest {
  private val deviceId = "AA:BB"
  private val start = 1_700_000_000_000L

  // MARK: Eligibility and identity

  @Test
  fun rideIdMatchesHistorySessionIdentity() {
    assertEquals("AA:BB:10:90", RideSummaryBuilder.rideId("AA:BB", 10L, 90L))
    assertEquals("unknown:10:90", RideSummaryBuilder.rideId("", 10L, 90L))
    assertEquals("unknown:10:90", RideSummaryBuilder.rideId(null, 10L, 90L))
  }

  @Test
  fun movingBucketsProduceAnEligibleRide() {
    val ride = requireNotNull(latestRide(movingSampleCount = 60))
    assertEquals("$deviceId:$start:${start + 120_000}", ride.rideId)
    assertEquals(110_000L, ride.durationMs)
    assertEquals(1500.0, ride.distanceM!!, 0.001)
  }

  @Test
  fun rideWithNoMovingSamplesIsNotEligible() {
    assertNull(latestRide(movingSampleCount = 0))
  }

  @Test
  fun noBucketsMeansNoRide() {
    assertNull(RideSummaryBuilder.latestFinalizedRide(emptyList(), emptyList()))
  }

  // MARK: Battery validity

  @Test
  fun finalBatteryInsideTheRideIsUsed() {
    val ride = requireNotNull(latestRide(movingSampleCount = 60))
    assertEquals(47, RideSummaryBuilder.validBatteryPercent(ride, 47.4, ride.endAtMs))
  }

  @Test
  fun staleOrMissingBatteryIsOmitted() {
    val ride = requireNotNull(latestRide(movingSampleCount = 60))
    assertNull(RideSummaryBuilder.validBatteryPercent(ride, null, ride.endAtMs))
    assertNull(RideSummaryBuilder.validBatteryPercent(ride, 47.0, null))
    assertNull(RideSummaryBuilder.validBatteryPercent(ride, 47.0, ride.startAtMs - 1))
    assertNull(
      RideSummaryBuilder.validBatteryPercent(
        ride,
        47.0,
        ride.endAtMs + RideSummaryBuilder.BATTERY_MAX_AGE_MS + 1,
      ),
    )
  }

  // MARK: Text

  @Test
  fun bodyOmitsBatterySegmentWhenAbsent() {
    assertEquals(
      "12 km · 38 min · 47% battery",
      RideSummaryText.body(12_400.0, 38 * 60_000L, 47),
    )
    assertEquals("12 km · 38 min", RideSummaryText.body(12_400.0, 38 * 60_000L, null))
    assertEquals("1h 30m", RideSummaryText.body(null, 90 * 60_000L, null))
    assertEquals("1.3 km · 30 s", RideSummaryText.body(1_250.0, 30_000L, null))
  }

  // MARK: Policy

  @Test
  fun policyReportsEveryTerminalSkipReason() {
    val ride = requireNotNull(latestRide(movingSampleCount = 60))
    assertEquals(
      ConnectionTraceReason.RIDE_SUMMARY_DISABLED,
      RideSummaryPolicy.skipReason(ride, settingEnabled = false, permissionGranted = true, alreadyNotified = false),
    )
    assertEquals(
      ConnectionTraceReason.RIDE_NOT_ELIGIBLE,
      RideSummaryPolicy.skipReason(null, settingEnabled = true, permissionGranted = true, alreadyNotified = false),
    )
    assertEquals(
      ConnectionTraceReason.ALREADY_NOTIFIED,
      RideSummaryPolicy.skipReason(ride, settingEnabled = true, permissionGranted = true, alreadyNotified = true),
    )
    assertEquals(
      ConnectionTraceReason.PERMISSION_MISSING,
      RideSummaryPolicy.skipReason(ride, settingEnabled = true, permissionGranted = false, alreadyNotified = false),
    )
    assertNull(
      RideSummaryPolicy.skipReason(ride, settingEnabled = true, permissionGranted = true, alreadyNotified = false),
    )
  }

  // MARK: Deep link

  @Test
  fun deepLinkTargetsTheRecordingId() {
    assertEquals("vescape://history/ride/AA%3ABB%3A10%3A90", RideSummaryLink.uri("AA:BB:10:90"))
  }

  // MARK: Helpers

  private fun latestRide(movingSampleCount: Int): RideSummary? =
    RideSummaryBuilder.latestFinalizedRide(
      listOf(
        bucket(
          bucketStartMs = start,
          firstSampleAtMs = start,
          lastSampleAtMs = start + 55_000,
          movingSampleCount = movingSampleCount,
          firstMovingAtMs = if (movingSampleCount > 0) start + 5_000 else null,
          lastMovingAtMs = if (movingSampleCount > 0) start + 55_000 else null,
          firstOdometerCm = 100_000,
          lastOdometerCm = 150_000,
        ),
        bucket(
          bucketStartMs = start + 60_000,
          firstSampleAtMs = start + 60_000,
          lastSampleAtMs = start + 120_000,
          movingSampleCount = movingSampleCount,
          firstMovingAtMs = if (movingSampleCount > 0) start + 60_000 else null,
          lastMovingAtMs = if (movingSampleCount > 0) start + 115_000 else null,
          firstOdometerCm = 150_000,
          lastOdometerCm = 250_000,
        ),
      ),
      emptyList(),
    )

  private fun bucket(
    bucketStartMs: Long,
    firstSampleAtMs: Long,
    lastSampleAtMs: Long,
    movingSampleCount: Int,
    firstMovingAtMs: Long?,
    lastMovingAtMs: Long?,
    firstOdometerCm: Long,
    lastOdometerCm: Long,
  ) = TelemetryMinuteBucketEntity(
    bucketStartMs = bucketStartMs,
    deviceId = deviceId,
    deviceName = "Board",
    sampleCount = 60,
    firstSampleAtMs = firstSampleAtMs,
    lastSampleAtMs = lastSampleAtMs,
    sumAbsSpeedCentiKmh = 60L * 2_000L,
    movingSpeedSampleCount = movingSampleCount,
    sumMovingAbsSpeedCentiKmh = movingSampleCount * 2_000L,
    maxAbsSpeedCentiKmh = 3_000,
    minBatteryVoltageMv = null,
    maxMotorCurrentAbsMa = 0,
    maxBatteryCurrentAbsMa = 0,
    batteryUsedWhMilli = 0,
    batteryRegenWhMilli = 0,
    maxDutyAbsPermille = 0,
    faultCount = 0,
    firstOdometerCm = firstOdometerCm,
    lastOdometerCm = lastOdometerCm,
    gpsPointCount = 0,
    preciseGpsPointCount = 0,
    gpsDistanceCm = 0,
    maxGpsSpeedCentiMps = null,
    firstMovingAtMs = firstMovingAtMs,
    lastMovingAtMs = lastMovingAtMs,
  )
}
