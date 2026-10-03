import SwiftUI

/// Owns map policy, the shared camera and drawing order. Gauge and readout slots keep telemetry
/// layout independent of Navigation, Group Ride and standalone trail rendering.
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
  let navColor: Color
  let trailColor: Color
  let navArrowEnabled: Bool
  let telemetryTrailEnabled: Bool
  let unitSystem: String
  @ViewBuilder var gauges: () -> Gauges
  @ViewBuilder var readouts: () -> Readouts

  @State private var mapView = WatchMapView(spanM: WatchMapProjection.clampedSpanM(nil), courseDeg: nil)
  @State private var mapMoving = false

  private var scene: WatchMapSceneState {
    WatchMapSceneState(frame: frame, routeId: route?.routeId, routeStatus: routeStatus, group: groupRide,
      ambient: ambient.active, telemetryTrailEnabled: telemetryTrailEnabled)
  }
  private var navStackAlpha: Double { fadeOut(awayFocus) }
  private var tiltColor: Color { (muted || ambient.active) ? Palette.dimText : Palette.tilt }

  var body: some View {
    ZStack {
      // Bottom layer: the route ahead and the rider on it, under every gauge and readout. Ambient
      // skips it — the lanes animate their zoom, and a moving map is the most expensive thing the
      // always-on panel could be asked to draw.
      if scene.hasNavigation, scene.drawMap {
        NavRoute(
          route: route,
          frame: frame,
          mapView: mapView,
          mapMoving: mapMoving,
          focus: navFocus,
          color: muted ? Palette.dimText : navColor
        )
        .opacity(navStackAlpha)
      }

      if scene.drawMap {
        RiderTrail(points: frame.trail, mapView: mapView, mapMoving: mapMoving, color: muted ? Palette.dimText : trailColor)
          .opacity(navStackAlpha * scene.trailAlpha(navFocus: navFocus))
      }

      // Group Ride dots: over the paths, under every gauge and number. Hidden in ambient.
      if let groupRide, scene.drawMap {
        GroupRideLayer(
          group: groupRide,
          mapView: mapView,
          mapMoving: mapMoving,
          focus: navFocus,
          unitSystem: unitSystem
        )
        .opacity(navStackAlpha)
      }

      if scene.drawMap {
        RiderPosition(color: muted ? Palette.dimText : navColor,
          loading: scene.notice != nil && scene.notice != .failed && navStackAlpha > 0)
          .opacity(navStackAlpha)
      }

      gauges()
      // Navigation, only while the phone is sending it. No destination means no nav lanes, and the
      // frame renders exactly as it would without this slice.
      if let routeNotice = scene.notice {
        if !ambient.active, routeNotice == .failed {
          RouteFailureNotice().opacity(navStackAlpha)
        }
      } else if let navigation = scene.navigation {
        NavPointer(
          bearingDeg: navigation.bearingDeg,
          distanceM: navigation.distanceM,
          unitSystem: unitSystem,
          focus: navFocus,
          stackAlpha: navStackAlpha,
          arrowEnabled: navArrowEnabled,
          color: (muted || ambient.active) ? Palette.dimText : navColor,
          remoteTilt: frame.remoteTilt,
          tiltColor: tiltColor
        )
      } else {
        // Nav focus with nothing to show would be a blank rectangle. Say why, but only once the
        // drag is nearly done, so it never flickers under the departing readouts.
        // A joined Group Ride is something to show on the map page: no "no navigation" over it.
        if scene.showAbsentHint {
          NavAbsentHint(focus: navFocus, stackAlpha: navStackAlpha)
        }
        // No navigation: the tilt badge keeps the distance's slot to itself.
        VStack(spacing: 0) {
          Spacer(minLength: 0)
          TiltBadge(value: frame.remoteTilt, color: tiltColor)
            .padding(.bottom, NAV_READOUT_BOTTOM_INSET)
        }
        .opacity(navStackAlpha * (1 - navFocus))
      }

      readouts()
      // Group Ride edge triangles: over the rim gauges. Hidden in ambient.
      if let groupRide, scene.drawMap {
        GroupRideEdgeLayer(
          group: groupRide, mapView: mapView, mapMoving: mapMoving, focus: navFocus, unitSystem: unitSystem
        )
          .opacity(navStackAlpha)
      }
    }
    .onAppear { retargetMap(animate: false) }
    .onChange(of: scene.target) { retargetMap(animate: scene.drawMap) }
    // Ambient lands a map mid-ease, as Wear's relaunched effect does.
    .onChange(of: scene.drawMap) { if !scene.drawMap { retargetMap(animate: false) } }
    // Stops the layers' timelines once the map has landed, so a still map never redraws.
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
