import Foundation

/// A coherent map decision for one frame, independent of SwiftUI and its animation clock.
/// Navigation owns the camera while drawable; otherwise Group Ride takes over, then standalone GPS.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapSceneState.kt
struct WatchMapSceneState {
  let navigation: WatchMapNavigation?
  var hasNavigation: Bool { navigation != nil }
  let notice: WatchRouteNotice?
  let drawMap: Bool
  /// The rider can turn the street map off; the route, trail and marks stay.
  let drawStreetMap: Bool
  let target: WatchMapTarget
  private let telemetryTrailEnabled: Bool
  private let telemetryGroupEnabled: Bool
  private let telemetryRouteEnabled: Bool
  private let mapGaugesAlpha: Double

  init(frame: WatchFrame, routeId: UInt32?, routeStatus: WatchRouteStatus?, group: WatchGroupRide?, ambient: Bool, telemetryTrailEnabled: Bool, telemetryGroupEnabled: Bool, telemetryRouteEnabled: Bool, streetMapEnabled: Bool, mapGaugesPercent: Int) {
    let hasNavigation = frame.navBearing != nil && frame.navDistanceM != nil && routeStatus?.canDraw(receivedRouteId: routeId) != false
    if hasNavigation, let bearing = frame.navBearing, let distance = frame.navDistanceM {
      navigation = WatchMapNavigation(bearingDeg: bearing, distanceM: distance)
    } else {
      navigation = nil
    }
    notice = routeStatus?.notice(receivedRouteId: routeId, hasPosition: frame.navBearing != nil && frame.navDistanceM != nil && frame.riderEastM != nil && frame.riderNorthM != nil)
    drawMap = !ambient
    drawStreetMap = drawMap && streetMapEnabled
    self.telemetryTrailEnabled = telemetryTrailEnabled
    self.telemetryGroupEnabled = telemetryGroupEnabled
    self.telemetryRouteEnabled = telemetryRouteEnabled
    // The rider's Map behind gauges percent, already snapped by `WatchMapGauges.percent`.
    mapGaugesAlpha = Double(mapGaugesPercent) / 100
    target = WatchMapTarget(
      spanM: WatchMapProjection.clampedSpanM(!hasNavigation ? group?.spanM ?? frame.routeSpanM : frame.routeSpanM),
      courseDeg: !hasNavigation ? group?.courseDeg ?? frame.courseDeg : frame.courseDeg,
      position: frame.mapPosition
    )
  }

  func trailAlpha(navFocus: Double) -> Double { layerAlpha(onTelemetry: telemetryTrailEnabled, navFocus: navFocus) }

  /// Group Ride dots and edge triangles: full on the telemetry screen, else they fade in with nav focus.
  func groupAlpha(navFocus: Double) -> Double { layerAlpha(onTelemetry: telemetryGroupEnabled, navFocus: navFocus) }

  /// Navigation route line: full on the telemetry screen, else it fades in with nav focus. The
  /// chevron and distance stay.
  func routeAlpha(navFocus: Double) -> Double { layerAlpha(onTelemetry: telemetryRouteEnabled, navFocus: navFocus) }

  /// The rider circle stays on the telemetry screen while any map layer there has something around
  /// it. With trail, Group Ride, route line and map behind gauges all off, the gauges are clean and the circle
  /// fades in with nav focus. The map page always shows it.
  func riderAlpha(navFocus: Double) -> Double {
    layerAlpha(onTelemetry: telemetryTrailEnabled || telemetryGroupEnabled || telemetryRouteEnabled || (drawStreetMap && mapGaugesAlpha > 0), navFocus: navFocus)
  }

  private func layerAlpha(onTelemetry: Bool, navFocus: Double) -> Double {
    guard drawMap else { return 0 }
    return onTelemetry ? 1 : min(1, max(0, navFocus))
  }

  /// Street map: the rider's Map behind gauges opacity behind the gauges, full on the map page,
  /// absent in ambient or when off.
  func mapAlpha(navFocus: Double) -> Double {
    guard drawStreetMap else { return 0 }
    return mapGaugesAlpha + (1 - mapGaugesAlpha) * min(1, max(0, navFocus))
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
