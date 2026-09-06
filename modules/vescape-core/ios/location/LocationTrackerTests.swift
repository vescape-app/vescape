import XCTest
@testable import VescapeCore

final class LocationTrackerTests: XCTestCase {
  private func fix(_ timestamp: Int64, precise: Bool = true, bearing: Double? = 90) -> TelemetryLocationCapture {
    TelemetryLocationCapture(
      latitude: 52, longitude: 21, speedMps: 2, bearingDeg: bearing,
      accuracyM: precise ? 5 : 100, altitudeM: 110, timestamp: timestamp, precise: precise
    )
  }

  func testConsumerOrderAndPayloadWithPreciseThenApproximateFix() {
    var calls: [String] = []
    var tracker: LocationTracker!
    tracker = LocationTracker(
      recentWindowMs: { 60_000 },
      recordLocation: { location in
        calls.append("record")
        XCTAssertNotEqual(tracker.latestLocation?.timestamp, location.timestamp)
      },
      navigationFix: { location in
        calls.append("navigation")
        XCTAssertEqual(tracker.latestLocation?.timestamp, location.timestamp)
        XCTAssertNotEqual(tracker.latestPreciseLocation?.timestamp, location.timestamp)
      },
      persistLocation: { location in
        calls.append("persist")
        XCTAssertEqual(tracker.latestPreciseLocation?.timestamp, location.timestamp)
        if location.timestamp == 100_000 { XCTAssertTrue(tracker.recentLocations.isEmpty) }
      }
    )
    let precise = tracker.onLocationUpdated(fix(100_000))
    XCTAssertEqual(calls, ["record", "navigation", "persist"])
    var expected = fix(100_000)
    expected.courseDeg = 90
    expected.courseSourceTimestamp = 100_000
    XCTAssertEqual(
      NSDictionary(dictionary: precise.map.mapValues { $0 ?? NSNull() }),
      NSDictionary(dictionary: expected.map.mapValues { $0 ?? NSNull() })
    )
    calls.removeAll()
    let approximate = tracker.onLocationUpdated(fix(101_000, precise: false, bearing: 180))
    XCTAssertEqual(calls, ["record", "navigation"])
    XCTAssertEqual(tracker.riderPosition?.timestamp, 101_000)
    XCTAssertEqual(tracker.latestPreciseLocation?.timestamp, 100_000)
    XCTAssertEqual(tracker.recentLocations.count, 1)
    XCTAssertEqual(
      NSDictionary(dictionary: approximate.map.mapValues { $0 ?? NSNull() }),
      NSDictionary(dictionary: fix(101_000, precise: false, bearing: 180).map.mapValues { $0 ?? NSNull() })
    )
    // An approximate bearing must not change the retained precise course.
    let next = tracker.onLocationUpdated(fix(102_000, bearing: nil))
    XCTAssertEqual(next.courseDeg, 90)
    XCTAssertEqual(next.courseSourceTimestamp, 100_000)
    tracker = nil
  }

  func testRecentWindowBoundaryAndSettingsPrune() {
    var window: Int64 = 60_000
    let tracker = LocationTracker(
      recentWindowMs: { window }, recordLocation: { _ in },
      navigationFix: { _ in }, persistLocation: { _ in }
    )
    _ = tracker.onLocationUpdated(fix(100_000))
    _ = tracker.onLocationUpdated(fix(160_000))
    XCTAssertEqual(tracker.recentLocations.count, 2)
    _ = tracker.onLocationUpdated(fix(160_001))
    XCTAssertEqual(tracker.recentLocations.count, 2)
    window = 1
    tracker.pruneRecentLocations(now: 160_002)
    XCTAssertEqual(tracker.recentLocations.count, 1)
    XCTAssertEqual(tracker.recentLocations.first?["timestamp"] as? Int64, 160_001)
    // Pruning the trail does not discard the last known fix.
    tracker.pruneRecentLocations(now: 200_000)
    XCTAssertTrue(tracker.recentLocations.isEmpty)
    XCTAssertEqual(tracker.latestLocation?.timestamp, 160_001)
  }

  func testReplayClearDropsFixesAndCourseBeforeLiveFixResumes() {
    let tracker = LocationTracker(
      recentWindowMs: { 60_000 }, recordLocation: { _ in },
      navigationFix: { _ in }, persistLocation: { _ in }
    )
    _ = tracker.onLocationUpdated(fix(100_000))
    tracker.clearReplayLocations()
    XCTAssertNil(tracker.latestLocation)
    XCTAssertNil(tracker.latestPreciseLocation)
    XCTAssertNil(tracker.riderPosition)
    XCTAssertTrue(tracker.recentLocations.isEmpty)
    let live = tracker.onLocationUpdated(fix(101_000, bearing: nil))
    XCTAssertNil(live.courseDeg)
    XCTAssertNil(live.courseSourceTimestamp)
    XCTAssertEqual(tracker.latestLocation?.timestamp, 101_000)
  }
}
