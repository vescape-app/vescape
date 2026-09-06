import GRDB
import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/RideHistoryPagingTest.kt
final class RideHistoryGroupingTests: XCTestCase {
  private let gapMs: Int64 = 30 * 60_000
  private let base: Int64 = 1_714_521_600_000

  /// A minute with GPS fixes and no Telemetry Sample: the shape a board dropout leaves behind.
  func testGpsOnlyMinutesExtendTheMovingWindowAndTheRide() {
    let buckets = [
      bucket(start: base, end: base + 30_000),
      trackOnlyBucket(start: base + 5 * 60_000, end: base + 5 * 60_000 + 30_000),
      bucket(start: base + 10 * 60_000, end: base + 10 * 60_000 + 30_000),
    ]

    let sessions = groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs)

    XCTAssertEqual(sessions.count, 1)
    XCTAssertEqual(sessions.first?.movingStartAtMs, base)
    XCTAssertEqual(sessions.first?.movingEndAtMs, base + 10 * 60_000 + 30_000)
    XCTAssertEqual(sessions.first?.endAtMs, base + 10 * 60_000 + 30_000)
    // The track-only minute widens the window without pretending it held Telemetry Samples.
    XCTAssertEqual(sessions.first?.sampleCount, 2)
    XCTAssertEqual(sessions.first?.avgSpeedSampleCount, 2)
  }

  /// A recording is the entry: a dropout inside it never splits, however long it runs.
  func testOneRecordingSpanningAnHourWithoutEitherStreamStaysOneEntry() {
    let buckets = [
      bucket(start: base, end: base + 30_000, recordingId: "recording-1"),
      bucket(start: base + 3_600_000, end: base + 3_600_000 + 30_000, recordingId: "recording-1"),
    ]

    let sessions = groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs)

    XCTAssertEqual(sessions.count, 1)
    XCTAssertEqual(sessions.first?.endAtMs, base + 3_600_000 + 30_000)
  }

  /// Stop then start again inside one minute: two recordings, two entries.
  func testSeparateRecordingsInsideOneMinuteStaySeparateEntries() {
    let buckets = [
      bucket(start: base, end: base + 10_000, recordingId: "recording-1"),
      bucket(start: base + 20_000, end: base + 30_000, recordingId: "recording-2"),
    ]

    let sessions = groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs)

    XCTAssertEqual(sessions.map { $0.recordingId }, ["recording-1", "recording-2"])
  }

  /// A disconnect mid-recording is informational; it does not end the recording.
  func testABreakMarkerInsideOneRecordingDoesNotSplitIt() {
    let buckets = [
      bucket(start: base, end: base + 10_000, recordingId: "recording-1"),
      bucket(start: base + 60_000, end: base + 70_000, recordingId: "recording-1"),
    ]
    let markers = [
      Row([
        "occurred_at_ms": base + 60_000,
        "type": "disconnected",
        "board_id": "board-1",
      ])
    ]

    XCTAssertEqual(groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs).count, 1)
  }

  /// Legacy rows have no recording identity, so they still split on `rideSplitGapMinutes`.
  func testLegacyRowsStillGroupOnTheSplitGap() {
    let buckets = [
      bucket(start: base, end: base + 30_000),
      bucket(start: base + 3_600_000, end: base + 3_600_000 + 30_000),
    ]

    XCTAssertEqual(groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs).count, 2)
    XCTAssertEqual(groupRideSessions(buckets: buckets, markers: [], gapMs: 2 * 3_600_000).count, 1)
  }

  /// The 100th and 101st buckets share a minute. Neither recording may be skipped by the cursor.
  /// @parity /modules/vescape-core/android/src/androidTest/java/expo/modules/vescapecore/telemetry/RideReadQueriesTest.kt
  func testBucketPagingIncludesTheWholeBoundaryMinute() throws {
    let database = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(database)
    try database.write { db in
      for minute in 2...100 {
        try insertPagingBucket(db, start: base + Int64(minute) * 60_000, recordingId: "newer")
      }
      try insertPagingBucket(db, start: base + 60_000, recordingId: "boundary-a")
      try insertPagingBucket(db, start: base + 80_000, recordingId: "boundary-b")
      try insertPagingBucket(db, start: base, recordingId: "boundary-a")
    }
    try database.read { db in
      let first = try fetchRideHistoryBucketBatch(db, beforeMs: Int64.max)
      XCTAssertEqual(first.buckets.count, 101)
      XCTAssertTrue(first.hasOlder)
      let cursor = try XCTUnwrap(first.buckets.last?["bucket_start_ms"] as Int64?)
      XCTAssertEqual(cursor, base + 60_000)
      let second = try fetchRideHistoryBucketBatch(db, beforeMs: cursor)
      XCTAssertEqual(second.buckets.count, 1)
      XCTAssertFalse(second.hasOlder)
      let sessions = groupRideSessions(buckets: first.buckets + second.buckets, markers: [], gapMs: gapMs)
      XCTAssertEqual(sessions.count, 3)
      XCTAssertEqual(sessions.first { $0.recordingId == "newer" }?.sampleCount, 99)
      XCTAssertEqual(sessions.first { $0.recordingId == "boundary-a" }?.sampleCount, 2)
      XCTAssertEqual(sessions.first { $0.recordingId == "boundary-b" }?.sampleCount, 1)
      let empty = try fetchRideHistoryBucketBatch(db, beforeMs: base)
      XCTAssertTrue(empty.buckets.isEmpty)
      XCTAssertFalse(empty.hasOlder)
    }
  }

  private func insertPagingBucket(_ db: Database, start: Int64, recordingId: String) throws {
    var bucket = TelemetryBucket(
      bucketStartMs: start - start % TELEMETRY_BUCKET_SIZE_MS,
      boardId: "board-1", recordingId: recordingId
    )
    bucket.sampleCount = 1
    bucket.firstSampleAtMs = start
    bucket.lastSampleAtMs = start + 10_000
    bucket.movingSpeedSampleCount = 1
    bucket.sumMovingAbsSpeedCentiKmh = 1_000
    bucket.firstMovingAtMs = start
    bucket.lastMovingAtMs = start + 10_000
    try upsertBucket(db, bucket)
  }

  private func trackOnlyBucket(start: Int64, end: Int64) -> Row {
    bucket(
      start: start,
      end: end,
      sampleCount: 0,
      movingSpeedSampleCount: 0,
      hasOdometer: false
    )
  }

  private func bucket(
    start: Int64,
    end: Int64,
    recordingId: String = LEGACY_RIDE_RECORDING_ID,
    sampleCount: Int = 1,
    movingSpeedSampleCount: Int = 1,
    hasOdometer: Bool = true
  ) -> Row {
    Row([
      "bucket_start_ms": start - (start % TELEMETRY_BUCKET_SIZE_MS),
      "board_id": "board-1",
      "recording_id": recordingId,
      "sample_count": sampleCount,
      "first_sample_at_ms": start,
      "last_sample_at_ms": end,
      "sum_abs_speed_centi_kmh": Int64(sampleCount) * 1_000,
      "moving_speed_sample_count": movingSpeedSampleCount,
      "sum_moving_abs_speed_centi_kmh": Int64(movingSpeedSampleCount) * 1_000,
      "max_abs_speed_centi_kmh": sampleCount > 0 ? 1_000 : 0,
      "min_battery_voltage_mv": nil,
      "max_motor_current_abs_ma": 0,
      "max_battery_current_abs_ma": 0,
      "battery_used_wh_milli": Int64(0),
      "battery_regen_wh_milli": Int64(0),
      "max_duty_abs_permille": 0,
      "first_odometer_cm": hasOdometer ? Int64(0) : nil,
      "last_odometer_cm": hasOdometer ? Int64(1_000) : nil,
      "gps_point_count": sampleCount > 0 ? 0 : 2,
      "precise_gps_point_count": sampleCount > 0 ? 0 : 2,
      "gps_distance_cm": Int64(0),
      "max_gps_speed_centi_mps": 0,
      "first_moving_at_ms": start,
      "last_moving_at_ms": end,
      "max_temp_mosfet_deci_c": nil,
      "max_temp_motor_deci_c": nil,
      "first_latitude_e7": nil,
      "first_longitude_e7": nil,
    ])
  }
}
