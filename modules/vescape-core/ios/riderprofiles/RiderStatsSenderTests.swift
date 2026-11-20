import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/riderprofiles/RiderStatsSenderTest.kt
final class RiderStatsSenderTests: XCTestCase {
  private var suite: String!
  private var defaults: UserDefaults!
  override func setUp() {
    suite = "RiderStatsSenderTests.\(UUID().uuidString)"
    defaults = UserDefaults(suiteName: suite)!
  }
  override func tearDown() { defaults.removePersistentDomain(forName: suite) }
  private func policy() -> RiderStatsUploadPolicy { RiderStatsUploadPolicy(defaults: UserDefaults(suiteName: suite)!) }

  func testRideEndSelectsOnlyBoundaryMonthsAndForegroundOnlyCurrentPlusPrevious() {
    let policy = policy()
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let now = calendar.date(from: DateComponents(year: 2026, month: 1, day: 15))!
    let ride: Set<String> = ["2025-11", "2025-12"]
    XCTAssertEqual(policy.months(now: now, foreground: false, rideMonths: ride, backfill: nil), ride)
    XCTAssertEqual(policy.months(now: now, foreground: true, rideMonths: ride, backfill: nil, calendar: calendar), ["2026-01", "2025-12"])
    XCTAssertEqual(policy.months(now: now, foreground: false, rideMonths: [], backfill: nil), [])
    let history = ride.union(["2020-03"])
    XCTAssertEqual(policy.months(now: now, foreground: true, rideMonths: ride, backfill: history), history)
  }

  func testBackfillCompletionSurvivesRecreationIsPerAccountAndFailedPassRetries() {
    let first = policy()
    XCTAssertTrue(first.needsBackfill("A"))
    first.finished("A", complete: false)
    XCTAssertTrue(policy().needsBackfill("A"))
    first.finished("A", complete: true)
    let restarted = policy()
    XCTAssertFalse(restarted.needsBackfill("A"))
    XCTAssertTrue(restarted.needsBackfill("B"))
    restarted.finished("B", complete: true)
    XCTAssertFalse(policy().needsBackfill("A"))
    XCTAssertFalse(policy().needsBackfill("B"))
  }

  func testSameAccountRefreshIsIgnoredWhileSignInAndAccountSwitchTrigger() {
    let policy = policy()
    XCTAssertTrue(policy.accountChanged("A"))
    XCTAssertFalse(policy.accountChanged("A"))
    XCTAssertTrue(policy.accountChanged("B"))
    XCTAssertFalse(policy.accountChanged(nil))
    XCTAssertTrue(policy.accountChanged("B"))
  }

  func testForegroundThrottleSurvivesRestartButAllowsBackfillRetryAndRideUploads() {
    let policy = policy()
    let now = 10_000.0
    XCTAssertTrue(policy.begin("A", foreground: true, now: now))
    XCTAssertTrue(self.policy().begin("A", foreground: true, now: now + 1))
    policy.finished("A", complete: true)
    XCTAssertFalse(self.policy().begin("A", foreground: true, now: now + 2))
    XCTAssertTrue(policy.begin("A", foreground: false, now: now + 2))
    XCTAssertTrue(policy.begin("A", foreground: true, now: now + 3601))
  }

  func testNormalizesServerFieldsIncludingNonfiniteAndFractionalIntegers() {
    let payload = normalizedRiderStats([
      "rideCount": 100_000.7, "rideTimeMs": 3e9, "topSpeedKmh": Double.nan,
      "avgSpeedKmh": 1001.0, "distanceM": Double.infinity, "longestRideM": -1.0,
      "batteryUsedWh": 1e9, "batteryRegenWh": nil,
    ])
    XCTAssertEqual(payload["rideCount"] as? Double, 100_000)
    XCTAssertEqual(payload["rideTimeMs"] as? Double, 2_678_400_000)
    XCTAssertEqual(payload["topSpeedKmh"] as? Int, 0)
    XCTAssertEqual(payload["avgSpeedKmh"] as? Double, 1000)
    XCTAssertTrue(payload["distanceM"] is NSNull)
    XCTAssertEqual(payload["longestRideM"] as? Double, 0)
    XCTAssertEqual(payload["batteryUsedWh"] as? Double, 1e8)
    XCTAssertTrue(payload["batteryRegenWh"] is NSNull)
    XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
    let rounded = normalizedRiderStats(["rideCount": 2.5, "rideTimeMs": 10.5])
    XCTAssertEqual(rounded["rideCount"] as? Double, 3)
    XCTAssertEqual(rounded["rideTimeMs"] as? Double, 11)
    let invalid = normalizedRiderStats(["rideCount": -1, "rideTimeMs": -Double.infinity])
    XCTAssertEqual(invalid["rideCount"] as? Double, 0)
    XCTAssertEqual(invalid["rideTimeMs"] as? Int, 0)
  }
}
