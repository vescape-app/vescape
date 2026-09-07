import GRDB
import XCTest
@testable import VescapeCore

final class RideHistoryPagingTests: XCTestCase {
  private let hour: Int64 = 3_600_000

  func testKeepsCurrentRideWhenOlderBucketsRemain() {
    // Production fetches newest first; grouping returns oldest first.
    let buckets = [bucket(6 * hour), bucket(3 * hour), bucket(60_000), bucket(0)]
    let grouped = groupRideSessions(buckets: buckets, markers: [], gapMs: hour / 2)
    XCTAssertEqual(grouped.count, 3)
    let page = completeRideSessions(grouped, hasOlderBuckets: true)
    XCTAssertEqual(page.map(\.startAtMs), [3 * hour, 6 * hour])
  }

  func testKeepsCurrentRideOnceAllBucketsAreLoaded() {
    let grouped = groupRideSessions(
      buckets: [bucket(60_000), bucket(0)], markers: [], gapMs: hour / 2
    )
    let page = completeRideSessions(grouped, hasOlderBuckets: false)
    XCTAssertEqual(page.count, 1)
    XCTAssertEqual(page.first?.endAtMs, 119_000)
    XCTAssertEqual(page.first?.avgSpeedSampleCount, 2)
  }

  private func bucket(_ start: Int64) -> Row {
    Row([
      "board_id": "board-1", "recording_id": LEGACY_RIDE_RECORDING_ID, "bucket_start_ms": start,
      "first_sample_at_ms": start, "last_sample_at_ms": start + 59_000,
      "sample_count": 1, "gps_point_count": 0, "precise_gps_point_count": 0,
      "moving_speed_sample_count": 1, "sum_moving_abs_speed_centi_kmh": 1_000,
      "sum_abs_speed_centi_kmh": 1_000, "max_abs_speed_centi_kmh": 1_000,
      "gps_distance_cm": 0, "max_duty_abs_permille": 0,
      "battery_used_wh_milli": 0, "battery_regen_wh_milli": 0,
    ])
  }
}
