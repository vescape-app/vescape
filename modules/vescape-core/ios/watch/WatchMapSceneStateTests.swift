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
  private func scene(_ frame: WatchFrame, status: WatchRouteStatus?, group: WatchGroupRide?, ambient: Bool = false, trail: Bool = true, groupOnTelemetry: Bool = true, routeOnTelemetry: Bool = true, streetMap: Bool = true, mapGauges: Int = 60) -> WatchMapSceneState {
    WatchMapSceneState(frame: frame, routeId: 7, routeStatus: status, group: group, ambient: ambient, telemetryTrailEnabled: trail, telemetryGroupEnabled: groupOnTelemetry, telemetryRouteEnabled: routeOnTelemetry, streetMapEnabled: streetMap, mapGaugesPercent: mapGauges)
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
    let standalone = scene(ended, status: WatchRouteStatus(phase: .idle), group: nil)
    XCTAssertEqual(standalone.target.spanM, 800)
    XCTAssertEqual(standalone.target.position, position)
    XCTAssertTrue(standalone.drawMap)
  }

  func testRouteReplacementAndMissingFixShowNoticeWhileGroupRetainsCamera() {
    let receiving = scene(frame, status: WatchRouteStatus(phase: .ready, routeId: 8), group: group)
    XCTAssertEqual(receiving.notice, .receiving)
    XCTAssertNil(receiving.navigation)
    XCTAssertEqual(receiving.target.spanM, 1200)
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
  }

  func testStreetMapDimsBehindTheGaugesAndLeavesInAmbient() {
    XCTAssertEqual(scene(frame, status: ready, group: nil).mapAlpha(navFocus: 0), 0.6, accuracy: 1e-9)
    XCTAssertEqual(scene(frame, status: ready, group: nil).mapAlpha(navFocus: 1), 1)
    XCTAssertEqual(scene(frame, status: ready, group: nil, trail: false).mapAlpha(navFocus: 2), 1)
    XCTAssertEqual(scene(frame, status: ready, group: nil, ambient: true).mapAlpha(navFocus: 1), 0)
  }

  /// Issue #557: Map behind gauges sets the gauge page opacity; the map page stays full.
  func testMapBehindGaugesSetsTheGaugePageOpacityOnly() {
    XCTAssertEqual(scene(frame, status: ready, group: nil, mapGauges: 30).mapAlpha(navFocus: 0), 0.3, accuracy: 1e-9)
    XCTAssertEqual(scene(frame, status: ready, group: nil, mapGauges: 90).mapAlpha(navFocus: 0), 0.9, accuracy: 1e-9)
    XCTAssertEqual(scene(frame, status: ready, group: nil, mapGauges: 30).mapAlpha(navFocus: 0.5), 0.65, accuracy: 1e-9)
    XCTAssertEqual(scene(frame, status: ready, group: nil, mapGauges: 30).mapAlpha(navFocus: 1), 1)
    XCTAssertEqual(scene(frame, status: ready, group: nil, ambient: true, mapGauges: 90).mapAlpha(navFocus: 0), 0)
  }

  /// Issue #536: Group Ride marks leave the telemetry screen only; the map page fades them in.
  func testGroupSettingAffectsTelemetryOnlyAndAmbientHidesIt() {
    let off = scene(frame, status: ready, group: group, groupOnTelemetry: false)
    XCTAssertEqual(off.groupAlpha(navFocus: 0), 0)
    XCTAssertEqual(off.groupAlpha(navFocus: 0.4), 0.4)
    XCTAssertEqual(off.groupAlpha(navFocus: 1), 1)
    XCTAssertEqual(off.trailAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group).groupAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group, ambient: true).groupAlpha(navFocus: 1), 0)
  }

  /// Issue #558: the route line leaves the telemetry screen only; the map page fades it in.
  func testRouteSettingAffectsTelemetryOnlyAndAmbientHidesIt() {
    let off = scene(frame, status: ready, group: group, routeOnTelemetry: false)
    XCTAssertEqual(off.routeAlpha(navFocus: 0), 0)
    XCTAssertEqual(off.routeAlpha(navFocus: 0.4), 0.4)
    XCTAssertEqual(off.routeAlpha(navFocus: 1), 1)
    XCTAssertNotNil(off.navigation)
    XCTAssertEqual(off.trailAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group).routeAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group, ambient: true).routeAlpha(navFocus: 1), 0)
  }

  /// Issue #557 + #536: the Off step hides the street map behind the gauges only.
  func testMapBehindGaugesOffFadesTheStreetMapInOnTheMapPage() {
    let off = scene(frame, status: ready, group: nil, mapGauges: 0)
    XCTAssertTrue(off.drawStreetMap)
    XCTAssertEqual(off.mapAlpha(navFocus: 0), 0)
    XCTAssertEqual(off.mapAlpha(navFocus: 0.5), 0.5, accuracy: 1e-9)
    XCTAssertEqual(off.mapAlpha(navFocus: 1), 1)
  }

  /// Issues #536 + #558: the rider circle leaves the telemetry screen only once every layer there is off.
  func testRiderCircleLeavesTheGaugesOnlyWhenEveryTelemetryLayerIsOff() {
    XCTAssertEqual(scene(frame, status: ready, group: group).riderAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group, trail: false, groupOnTelemetry: false, routeOnTelemetry: false).riderAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group, trail: false, groupOnTelemetry: false, mapGauges: 0).riderAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group, trail: false, routeOnTelemetry: false, mapGauges: 0).riderAlpha(navFocus: 0), 1)
    XCTAssertEqual(scene(frame, status: ready, group: group, groupOnTelemetry: false, routeOnTelemetry: false, mapGauges: 0).riderAlpha(navFocus: 0), 1)
    for clean in [
      scene(frame, status: ready, group: group, trail: false, groupOnTelemetry: false, routeOnTelemetry: false, mapGauges: 0),
      scene(frame, status: ready, group: group, trail: false, groupOnTelemetry: false, routeOnTelemetry: false, streetMap: false),
    ] {
      XCTAssertEqual(clean.riderAlpha(navFocus: 0), 0)
      XCTAssertEqual(clean.riderAlpha(navFocus: 0.4), 0.4)
      XCTAssertEqual(clean.riderAlpha(navFocus: 1), 1)
    }
    XCTAssertEqual(scene(frame, status: ready, group: group, ambient: true).riderAlpha(navFocus: 1), 0)
  }

  func testStreetMapSettingOffHidesOnlyTheStreetMap() {
    let off = scene(frame, status: ready, group: nil, streetMap: false)
    XCTAssertFalse(off.drawStreetMap)
    XCTAssertEqual(off.mapAlpha(navFocus: 1), 0)
    XCTAssertTrue(off.drawMap) // Route, trail and Group Ride marks keep drawing.
    XCTAssertEqual(off.trailAlpha(navFocus: 0), 1)
    XCTAssertTrue(scene(frame, status: ready, group: nil).drawStreetMap)
  }
}
