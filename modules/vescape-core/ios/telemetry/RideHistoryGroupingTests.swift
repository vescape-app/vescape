import GRDB
import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/RideHistoryPagingTest.kt
final class RideHistoryGroupingTests: XCTestCase {
  private let gapMs: Int64 = 30 * 60_000
  private let base: Int64 = 1_714_521_600_000

  /// A minute with GPS fixes and no Telemetry Sample: the shape a board dropout leaves behind.
  func testGpsOnlyMinutesExtendTheMovingWindowAndTheRide() throws {
    let buckets = [
      bucket(start: base, end: base + 30_000),
      trackOnlyBucket(start: base + 5 * 60_000, end: base + 5 * 60_000 + 30_000),
      bucket(start: base + 10 * 60_000, end: base + 10 * 60_000 + 30_000),
    ]

    let sessions = try groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs)

    XCTAssertEqual(sessions.count, 1)
    XCTAssertEqual(sessions.first?.movingStartAtMs, base)
    XCTAssertEqual(sessions.first?.movingEndAtMs, base + 10 * 60_000 + 30_000)
    XCTAssertEqual(sessions.first?.endAtMs, base + 10 * 60_000 + 30_000)
    // The track-only minute widens the window without pretending it held Telemetry Samples.
    XCTAssertEqual(sessions.first?.sampleCount, 2)
    XCTAssertEqual(sessions.first?.avgSpeedSampleCount, 2)
  }

  /// Disconnect, app kill or auto close, then riding again inside the split window: one ride.
  func testDisconnectMarkersNoLongerSplitARide() throws {
    let buckets = [
      bucket(start: base, end: base + 10_000),
      bucket(start: base + 20 * 60_000, end: base + 20 * 60_000 + 10_000),
    ]
    let markers = ["disconnected", "app_stop", "error", "connection_lost"].map { marker(base + 15 * 60_000, $0) }

    XCTAssertEqual(try groupRideSessions(buckets: buckets, markers: markers, gapMs: gapMs).count, 1)
  }

  /// A long stop while still connected (Idle Pause writes no frames) splits on the frame gap.
  func testAFrameGapLongerThanTheSplitWindowStartsANewRide() throws {
    let buckets = [
      bucket(start: base, end: base + 30_000),
      bucket(start: base + 2 * 3_600_000, end: base + 2 * 3_600_000 + 30_000),
    ]

    XCTAssertEqual(try groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs).count, 2)
    XCTAssertEqual(try groupRideSessions(buckets: buckets, markers: [], gapMs: 3 * 3_600_000).count, 1)
  }

  func testStopRecordingSplitsInsideTheSplitWindow() throws {
    let buckets = [
      bucket(start: base, end: base + 10_000),
      bucket(start: base + 2 * 60_000, end: base + 2 * 60_000 + 10_000),
    ]

    XCTAssertEqual(
      try groupRideSessions(buckets: buckets, markers: [marker(base + 60_000, recordingStopMarker)], gapMs: gapMs).count, 2)
    XCTAssertEqual(
      try groupRideSessions(
        buckets: buckets, markers: [marker(base + 60_000, recordingStopMarker, boardId: "board-2")], gapMs: gapMs
      ).count,
      1,
      "another Board's stop does not split this ride"
    )
  }

  func testABoardChangeStartsANewRide() throws {
    let buckets = [
      bucket(start: base, end: base + 10_000),
      bucket(start: base + 60_000, end: base + 70_000, boardId: "board-2"),
    ]

    XCTAssertEqual(try groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs).map(\.boardId), ["board-1", "board-2"])
  }

  /// The Ride Dropout Grace tail after the last frame belongs to that ride.
  func testAGpsOnlyTailAttachesToThePrecedingRide() throws {
    let sessions = try groupRideSessions(
      buckets: [bucket(start: base, end: base + 30_000), trackOnlyBucket(start: base + 60_000, end: base + 90_000)],
      markers: [], gapMs: gapMs
    )

    XCTAssertEqual(sessions.count, 1)
    XCTAssertEqual(sessions.first?.endAtMs, base + 90_000)
    XCTAssertEqual(sessions.first?.blockCount, 2)
  }

  func testGpsOnlyMinutesNeverCreateOrExtendARideOnTheirOwn() throws {
    XCTAssertTrue(
      try groupRideSessions(buckets: [trackOnlyBucket(start: base, end: base + 30_000)], markers: [], gapMs: gapMs).isEmpty)
    // GPS 20 min after the last frame does not move the split baseline: frames 40 min apart split.
    let buckets = [
      bucket(start: base, end: base + 10_000),
      trackOnlyBucket(start: base + 20 * 60_000, end: base + 20 * 60_000 + 10_000),
      bucket(start: base + 40 * 60_000, end: base + 40 * 60_000 + 10_000),
    ]
    XCTAssertEqual(try groupRideSessions(buckets: buckets, markers: [], gapMs: gapMs).count, 2)
    // Another Board's GPS never joins this ride.
    let foreign = try groupRideSessions(
      buckets: [bucket(start: base, end: base + 10_000), trackOnlyBucket(start: base + 60_000, end: base + 70_000, boardId: "board-2")],
      markers: [], gapMs: gapMs
    )
    XCTAssertEqual(foreign.count, 1)
    XCTAssertEqual(foreign.first?.blockCount, 1)
  }

  func testBridgeIdentityIsBoardAndTimeRange() throws {
    let session = try XCTUnwrap(
      try groupRideSessions(buckets: [bucket(start: base, end: base + 10_000)], markers: [], gapMs: gapMs).first)
    let map = rideSessionMap(session, boardNames: [:], weather: nil)
    XCTAssertEqual(map["id"] as? String, "board-1:\(base):\(base + 10_000)")
    XCTAssertFalse(map.keys.contains("recordingId"))
  }

  private func marker(_ at: Int64, _ type: String, boardId: String = "board-1") -> Row {
    Row(["occurred_at_ms": at, "type": type, "board_id": boardId])
  }

  /// The 100th and 101st buckets share a minute. Neither Board may be skipped by the cursor.
  /// @parity /modules/vescape-core/android/src/androidTest/java/expo/modules/vescapecore/telemetry/RideReadQueriesTest.kt
  func testBucketPagingIncludesTheWholeBoundaryMinute() throws {
    let database = try DatabaseQueue()
    try VescapeDatabase.migrator.migrate(database)
    try database.write { db in
      for minute in 2...100 {
        try insertPagingBucket(db, start: base + Int64(minute) * 60_000, boardId: "board-newer")
      }
      try insertPagingBucket(db, start: base + 60_000, boardId: "board-a")
      try insertPagingBucket(db, start: base + 80_000, boardId: "board-b")
      try insertPagingBucket(db, start: base, boardId: "board-a")
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
      let sessions = try groupRideSessions(buckets: first.buckets + second.buckets, markers: [], gapMs: gapMs)
      XCTAssertEqual(sessions.count, 3)
      XCTAssertEqual(sessions.first { $0.boardId == "board-newer" }?.sampleCount, 99)
      XCTAssertEqual(sessions.first { $0.boardId == "board-a" }?.sampleCount, 2)
      XCTAssertEqual(sessions.first { $0.boardId == "board-b" }?.sampleCount, 1)
      let empty = try fetchRideHistoryBucketBatch(db, beforeMs: base)
      XCTAssertTrue(empty.buckets.isEmpty)
      XCTAssertFalse(empty.hasOlder)
    }
  }

  private func insertPagingBucket(_ db: Database, start: Int64, boardId: String) throws {
    var bucket = TelemetryBucket(
      bucketStartMs: start - start % TELEMETRY_BUCKET_SIZE_MS,
      boardId: boardId
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

  private func trackOnlyBucket(start: Int64, end: Int64, boardId: String = "board-1") -> Row {
    bucket(
      start: start,
      end: end,
      boardId: boardId,
      sampleCount: 0,
      movingSpeedSampleCount: 0,
      hasOdometer: false
    )
  }

  private func bucket(
    start: Int64,
    end: Int64,
    boardId: String = "board-1",
    sampleCount: Int = 1,
    movingSpeedSampleCount: Int = 1,
    hasOdometer: Bool = true
  ) -> Row {
    Row([
      "bucket_start_ms": start - (start % TELEMETRY_BUCKET_SIZE_MS),
      "board_id": boardId,
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
