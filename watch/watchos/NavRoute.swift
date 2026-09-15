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
///   the display's own rounded rectangle, one step inside the rim gauges (``Rim``), so the route
///   uses the corners the rectangle actually has instead of the circle it does not.
struct NavRoute: View {
  let route: WatchRoute?
  /// Bumped by ``PhoneLink`` on every route change, so the motion animators reset with the origin
  /// they are measured against rather than gliding across a jump that never happened.
  let generation: Int
  let frame: WatchFrame
  /// Nav-focus progress: the line thickens and brightens as the nav page takes the screen, where it
  /// is the whole page and has to read in daylight.
  var focus: Double = 0
  /// The nav accent already resolved by the caller — the rider's colour, dimmed when the frame is
  /// stale. Resolved outside so the route, the chevron and the rider dot cannot disagree.
  var color: Color

  /// Course as an unwrapped angle, so a heading crossing north turns the short way instead of
  /// spinning 359° back around the compass.
  @State private var unwrappedCourse: Double = 0

  var body: some View {
    GeometryReader { geometry in
      let centre = CGPoint(
        x: geometry.size.width / 2,
        y: geometry.size.height / 2 + RIDER_DROP
      )
      ZStack {
        if let route, let east = frame.riderEastM, let north = frame.riderNorthM {
          RouteShape(
            route: route,
            eastM: east,
            northM: north,
            courseDeg: unwrappedCourse,
            spanM: clampedSpan
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
          // the rim gauges. One step inside them, so the line stops just short of the gauge lines.
          .clipShape(Rim.path(in: geometry.size, inset: Rim.innerInset))
          .animation(.linear(duration: ROUTE_MOTION_EASE), value: east)
          .animation(.linear(duration: ROUTE_MOTION_EASE), value: north)
          .animation(.linear(duration: ROUTE_MOTION_EASE), value: unwrappedCourse)
          .animation(.easeInOut(duration: ROUTE_ZOOM_EASE), value: clampedSpan)
          // Offsets are metres from *this* route's origin. A new route moves the origin, so the
          // animators would glide the rider across a jump that never happened: a new generation is
          // a new view identity, which starts them from the new route's own numbers.
          .id(generation)
        }
        Canvas { context, _ in context.drawRiderDot(at: centre, color: color) }
      }
      .onChange(of: frame.courseDeg ?? 0) { _, next in
        unwrappedCourse += shortestAngleDelta(from: unwrappedCourse, to: next)
      }
      .onAppear { unwrappedCourse = frame.courseDeg ?? 0 }
    }
  }

  private var clampedSpan: Double {
    min(MAX_ROUTE_SPAN_M, max(MIN_ROUTE_SPAN_M, frame.routeSpanM ?? DEFAULT_ROUTE_SPAN_M))
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
/// A `Shape` rather than a `Canvas` for one reason: the rider's position, the course and the zoom
/// all move continuously, and a shape's `animatableData` is what interpolates them between frames.
/// Drawing the same geometry in a canvas would jump once per push.
private struct RouteShape: Shape {
  let route: WatchRoute
  var eastM: Double
  var northM: Double
  var courseDeg: Double
  var spanM: Double

  var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>> {
    get { AnimatablePair(AnimatablePair(eastM, northM), AnimatablePair(courseDeg, spanM)) }
    set {
      eastM = newValue.first.first
      northM = newValue.first.second
      courseDeg = newValue.second.first
      spanM = newValue.second.second
    }
  }

  func path(in rect: CGRect) -> Path {
    guard route.points.count > 1, spanM > 0 else { return Path() }
    // Rider sits below the centre so more of the display is "ahead" than behind.
    let centre = CGPoint(x: rect.midX, y: rect.midY + RIDER_DROP)
    let scale = (min(rect.width, rect.height) - ROUTE_EDGE_INSET) / spanM

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

/// Shortest turn between two compass headings, in degrees, signed.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `shortestAngleDelta`
func shortestAngleDelta(from: Double, to: Double) -> Double {
  (((to - from + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)) - 180
}

/// Fallback metres of route across the display until the phone publishes its camera span.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `DEFAULT_ROUTE_SPAN_M`
private let DEFAULT_ROUTE_SPAN_M = 600.0
private let MIN_ROUTE_SPAN_M = 150.0
private let MAX_ROUTE_SPAN_M = 2_000.0
private let ROUTE_ZOOM_EASE = 0.35
private let ROUTE_MOTION_EASE = 0.3

private let ROUTE_EDGE_INSET: CGFloat = 24
private let ROUTE_WIDTH: CGFloat = 2
/// Width and opacity on the nav page, where the line is the page and has to read in daylight.
private let ROUTE_FOCUS_WIDTH: CGFloat = 3.5
private let ROUTE_ALPHA = 0.55
private let ROUTE_FOCUS_ALPHA = 0.85
private let RIDER_DOT_RADIUS: CGFloat = 4
private let RIDER_DROP: CGFloat = 34
