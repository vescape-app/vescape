import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapScene.kt `WatchMapScene`
struct WatchMapScene<Gauges: View, Readouts: View>: View {
  let frame: WatchFrame
  let muted: Bool
  let ambient: AmbientMode
  let navFocus: Double
  let awayFocus: Double
  let route: WatchRoute?
  let routeStatus: WatchRouteStatus?
  let groupRide: WatchGroupRide?
  let navArrowEnabled: Bool
  let telemetryTrailEnabled: Bool
  let telemetryGroupEnabled: Bool
  let telemetryRouteEnabled: Bool
  let streetMapEnabled: Bool
  let mapGaugesPercent: Int
  let distanceUnit: String
  @ViewBuilder var gauges: () -> Gauges
  @ViewBuilder var readouts: () -> Readouts

  @State private var mapView = WatchMapView(spanM: WatchMapProjection.clampedSpanM(nil), courseDeg: nil)
  @State private var mapMoving = false

  private var scene: WatchMapSceneState {
    WatchMapSceneState(frame: frame, routeId: route?.routeId, routeStatus: routeStatus, group: groupRide,
      ambient: ambient.active, telemetryTrailEnabled: telemetryTrailEnabled, telemetryGroupEnabled: telemetryGroupEnabled,
      telemetryRouteEnabled: telemetryRouteEnabled, streetMapEnabled: streetMapEnabled, mapGaugesPercent: mapGaugesPercent)
  }
  private var navStackAlpha: Double { fadeOut(awayFocus) }
  private var tiltColor: Color { (muted || ambient.active) ? Palette.dimText : Palette.tilt }

  var body: some View {
    ZStack {
      if scene.drawStreetMap {
        MapTileLayer(mapView: mapView, mapMoving: mapMoving)
          .opacity(navStackAlpha * scene.mapAlpha(navFocus: navFocus))
      }

      if scene.hasNavigation, scene.drawMap {
        NavRoute(
          route: route,
          frame: frame,
          mapView: mapView,
          mapMoving: mapMoving,
          focus: navFocus,
          color: muted ? Palette.dimText : Palette.nav
        )
        .opacity(navStackAlpha * scene.routeAlpha(navFocus: navFocus))
      }

      if scene.drawMap {
        RiderTrail(points: frame.trail, mapView: mapView, mapMoving: mapMoving, color: muted ? Palette.dimText : Palette.trail)
          .opacity(navStackAlpha * scene.trailAlpha(navFocus: navFocus))
      }

      if let groupRide, scene.drawMap {
        GroupRideLayer(
          group: groupRide,
          mapView: mapView,
          mapMoving: mapMoving,
          focus: navFocus,
          distanceUnit: distanceUnit
        )
        .opacity(navStackAlpha * scene.groupAlpha(navFocus: navFocus))
      }

      if scene.drawMap {
        RiderPosition(color: muted ? Palette.dimText : Palette.nav,
          loading: scene.notice != nil && scene.notice != .failed && navStackAlpha > 0)
          .opacity(navStackAlpha * scene.riderAlpha(navFocus: navFocus))
      }

      gauges()
      if let routeNotice = scene.notice {
        if !ambient.active, routeNotice == .failed {
          RouteFailureNotice().opacity(navStackAlpha)
        }
      } else if let navigation = scene.navigation {
        NavPointer(
          bearingDeg: navigation.bearingDeg,
          distanceM: navigation.distanceM,
          distanceUnit: distanceUnit,
          focus: navFocus,
          stackAlpha: navStackAlpha,
          arrowEnabled: navArrowEnabled,
          color: (muted || ambient.active) ? Palette.dimText : Palette.nav,
          remoteTilt: frame.remoteTilt,
          tiltColor: tiltColor
        )
      } else {
        VStack(spacing: 0) {
          Spacer(minLength: 0)
          TiltBadge(value: frame.remoteTilt, color: tiltColor)
            .padding(.bottom, NAV_READOUT_BOTTOM_INSET)
        }
        .opacity(navStackAlpha * (1 - navFocus))
      }

      readouts()
      if let groupRide, scene.drawMap {
        GroupRideEdgeLayer(
          group: groupRide, mapView: mapView, mapMoving: mapMoving, focus: navFocus, distanceUnit: distanceUnit
        )
          .opacity(navStackAlpha * scene.groupAlpha(navFocus: navFocus))
      }
    }
    .onAppear { retargetMap(animate: false) }
    .onChange(of: scene.target) { retargetMap(animate: scene.drawMap) }
    .onChange(of: scene.drawMap) { if !scene.drawMap { retargetMap(animate: false) } }
    .task(id: mapView.settlesAt) {
      let remaining = mapView.settlesAt.timeIntervalSinceNow
      if remaining > 0 {
        try? await Task.sleep(for: .seconds(remaining))
        if Task.isCancelled { return }
      }
      mapMoving = false
    }
  }

  private func retargetMap(animate: Bool) {
    let now = Date()
    mapView.retarget(spanM: scene.target.spanM, courseDeg: scene.target.courseDeg, at: now, animate: animate, position: scene.target.position)
    mapMoving = mapView.settlesAt > now
  }

}
