import XCTest

@testable import VescapeCore

/// Ride Track read-side behaviour (#448, ADR 0038): the track is its own stream on its own clock,
/// so a minute can be track-only, a migrated fix must not lose the quality it was stored with, and
/// a mixed-Board track must never let one Board's fix stand in for another's.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/HistoryGpsProjectionTest.kt
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilderTest.kt
final class RideTrackProjectionTests: XCTestCase {
  private func point(
    fixAtMs: Int64,
    latitudeE7: Int64 = 500_000_000,
    accuracyCm: Int? = 300,
    recordingId: String? = "recording-1",
    boardId: String? = "board-1"
  ) -> RideTrackPoint {
    RideTrackPoint(
      recordingId: recordingId,
      boardId: boardId,
      fixAtMs: fixAtMs,
      latitudeE7: latitudeE7,
      longitudeE7: 190_000_000,
      accuracyCm: accuracyCm,
      gpsSpeedCentiMps: nil,
      bearingCentiDeg: nil,
      altitudeCm: nil
    )
  }

  /// A board dropout is exactly when the track matters most: those minutes still own a bucket.
  func testATrackOnlyMinuteStillProducesABucket() {
    let buckets = buildTelemetryBuckets(
      [],
      locationPoints: rideTrackBucketPoints([
        point(fixAtMs: 120_500),
        point(fixAtMs: 130_000, latitudeE7: 500_010_000),
      ])
    )

    XCTAssertEqual(buckets.count, 1)
    guard let bucket = buckets.first else { return }
    XCTAssertEqual(bucket.bucketStartMs, 120_000)
    XCTAssertEqual(bucket.recordingId, "recording-1")
    XCTAssertEqual(bucket.sampleCount, 0)
    XCTAssertEqual(bucket.gpsPointCount, 2)
    XCTAssertEqual(bucket.preciseGpsPointCount, 2)
    XCTAssertEqual(bucket.firstLatitudeE7, 500_000_000)
    XCTAssertGreaterThan(bucket.gpsDistanceCm, 0)
    XCTAssertEqual(bucket.firstSampleAtMs, 120_500)
    XCTAssertEqual(bucket.lastSampleAtMs, 130_000)
  }

  /// A legacy row passed the old write-time precision gate, so a missing accuracy on it means
  /// "precise", not "unknown". A live fix with no accuracy is genuinely unknown.
  func testMigratedFixesWithoutAccuracyStayPrecise() {
    XCTAssertTrue(rideTrackFixIsPrecise(accuracyCm: nil, recordingId: nil))
    XCTAssertFalse(rideTrackFixIsPrecise(accuracyCm: nil, recordingId: "recording-1"))
    XCTAssertTrue(rideTrackFixIsPrecise(accuracyCm: 300, recordingId: "recording-1"))
    XCTAssertFalse(rideTrackFixIsPrecise(accuracyCm: 12_000, recordingId: "recording-1"))
  }

  /// Every migrated fix carries a nil recording, so recording equality alone would chain a
  /// haversine step from one Board's fix straight to another's.
  func testLegacyDistanceNeverChainsAcrossBoards() {
    let points = rideTrackBucketPoints([
      point(fixAtMs: 1_000, latitudeE7: 500_000_000, recordingId: nil, boardId: "board-a"),
      point(fixAtMs: 1_500, latitudeE7: 520_000_000, recordingId: nil, boardId: "board-b"),
      point(fixAtMs: 2_000, latitudeE7: 500_010_000, recordingId: nil, boardId: "board-a"),
    ])

    XCTAssertNil(points[0].distanceFromPreviousCm)
    XCTAssertNil(points[1].distanceFromPreviousCm, "a different Board is not a predecessor")
    let step = points[2].distanceFromPreviousCm ?? 0
    XCTAssertGreaterThan(step, 0)
    XCTAssertLessThan(step, 20_000, "board A continues its own track, not board B's")
  }

  /// A rebuild stamps a mixed-Board track. One shared cursor would let board B's later fix become
  /// "current" and strip board A's sample of the position its own in-range fix already covered.
  func testEachBoardIsStampedFromItsOwnCursor() {
    var stamper = RideTrackStamper([
      point(fixAtMs: 9_000, latitudeE7: 500_000_000, boardId: "board-a"),
      point(fixAtMs: 9_500, latitudeE7: 520_000_000, boardId: "board-b"),
    ])

    let fix = stamper.fix(atOrBefore: 10_000, boardId: "board-a")

    XCTAssertEqual(fix?.latitudeE7, 500_000_000)
  }

  func testAFixOlderThanTheAgeGateDoesNotStamp() {
    var stamper = RideTrackStamper([point(fixAtMs: 9_000)])

    XCTAssertNotNil(stamper.fix(atOrBefore: 10_000, boardId: "board-1"))
    XCTAssertNil(stamper.fix(atOrBefore: 40_000, boardId: "board-1"))
  }
}
