import XCTest
@testable import VescapeCore

/// Shared test vector: the same ids must land in the same palette slots on every platform.
///
/// @parity /src/modules/group-ride/lib/riderColor.test.ts `RIDER_COLOR_VECTOR`
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameBuilderTest.kt `RIDER_COLOR_VECTOR`
private let riderColorVector: [(String, Int)] = [
  ("", 1),
  ("a", 0),
  ("rider-1", 2),
  ("rider-7", 3),
  ("rider-3", 4),
  ("550e8400-e29b-41d4-a716-446655440000", 2),
  ("Jonáš", 4),
  ("Zoë", 0),
]

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameBuilderTest.kt
final class GroupRideFrameBuilderTests: XCTestCase {
  private let me = WatchGeoPoint(latitude: 52.0, longitude: 21.0)
  private let nowMs: Int64 = 1_000_000

  private func rider(
    _ id: String,
    at position: WatchGeoPoint? = WatchGeoPoint(latitude: 52.001, longitude: 21.0),
    stale: Bool = false,
    away: Bool = false,
    lastSeenMs: Int64? = nil
  ) -> GroupRideRosterRider {
    GroupRideRosterRider(
      id: id, name: id.uppercased(), position: position, stale: stale, away: away,
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

  func testRidersWithoutAPositionAreLeftOut() {
    let frame = build([rider("nowhere", at: nil), rider("ola")])

    XCTAssertEqual(frame.riders.map(\.id), ["ola"])
  }

  func testAnAwayRiderStaysAtTheirLastPositionStaleHoweverLongSilent() {
    let frame = build([rider("away", away: true, lastSeenMs: nowMs - 3_600_000)])

    XCTAssertEqual(frame.riders.map(\.id), ["away"])
    XCTAssertEqual(frame.riders.first?.stale, true)
  }

  func testARiderUnheardPastTheStaleWindowIsStale() {
    let frame = build([
      rider("quiet", lastSeenMs: nowMs - GROUP_RIDE_STALE_AFTER_MS),
      rider("flagged", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), stale: true),
    ])

    XCTAssertTrue(frame.riders.allSatisfy(\.stale))
  }

  func testRidersLandInTheSharedPaletteSlotsById() {
    for (id, index) in riderColorVector {
      XCTAssertEqual(groupRideRiderPaletteIndex(id), index, id)
    }
  }

  func testARidersColourFollowsTheirIdNotDistanceStaleOrRosterOrder() {
    let near = rider("rider-7", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0))
    let far = rider("rider-1", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0))
    let before = build([rider("me"), far, near])
    // They swap places and one goes stale: nobody's colour moves.
    var movedNear = near
    movedNear.position = WatchGeoPoint(latitude: 52.003, longitude: 21.0)
    movedNear.stale = true
    let after = build([movedNear, far])

    let expected = ["rider-7": GROUP_RIDE_RIDER_COLORS[3], "rider-1": GROUP_RIDE_RIDER_COLORS[2]]
    XCTAssertEqual(Dictionary(uniqueKeysWithValues: before.riders.map { ($0.id, $0.colorArgb) }), expected)
    XCTAssertEqual(Dictionary(uniqueKeysWithValues: after.riders.map { ($0.id, $0.colorArgb) }), expected)
    XCTAssertEqual(after.riders.map(\.id), ["rider-1", "rider-7"])
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
