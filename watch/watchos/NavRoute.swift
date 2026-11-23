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
          let sections = splitRoute(route.points, remainingM: frame.navDistanceM)
          TimelineView(.animation(paused: !mapMoving)) { timeline in
            let at = mapMoving ? timeline.date : .distantFuture
            let offset = mapView.motion.offset(at: at)
            let alpha = ROUTE_ALPHA + (ROUTE_FOCUS_ALPHA - ROUTE_ALPHA) * focus
            Canvas { context, size in
              func path(_ points: [WatchRoutePoint]) -> Path {
                RouteShape(
                  points: points,
                  eastM: east - offset.eastM,
                  northM: north - offset.northM,
                  courseDeg: mapView.courseDeg(at: at),
                  spanM: mapView.spanM(at: at)
                ).path(in: CGRect(origin: .zero, size: size))
              }
              let stroke = StrokeStyle(lineWidth: ROUTE_WIDTH, lineCap: .round, lineJoin: .round, dash: [0.1, 4.3])
              context.stroke(path(sections.passed), with: .color(color.opacity(alpha * PASSED_ALPHA)), style: stroke)
              context.stroke(path(sections.remaining), with: .color(color.opacity(alpha)), style: stroke)
            }
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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `splitRoute`
private func splitRoute(
  _ points: [WatchRoutePoint], remainingM: Double?
) -> (passed: [WatchRoutePoint], remaining: [WatchRoutePoint]) {
  guard let remainingM, remainingM.isFinite else { return ([], points) }
  guard remainingM > 0 else { return (points, []) }
  var distanceM = remainingM
  for index in points.indices.dropFirst().reversed() {
    let from = points[index - 1]
    let to = points[index]
    let eastM = to.eastM - from.eastM
    let northM = to.northM - from.northM
    let lengthM = hypot(eastM, northM)
    if distanceM < lengthM {
      let fraction = 1 - distanceM / lengthM
      let split = WatchRoutePoint(eastM: from.eastM + eastM * fraction, northM: from.northM + northM * fraction)
      return (Array(points[..<index]) + [split], [split] + Array(points[index...]))
    }
    distanceM -= lengthM
  }
  return ([], points)
}

private struct RouteShape: Shape {
  let points: [WatchRoutePoint]
  let eastM: Double
  let northM: Double
  let courseDeg: Double
  let spanM: Double

  func path(in rect: CGRect) -> Path {
    guard points.count > 1, spanM > 0 else { return Path() }
    let centre = WatchMapProjection.riderPoint(in: rect.size)
    let scale = WatchMapProjection.pointsPerMetre(size: rect.size, spanM: spanM)

    var path = Path()
    for (index, point) in points.enumerated() {
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
private let PASSED_ALPHA = 0.2
private let RIDER_DOT_RADIUS: CGFloat = 4
private let RIDER_RING_WIDTH: CGFloat = 2
