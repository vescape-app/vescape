import XCTest
@testable import VescapeCore

final class TelemetryRangeSubtractionTests: XCTestCase {
  private let requested = TelemetryTimeRange(startMs: 100, endMs: 200)

  func testFavoriteProtectionExpandsToEveryTouchedBucket() {
    XCTAssertEqual(
      expandTelemetryRangeToBuckets(
        TelemetryTimeRange(startMs: 75_000, endMs: 120_000),
        bucketSizeMs: 60_000
      ),
      TelemetryTimeRange(startMs: 60_000, endMs: 179_999)
    )
  }

  func testFullOverlapLeavesNothingDeletable() {
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: requested,
        protectedRanges: [TelemetryTimeRange(startMs: 50, endMs: 250)]
      ),
      []
    )
  }

  func testPartialOverlapCarvesEachEdge() {
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: requested,
        protectedRanges: [TelemetryTimeRange(startMs: 50, endMs: 150)]
      ),
      [TelemetryTimeRange(startMs: 151, endMs: 200)]
    )
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: requested,
        protectedRanges: [TelemetryTimeRange(startMs: 150, endMs: 250)]
      ),
      [TelemetryTimeRange(startMs: 100, endMs: 149)]
    )
  }

  func testMultipleOverlappingFavoritesMergeBeforeSubtraction() {
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: requested,
        protectedRanges: [
          TelemetryTimeRange(startMs: 120, endMs: 160),
          TelemetryTimeRange(startMs: 140, endMs: 180),
        ]
      ),
      [
        TelemetryTimeRange(startMs: 100, endMs: 119),
        TelemetryTimeRange(startMs: 181, endMs: 200),
      ]
    )
  }

  func testOneFavoriteStaysProtectedAcrossSeparateDeleteRequests() {
    let favorite = [TelemetryTimeRange(startMs: 120, endMs: 180)]
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: TelemetryTimeRange(startMs: 100, endMs: 150),
        protectedRanges: favorite
      ),
      [TelemetryTimeRange(startMs: 100, endMs: 119)]
    )
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: TelemetryTimeRange(startMs: 151, endMs: 200),
        protectedRanges: favorite
      ),
      [TelemetryTimeRange(startMs: 181, endMs: 200)]
    )
  }

  func testAdjacentDisjointFavoriteDoesNotAffectDeletion() {
    XCTAssertEqual(
      subtractProtectedTelemetryRanges(
        deleteRange: requested,
        protectedRanges: [TelemetryTimeRange(startMs: 201, endMs: 250)]
      ),
      [requested]
    )
  }
}
