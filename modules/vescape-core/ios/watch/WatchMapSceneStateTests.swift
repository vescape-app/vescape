import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchMapSceneStateTest.kt
final class WatchMapSceneStateTests: XCTestCase {
  private let position = WatchMapPosition(latitude: 50, longitude: 19)
  private var frame: WatchFrame {
    WatchFrame(navBearing: 30, navDistanceM: 500, riderEastM: 10, riderNorthM: 20,
      courseDeg: 90, routeSpanM: 800,
      trail: [WatchTrailPoint(eastM: -20, northM: 0), WatchTrailPoint(eastM: 0, northM: 0)],
      mapPosition: position)
  }
  private let group = WatchGroupRide(courseDeg: 180, spanM: 1200, riders: [])
  private let ready = WatchRouteStatus(phase: .ready, routeId: 7)
  private func scene(_ frame: WatchFrame, status: WatchRouteStatus?, group: WatchGroupRide?, ambient: Bool = false, trail: Bool = true) -> WatchMapSceneState {
    WatchMapSceneState(frame: frame, routeId: 7, routeStatus: status, group: group, ambient: ambient, telemetryTrailEnabled: trail)
  }

  func testNavigationEndingFallsThroughGroupAndStandaloneWithoutLosingRiderHistory() {
    let navigation = scene(frame, status: ready, group: group)
    XCTAssertEqual(navigation.target.spanM, 800)
    XCTAssertEqual(navigation.target.courseDeg, 90)
    XCTAssertNotNil(navigation.navigation)
    var ended = frame
    ended.navBearing = nil
    ended.navDistanceM = nil
    let groupMap = scene(ended, status: WatchRouteStatus(phase: .idle), group: group)
    XCTAssertEqual(groupMap.target.spanM, 1200)
    XCTAssertEqual(groupMap.target.courseDeg, 180)
    XCTAssertNil(groupMap.navigation)
    XCTAssertEqual(groupMap.target.position, position)
    XCTAssertFalse(groupMap.showAbsentHint)
    let standalone = scene(ended, status: WatchRouteStatus(phase: .idle), group: nil)
    XCTAssertEqual(standalone.target.spanM, 800)
    XCTAssertEqual(standalone.target.position, position)
    XCTAssertTrue(standalone.drawMap)
    XCTAssertFalse(standalone.showAbsentHint)
  }

  func testRouteReplacementAndMissingFixShowNoticeWhileGroupRetainsCamera() {
    let receiving = scene(frame, status: WatchRouteStatus(phase: .ready, routeId: 8), group: group)
    XCTAssertEqual(receiving.notice, .receiving)
    XCTAssertNil(receiving.navigation)
    XCTAssertEqual(receiving.target.spanM, 1200)
    XCTAssertFalse(receiving.showAbsentHint)
    var noFix = frame
    noFix.navBearing = nil
    noFix.navDistanceM = nil
    noFix.riderEastM = nil
    noFix.riderNorthM = nil
    let waiting = scene(noFix, status: ready, group: group)
    XCTAssertEqual(waiting.notice, .location)
    XCTAssertNil(waiting.navigation)
    XCTAssertEqual(waiting.target.spanM, 1200)
    XCTAssertEqual(scene(frame, status: WatchRouteStatus(phase: .computing), group: group).notice, .computing)
    XCTAssertEqual(scene(frame, status: WatchRouteStatus(phase: .failed), group: group).notice, .failed)
    // Older phones have no status channel and retain lane-driven navigation.
    XCTAssertNotNil(scene(frame, status: nil, group: group).navigation)
  }

  func testTrailSettingAffectsTelemetryOnlyAndAmbientHidesMovingLayers() {
    let disabled = scene(frame, status: ready, group: group, trail: false)
    XCTAssertEqual(disabled.trailAlpha(navFocus: 0), 0)
    XCTAssertEqual(disabled.trailAlpha(navFocus: 0.4), 0.4)
    XCTAssertEqual(disabled.trailAlpha(navFocus: 1), 1)
    XCTAssertTrue(disabled.drawMap)
    XCTAssertNotNil(disabled.navigation)
    XCTAssertEqual(scene(frame, status: ready, group: group).trailAlpha(navFocus: 0), 1)
    for enabled in [false, true] {
      let ambient = scene(frame, status: ready, group: group, ambient: true, trail: enabled)
      XCTAssertFalse(ambient.drawMap)
      XCTAssertEqual(ambient.trailAlpha(navFocus: 1), 0)
      XCTAssertNotNil(ambient.navigation) // Ambient retains the destination pointer, without map motion.
    }
    var empty = frame
    empty.navBearing = nil
    empty.navDistanceM = nil
    empty.trail = []
    XCTAssertTrue(scene(empty, status: WatchRouteStatus(phase: .idle), group: nil).showAbsentHint)
  }
}
