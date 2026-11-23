import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `NavRoute`
/// @platform-diff Wear OS clips the line to the circle its gauges ring, because a round panel's
///   drawing bounds are square and the line would otherwise run out to the bezel. Here the clip is
///   the display's own rounded rectangle, on the rim gauges' guide path (``Rim``), so the route
///   uses the corners the rectangle actually has instead of the circle it does not.
struct NavRoute: View {
  let route: WatchRoute?
  let frame: WatchFrame
  let mapView: WatchMapView
  let mapMoving: Bool
  var focus: Double = 0
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
                lineWidth: ROUTE_WIDTH,
                lineCap: .round,
                lineJoin: .round,
                dash: [0.1, 4.3]
              )
            )
            .clipShape(Rim.path(in: geometry.size, inset: Rim.inset))
          }
        }
      }
    }
  }
}

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
    stroke(circle, with: .color(color), lineWidth: RIDER_RING_WIDTH)
  }
}

private struct RouteShape: Shape {
  let route: WatchRoute
  let eastM: Double
  let northM: Double
  let courseDeg: Double
  let spanM: Double

  func path(in rect: CGRect) -> Path {
    guard route.points.count > 1, spanM > 0 else { return Path() }
    let centre = WatchMapProjection.riderPoint(in: rect.size)
    let scale = WatchMapProjection.pointsPerMetre(size: rect.size, spanM: spanM)

    var path = Path()
    for (index, point) in route.points.enumerated() {
      let screen = CGPoint(
        x: centre.x + (point.eastM - eastM) * scale,
        y: centre.y - (point.northM - northM) * scale
      )
      if index == 0 { path.move(to: screen) } else { path.addLine(to: screen) }
    }
    return path.applying(
      CGAffineTransform(translationX: centre.x, y: centre.y)
        .rotated(by: -courseDeg * .pi / 180)
        .translatedBy(x: -centre.x, y: -centre.y)
    )
  }
}

private let ROUTE_WIDTH: CGFloat = 2.5
private let ROUTE_ALPHA = 0.55
private let ROUTE_FOCUS_ALPHA = 0.85
private let RIDER_DOT_RADIUS: CGFloat = 4
private let RIDER_RING_WIDTH: CGFloat = 2
