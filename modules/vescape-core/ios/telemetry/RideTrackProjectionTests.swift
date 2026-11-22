import GRDB
import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/HistoryGpsProjectionTest.kt
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/TelemetryBucketBuilderTest.kt
final class RideTrackProjectionTests: XCTestCase {
  private func point(
    fixAtMs: Int64,
    latitudeE7: Int64 = 500_000_000,
    accuracyCm: Int? = 300,
    gpsSpeedCentiMps: Int? = nil,
    boardId: String? = "board-1"
  ) -> RideTrackPoint {
    RideTrackPoint(
      boardId: boardId,
      fixAtMs: fixAtMs,
      latitudeE7: latitudeE7,
      longitudeE7: 190_000_000,
      accuracyCm: accuracyCm,
      gpsSpeedCentiMps: gpsSpeedCentiMps,
      bearingCentiDeg: nil,
      altitudeCm: nil
    )
  }

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
    XCTAssertEqual(bucket.sampleCount, 0)
    XCTAssertEqual(bucket.gpsPointCount, 2)
    XCTAssertEqual(bucket.preciseGpsPointCount, 2)
    XCTAssertEqual(bucket.firstLatitudeE7, 500_000_000)
    XCTAssertGreaterThan(bucket.gpsDistanceCm, 0)
    XCTAssertEqual(bucket.firstSampleAtMs, 120_500)
    XCTAssertEqual(bucket.lastSampleAtMs, 130_000)
  }

  func testFixesWithoutAccuracyAreImprecise() {
    XCTAssertFalse(rideTrackFixIsPrecise(accuracyCm: nil))
    XCTAssertTrue(rideTrackFixIsPrecise(accuracyCm: rideTrackPreciseAccuracyCm))
    XCTAssertFalse(rideTrackFixIsPrecise(accuracyCm: 12_000))
  }

  func testDistanceNeverChainsAcrossBoards() {
    let points = rideTrackBucketPoints([
      point(fixAtMs: 1_000, latitudeE7: 500_000_000, boardId: "board-a"),
      point(fixAtMs: 1_500, latitudeE7: 520_000_000, boardId: "board-b"),
      point(fixAtMs: 2_000, latitudeE7: 500_010_000, boardId: "board-a"),
    ])

    XCTAssertNil(points[0].distanceFromPreviousCm)
    XCTAssertNil(points[1].distanceFromPreviousCm, "a different Board is not a predecessor")
    let step = points[2].distanceFromPreviousCm ?? 0
    XCTAssertGreaterThan(step, 0)
    XCTAssertLessThan(step, 20_000, "board A continues its own track, not board B's")
  }

  func testAPoorFixIsCountedButDerivesNothing() {
    let points = rideTrackBucketPoints([
      point(fixAtMs: 1_000, accuracyCm: 12_000, gpsSpeedCentiMps: 500)
    ])

    XCTAssertEqual(points.count, 1)
    XCTAssertFalse(points[0].precise)
    XCTAssertFalse(points[0].moving, "a poor fix is never movement evidence")
    XCTAssertNil(points[0].latitudeE7)
  }

  func testMovementComesFromTheFixesReportedSpeed() {
    let points = rideTrackBucketPoints(
      [
        point(fixAtMs: 1_000, gpsSpeedCentiMps: 200),
        point(fixAtMs: 2_000, gpsSpeedCentiMps: 50),
        point(fixAtMs: 3_000, gpsSpeedCentiMps: nil),
      ],
      movingThresholdCentiKmh: 300
    )

    XCTAssertTrue(points[0].moving)
    XCTAssertFalse(points[1].moving)
    XCTAssertFalse(points[2].moving, "a fix with no reported speed is not movement evidence")
    XCTAssertTrue(points[2].precise, "but it is still a route point")
  }

  func testGpsMovementExtendsTheMovingWindow() {
    let buckets = buildTelemetryBuckets(
      [],
      locationPoints: rideTrackBucketPoints(
        [
          point(fixAtMs: 120_000, gpsSpeedCentiMps: 500),
          point(fixAtMs: 150_000, gpsSpeedCentiMps: 10),
        ],
        movingThresholdCentiKmh: 300
      )
    )

    XCTAssertEqual(buckets.first?.firstMovingAtMs, 120_000)
    XCTAssertEqual(buckets.first?.lastMovingAtMs, 120_000)
    XCTAssertEqual(buckets.first?.sampleCount, 0, "a fix is never a Telemetry Sample")
  }
}
