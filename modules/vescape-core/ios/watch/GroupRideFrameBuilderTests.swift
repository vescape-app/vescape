import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameBuilderTest.kt
final class GroupRideFrameBuilderTests: XCTestCase {
  private let me = WatchGeoPoint(latitude: 52.0, longitude: 21.0)
  private let nowMs: Int64 = 1_000_000

  private func rider(
    _ id: String,
    at position: WatchGeoPoint? = WatchGeoPoint(latitude: 52.001, longitude: 21.0),
    color: String? = "#FF0000",
    stale: Bool = false,
    lastSeenMs: Int64? = nil
  ) -> GroupRideRosterRider {
    GroupRideRosterRider(
      id: id, name: id.uppercased(), color: color, position: position, stale: stale,
      lastSeenMs: lastSeenMs ?? nowMs
    )
  }

  private func build(
    _ riders: [GroupRideRosterRider],
    own: WatchGeoPoint?? = .none,
    spanM: Double? = 800
  ) -> GroupRideFrame {
    GroupRideFrameBuilder.build(
      roster: GroupRideRoster(ownRiderId: "me", riders: riders),
      own: own ?? me,
      courseDeg: 90,
      spanM: spanM,
      nowMs: nowMs
    )
  }

  func testOtherRidersBecomeOffsetsFromTheRidersFixNearestFirst() {
    let frame = build([
      rider("far", at: WatchGeoPoint(latitude: 52.0, longitude: 21.01)),
      rider("near", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0)),
    ])

    XCTAssertEqual(frame.riders.map(\.id), ["near", "far"])
    XCTAssertEqual(frame.riders[0].eastM, 0, accuracy: 0.01)
    XCTAssertEqual(frame.riders[0].northM, 110.574, accuracy: 0.01)
    XCTAssertEqual(frame.riders[1].eastM, 685, accuracy: 1)
    XCTAssertEqual(frame.courseDeg, 90)
  }

  func testTheRidersOwnEntryIsNeverInTheFrame() {
    XCTAssertEqual(build([rider("me"), rider("ola")]).riders.map(\.id), ["ola"])
  }

  func testSpanFallsBackTo600MetresUntilThePhoneMapPublishesOne() {
    XCTAssertEqual(build([], spanM: nil).spanM, 600)
    XCTAssertEqual(build([], spanM: 0).spanM, 600)
    XCTAssertEqual(build([], spanM: 800).spanM, 800)
  }

  func testWithoutAFixNobodyCanBePlaced() {
    XCTAssertTrue(build([rider("ola")], own: .some(nil)).riders.isEmpty)
  }

  func testRidersWithoutPositionOrSilentPastTheDropWindowAreLeftOut() {
    let frame = build([
      rider("nowhere", at: nil),
      rider("gone", lastSeenMs: nowMs - GROUP_RIDE_DROP_AFTER_MS),
      rider("ola"),
    ])

    XCTAssertEqual(frame.riders.map(\.id), ["ola"])
  }

  func testARiderUnheardPastTheStaleWindowIsStale() {
    let frame = build([
      rider("quiet", lastSeenMs: nowMs - GROUP_RIDE_STALE_AFTER_MS),
      rider("flagged", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), stale: true),
    ])

    XCTAssertTrue(frame.riders.allSatisfy(\.stale))
  }

  func testAChosenColourIsKeptAndAMissingOneFallsBackByRosterPosition() {
    let frame = build([
      rider("picked", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0), color: "#10C69A"),
      rider("unpicked", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), color: nil),
    ])

    XCTAssertEqual(frame.riders[0].colorArgb, 0xFF10_C69A)
    XCTAssertEqual(frame.riders[1].colorArgb, 0xFF22_C55E)
  }

  func testFallbackColoursFollowThePhoneRosterOrderOwnRiderFirstThenNearest() {
    let frame = GroupRideFrameBuilder.build(
      roster: GroupRideRoster(ownRiderId: "me", riders: [
        rider("me", color: nil),
        rider("far", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), color: nil),
        rider("near", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0), color: nil),
      ]),
      own: me, courseDeg: nil, spanM: nil, nowMs: nowMs
    )

    // Index 0 is the Rider's own entry; near is 1 (green), far is 2 (amber).
    XCTAssertEqual(frame.riders.map(\.colorArgb), [0xFF22_C55E, 0xFFF5_9E0B])
  }

  func testBatteryPercentAndLevelsComeFromTheRidersPresence() {
    var low = rider("low")
    low.soc = 0.084
    low.motorTempC = 72
    low.ctrlTempC = 40
    var hot = rider("hot", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0))
    hot.soc = 0.5
    hot.motorTempC = 30
    hot.ctrlTempC = 81
    let walking = rider("walking", at: WatchGeoPoint(latitude: 52.003, longitude: 21.0))

    let riders = build([low, hot, walking]).riders

    XCTAssertEqual(riders.map(\.id), ["low", "hot", "walking"])
    XCTAssertEqual(riders[0].batteryPercent, 8)
    XCTAssertEqual(riders[0].batteryLevel, .critical)
    XCTAssertEqual(riders[0].heatLevel, .warning)
    XCTAssertEqual(riders[1].batteryPercent, 50)
    XCTAssertEqual(riders[1].batteryLevel, .normal)
    XCTAssertEqual(riders[1].heatLevel, .critical)
    XCTAssertNil(riders[2].batteryPercent)
    XCTAssertEqual(riders[2].batteryLevel, .normal)
    XCTAssertEqual(riders[2].heatLevel, .normal)
  }
}
