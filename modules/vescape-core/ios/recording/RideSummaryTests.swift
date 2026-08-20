import GRDB
import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/recording/RideSummaryTest.kt
final class RideSummaryTests: XCTestCase {
  private let deviceId = "AA:BB"
  private let start: Int64 = 1_700_000_000_000

  // MARK: Eligibility and identity

  func testRideIdMatchesHistorySessionIdentity() {
    XCTAssertEqual(
      RideSummaryBuilder.rideId(deviceId: "AA:BB", startAtMs: 10, endAtMs: 90),
      "AA:BB:10:90"
    )
    XCTAssertEqual(
      RideSummaryBuilder.rideId(deviceId: "", startAtMs: 10, endAtMs: 90),
      "unknown:10:90"
    )
    XCTAssertEqual(
      RideSummaryBuilder.rideId(deviceId: nil, startAtMs: 10, endAtMs: 90),
      "unknown:10:90"
    )
  }

  func testMovingBucketsProduceAnEligibleRide() throws {
    let ride = try latestRide(movingSampleCount: 60)
    let summary = try XCTUnwrap(ride)
    XCTAssertEqual(summary.rideId, "\(deviceId):\(start):\(start + 120_000)")
    XCTAssertEqual(summary.durationMs, 110_000)
    XCTAssertEqual(summary.distanceM, 1500)
  }

  func testRideWithNoMovingSamplesIsNotEligible() throws {
    XCTAssertNil(try latestRide(movingSampleCount: 0))
  }

  func testNoBucketsMeansNoRide() {
    XCTAssertNil(RideSummaryBuilder.latestFinalizedRide(buckets: [], markers: []))
  }

  // MARK: Battery validity

  func testFinalBatteryInsideTheRideIsUsed() throws {
    let ride = try XCTUnwrap(try latestRide(movingSampleCount: 60))
    XCTAssertEqual(
      RideSummaryBuilder.validBatteryPercent(ride: ride, percent: 47.4, atMs: ride.endAtMs),
      47
    )
  }

  func testStaleOrMissingBatteryIsOmitted() throws {
    let ride = try XCTUnwrap(try latestRide(movingSampleCount: 60))
    XCTAssertNil(RideSummaryBuilder.validBatteryPercent(ride: ride, percent: nil, atMs: ride.endAtMs))
    XCTAssertNil(RideSummaryBuilder.validBatteryPercent(ride: ride, percent: 47, atMs: nil))
    // Older than the ride start, and older than the max age behind the ride end.
    XCTAssertNil(
      RideSummaryBuilder.validBatteryPercent(ride: ride, percent: 47, atMs: ride.startAtMs - 1)
    )
    XCTAssertNil(
      RideSummaryBuilder.validBatteryPercent(
        ride: ride,
        percent: 47,
        atMs: ride.endAtMs + RideSummaryBuilder.batteryMaxAgeMs + 1
      )
    )
  }

  // MARK: Text

  func testBodyOmitsBatterySegmentWhenAbsent() {
    XCTAssertEqual(
      RideSummaryText.body(distanceM: 12_400, durationMs: 38 * 60_000, batteryPercent: 47),
      "12 km · 38 min · 47% battery"
    )
    XCTAssertEqual(
      RideSummaryText.body(distanceM: 12_400, durationMs: 38 * 60_000, batteryPercent: nil),
      "12 km · 38 min"
    )
    XCTAssertEqual(
      RideSummaryText.body(distanceM: nil, durationMs: 90 * 60_000, batteryPercent: nil),
      "1h 30m"
    )
    XCTAssertEqual(
      RideSummaryText.body(distanceM: 1_250, durationMs: 30_000, batteryPercent: nil),
      "1.3 km · 30 s"
    )
  }

  // MARK: Policy

  func testPolicyReportsEveryTerminalSkipReason() throws {
    let ride = try XCTUnwrap(try latestRide(movingSampleCount: 60))
    XCTAssertEqual(
      RideSummaryPolicy.skipReason(
        ride: ride, settingEnabled: false, permissionGranted: true, alreadyNotified: false),
      ConnectionTraceReason.rideSummaryDisabled
    )
    XCTAssertEqual(
      RideSummaryPolicy.skipReason(
        ride: nil, settingEnabled: true, permissionGranted: true, alreadyNotified: false),
      ConnectionTraceReason.rideNotEligible
    )
    XCTAssertEqual(
      RideSummaryPolicy.skipReason(
        ride: ride, settingEnabled: true, permissionGranted: true, alreadyNotified: true),
      ConnectionTraceReason.alreadyNotified
    )
    XCTAssertEqual(
      RideSummaryPolicy.skipReason(
        ride: ride, settingEnabled: true, permissionGranted: false, alreadyNotified: false),
      ConnectionTraceReason.permissionMissing
    )
    XCTAssertNil(
      RideSummaryPolicy.skipReason(
        ride: ride, settingEnabled: true, permissionGranted: true, alreadyNotified: false)
    )
  }

