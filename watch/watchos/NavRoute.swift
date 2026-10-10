import SwiftUI

/// Route polyline under the gauges, drawn heading-up with the rider pinned near the watch centre.
/// Sits at the bottom of the frame's layer stack so gauges, readouts and the nav chevron draw over
/// it.
///
/// One source: the real polyline the phone pushed on the route channel, placed by the frame's rider
/// lanes. Until those arrive — a route pushed but no fix yet — only the rider dot draws, so the
/// wrist never shows a line the rider is not actually on.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `NavRoute`
/// @platform-diff Wear OS clips the line to the circle its gauges ring, because a round panel's
///   drawing bounds are square and the line would otherwise run out to the bezel. Here the clip is
///   the display's own rounded rectangle, on the rim gauges' guide path (``Rim``), so the route
///   uses the corners the rectangle actually has instead of the circle it does not.
struct NavRoute: View {
  let route: WatchRoute?
  let frame: WatchFrame
  /// The map's eased zoom and course, shared with the Group Ride marks so a Rider on the route
  /// stays on it mid-zoom and mid-turn. `mapMoving` runs the timeline only while it eases.
  let mapView: WatchMapView
  let mapMoving: Bool
  /// Nav-focus progress: the line thickens and brightens as the nav page takes the screen, where it
  /// is the whole page and has to read in daylight.
  var focus: Double = 0
  /// The nav accent already resolved by the caller — the rider's colour, dimmed when the frame is
  /// stale. Resolved outside so the route, the chevron and the rider dot cannot disagree.
  var color: Color

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        if let route, let east = frame.riderEastM, let north = frame.riderNorthM {
          TimelineView(.animation(paused: !mapMoving)) { timeline in
            let at = mapMoving ? timeline.date : .distantFuture
            let offset = mapView.motion.offset(at: at)
            RouteShape(
              route: route,
              eastM: east - offset.eastM,
              northM: north - offset.northM,
              courseDeg: mapView.courseDeg(at: at),
              spanM: mapView.spanM(at: at)
            )
            .stroke(
              color.opacity(ROUTE_ALPHA + (ROUTE_FOCUS_ALPHA - ROUTE_ALPHA) * focus),
              style: StrokeStyle(
                lineWidth: ROUTE_WIDTH + (ROUTE_FOCUS_WIDTH - ROUTE_WIDTH) * focus,
                lineCap: .round,
                lineJoin: .round
              )
            )
            // A route runs for kilometres; without this it reaches past the display and draws over
            // the rim gauges. On the gauge guides' own path, so the line at least touches them
            // instead of stopping visibly short of the ring.
            .clipShape(Rim.path(in: geometry.size, inset: Rim.inset))
          }
        }
      }
    }
  }
}

/// "You are here": a ring in the route's own colour, punched out to black so whatever passes under
/// it never reads as passing through the rider.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `drawRiderDot`
extension GraphicsContext {
  func drawRiderDot(at centre: CGPoint, color: Color) {
    let circle = Path(
      ellipseIn: CGRect(
        x: centre.x - RIDER_DOT_RADIUS, y: centre.y - RIDER_DOT_RADIUS,
        width: RIDER_DOT_RADIUS * 2, height: RIDER_DOT_RADIUS * 2
      )
    )
    fill(circle, with: .color(.black))
    stroke(circle, with: .color(color), lineWidth: ROUTE_WIDTH)
  }
}

/// The polyline in screen space: route points are metres east/north of the route origin, placed
/// around the rider and rotated heading-up.
///
/// Translation, course and zoom arrive already interpolated by the shared map.
private struct RouteShape: Shape {
  let route: WatchRoute
  let eastM: Double
  let northM: Double
  let courseDeg: Double
  let spanM: Double

  func path(in rect: CGRect) -> Path {
    guard route.points.count > 1, spanM > 0 else { return Path() }
    // Rider sits below the centre so more of the display is "ahead" than behind.
    let centre = WatchMapProjection.riderPoint(in: rect.size)
    let scale = WatchMapProjection.pointsPerMetre(size: rect.size, spanM: spanM)

    var path = Path()
    for (index, point) in route.points.enumerated() {
      let screen = CGPoint(
        x: centre.x + (point.eastM - eastM) * scale,
        // Screen y grows downward; north is up.
        y: centre.y - (point.northM - northM) * scale
      )
      if index == 0 { path.move(to: screen) } else { path.addLine(to: screen) }
    }
    // Heading-up: the world rotates under a rider who always points at the top of the display.
    return path.applying(
      CGAffineTransform(translationX: centre.x, y: centre.y)
        .rotated(by: -courseDeg * .pi / 180)
        .translatedBy(x: -centre.x, y: -centre.y)
    )
  }
}

private let ROUTE_WIDTH: CGFloat = 2
/// Width and opacity on the nav page, where the line is the page and has to read in daylight.
private let ROUTE_FOCUS_WIDTH: CGFloat = 3.5
private let ROUTE_ALPHA = 0.55
private let ROUTE_FOCUS_ALPHA = 0.85
private let RIDER_DOT_RADIUS: CGFloat = 4
