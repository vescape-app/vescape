import Foundation

/// A coherent map decision for one frame, independent of SwiftUI and its animation clock.
/// Navigation owns the camera while drawable; otherwise Group Ride takes over, then standalone GPS.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapSceneState.kt
struct WatchMapSceneState {
  let navigation: WatchMapNavigation?
  var hasNavigation: Bool { navigation != nil }
  let notice: WatchRouteNotice?
  let drawMap: Bool
  let showAbsentHint: Bool
  let target: WatchMapTarget
  private let telemetryTrailEnabled: Bool

  init(frame: WatchFrame, routeId: UInt32?, routeStatus: WatchRouteStatus?, group: WatchGroupRide?, ambient: Bool, telemetryTrailEnabled: Bool) {
    let hasNavigation = frame.navBearing != nil && frame.navDistanceM != nil && routeStatus?.canDraw(receivedRouteId: routeId) != false
    if hasNavigation, let bearing = frame.navBearing, let distance = frame.navDistanceM {
      navigation = WatchMapNavigation(bearingDeg: bearing, distanceM: distance)
    } else {
      navigation = nil
    }
    notice = routeStatus?.notice(receivedRouteId: routeId, hasPosition: frame.navBearing != nil && frame.navDistanceM != nil && frame.riderEastM != nil && frame.riderNorthM != nil)
    drawMap = !ambient
    showAbsentHint = !hasNavigation && notice == nil && group == nil && frame.trail.isEmpty
    self.telemetryTrailEnabled = telemetryTrailEnabled
    target = WatchMapTarget(
      spanM: WatchMapProjection.clampedSpanM(!hasNavigation ? group?.spanM ?? frame.routeSpanM : frame.routeSpanM),
      courseDeg: !hasNavigation ? group?.courseDeg ?? frame.courseDeg : frame.courseDeg,
      position: frame.mapPosition
    )
  }

  func trailAlpha(navFocus: Double) -> Double {
    guard drawMap else { return 0 }
    return telemetryTrailEnabled ? 1 : min(1, max(0, navFocus))
  }
}

struct WatchMapTarget: Equatable {
  let spanM: Double
  let courseDeg: Double?
  let position: WatchMapPosition?
}

struct WatchMapNavigation: Equatable {
  let bearingDeg: Double
  let distanceM: Double
}