  // MARK: Durable deduplication

  func testClaimIsGrantedOnceAndSurvivesReopen() throws {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("ride-summary-\(UUID().uuidString).sqlite")
    defer { try? FileManager.default.removeItem(at: url) }

    let first = try DatabaseQueue(path: url.path)
    try first.write { try RideSummaryStore.createTables($0) }
    let store = RideSummaryStore(dbWriter: first)

    XCTAssertFalse(store.wasNotified(rideId: "ride-1"))
    XCTAssertTrue(store.claim(rideId: "ride-1", nowMs: 1))
    // A repeated finalize callback for the same ride loses the claim.
    XCTAssertFalse(store.claim(rideId: "ride-1", nowMs: 2))
    XCTAssertTrue(store.wasNotified(rideId: "ride-1"))
    try first.close()

    // Process restart / CoreBluetooth restoration: a fresh connection still sees the marker.
    let reopened = try DatabaseQueue(path: url.path)
    let afterRestart = RideSummaryStore(dbWriter: reopened)
    XCTAssertTrue(afterRestart.wasNotified(rideId: "ride-1"))
    XCTAssertFalse(afterRestart.claim(rideId: "ride-1", nowMs: 3))

    // A failed post releases the claim so the ride is not silently skipped forever.
    afterRestart.release(rideId: "ride-1")
    XCTAssertFalse(afterRestart.wasNotified(rideId: "ride-1"))
    XCTAssertTrue(afterRestart.claim(rideId: "ride-1", nowMs: 4))
  }

  // MARK: Deep link

  func testDeepLinkTargetsTheRecordingId() {
    XCTAssertEqual(
      RideSummaryLink.uri(rideId: "AA:BB:10:90"),
      "vescape://history/ride/AA%3ABB%3A10%3A90"
    )
  }

  // MARK: Helpers

  private func latestRide(movingSampleCount: Int) throws -> RideSummary? {
    let buckets = [
      try bucketRow(
        bucketStartMs: start,
        firstSampleAtMs: start,
        lastSampleAtMs: start + 55_000,
        movingSampleCount: movingSampleCount,
        firstMovingAtMs: movingSampleCount > 0 ? start + 5_000 : nil,
        lastMovingAtMs: movingSampleCount > 0 ? start + 55_000 : nil,
        firstOdometerCm: 100_000,
        lastOdometerCm: 150_000
      ),
      try bucketRow(
        bucketStartMs: start + 60_000,
        firstSampleAtMs: start + 60_000,
        lastSampleAtMs: start + 120_000,
        movingSampleCount: movingSampleCount,
        firstMovingAtMs: movingSampleCount > 0 ? start + 60_000 : nil,
        lastMovingAtMs: movingSampleCount > 0 ? start + 115_000 : nil,
        firstOdometerCm: 150_000,
        lastOdometerCm: 250_000
      ),
    ]
    return RideSummaryBuilder.latestFinalizedRide(buckets: buckets, markers: [])
  }

  private func bucketRow(
    bucketStartMs: Int64,
    firstSampleAtMs: Int64,
    lastSampleAtMs: Int64,
    movingSampleCount: Int,
    firstMovingAtMs: Int64?,
    lastMovingAtMs: Int64?,
    firstOdometerCm: Int64,
    lastOdometerCm: Int64
  ) throws -> Row {
    Row([
      "bucket_start_ms": bucketStartMs,
      "device_id": deviceId,
      "first_sample_at_ms": firstSampleAtMs,
      "last_sample_at_ms": lastSampleAtMs,
      "sample_count": 60,
      "moving_speed_sample_count": movingSampleCount,
      "sum_moving_abs_speed_centi_kmh": Int64(movingSampleCount) * 2_000,
      "sum_abs_speed_centi_kmh": Int64(60) * 2_000,
      "max_abs_speed_centi_kmh": 3_000,
      "first_moving_at_ms": firstMovingAtMs,
      "last_moving_at_ms": lastMovingAtMs,
      "first_odometer_cm": firstOdometerCm,
      "last_odometer_cm": lastOdometerCm,
      "battery_used_wh_milli": 0,
      "battery_regen_wh_milli": 0,
    ])
  }
}
