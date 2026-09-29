import SwiftUI

/// Every other Rider who fits on the nav map, as a dot in their colour, over the route and under the
/// gauges. Without Navigation there is no route to carry the Rider's own ring, so this draws it at
/// the same spot. Riders beyond the map are `GroupRideEdgeLayer`'s.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideLayer`
struct GroupRideLayer: View {
  let group: WatchGroupRide
  let drawOwnRing: Bool
  let ownColor: Color
  /// Nav-focus progress: the dots grow as the nav page takes the screen.
  var focus: Double = 0

  var body: some View {
    StalePulse(group: group) { context, size, staleOpacity in
      let map = WatchMapProjection(size: size, spanM: group.spanM, courseDeg: group.courseDeg)
      if drawOwnRing { context.drawRiderDot(at: map.rider, color: ownColor) }
      for mark in map.marks(for: group.riders, sizes: groupRideMarkSizes(size: size, focus: focus)) where mark.kind == .dot {
        let opacity = mark.rider.stale ? staleOpacity : 1
        context.fill(circle(mark.point, mark.size + GROUP_OUTLINE), with: .color(GROUP_OUTLINE_COLOR.opacity(opacity)))
        context.fill(circle(mark.point, mark.size), with: .color(Color(argb: mark.rider.colorArgb).opacity(opacity)))
      }
    }
  }

  private func circle(_ centre: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
  }
}

/// Every Rider beyond the nav map, as a triangle in their colour on the display edge, apex inward.
/// Drawn over the rim gauges, so the caller layers it above them. Hidden in ambient like the dots.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideEdgeLayer`
struct GroupRideEdgeLayer: View {
  let group: WatchGroupRide

  var body: some View {
    StalePulse(group: group) { context, size, staleOpacity in
      let map = WatchMapProjection(size: size, spanM: group.spanM, courseDeg: group.courseDeg)
      for mark in map.marks(for: group.riders, sizes: groupRideMarkSizes(size: size, focus: 0)) where mark.kind == .triangle {
        let opacity = mark.rider.stale ? staleOpacity : 1
        let path = triangle(mark)
        context.stroke(
          path, with: .color(GROUP_OUTLINE_COLOR.opacity(opacity)),
          style: StrokeStyle(lineWidth: GROUP_OUTLINE * 2, lineJoin: .round)
        )
        context.fill(path, with: .color(Color(argb: mark.rider.colorArgb).opacity(opacity)))
      }
    }
  }

  /// Base centred on the edge, apex inward, thin dark outline under the fill so it reads over the rim.
  private func triangle(_ mark: WatchGroupRideMark) -> Path {
    let out = mark.direction
    let side = CGVector(dx: -out.dy * mark.size * GROUP_TRIANGLE_BASE / 2, dy: out.dx * mark.size * GROUP_TRIANGLE_BASE / 2)
    var path = Path()
    path.move(to: CGPoint(x: mark.point.x + side.dx, y: mark.point.y + side.dy))
    path.addLine(to: CGPoint(x: mark.point.x - side.dx, y: mark.point.y - side.dy))
    path.addLine(to: CGPoint(x: mark.point.x - out.dx * mark.size, y: mark.point.y - out.dy * mark.size))
    path.closeSubpath()
    return path
  }
}

/// Mark sizes on a display of `size`; dots grow towards the nav page, where the map is the page.
func groupRideMarkSizes(size: CGSize, focus: Double) -> WatchGroupRideMarkSizes {
  WatchGroupRideMarkSizes(
    inRangeMargin: GROUP_IN_RANGE_MARGIN,
    edgeInset: GROUP_EDGE_INSET,
    edgeCornerRadius: Rim.Metrics(size: size, inset: GROUP_EDGE_INSET).radius,
    dotRadius: GROUP_DOT_RADIUS + (GROUP_FOCUS_DOT_RADIUS - GROUP_DOT_RADIUS) * min(max(focus, 0), 1),
    triangleMin: GROUP_TRIANGLE_MIN,
    triangleMax: GROUP_TRIANGLE_MAX
  )
}

/// A canvas handed a stale Rider's opacity. Its timeline runs only while `group` has a stale Rider;
/// the caller draws nothing in ambient, so ambient never animates. Both layers take their phase from
/// the same clock, so a stale dot and a stale triangle pulse together.
private struct StalePulse: View {
  let group: WatchGroupRide
  let draw: (inout GraphicsContext, CGSize, Double) -> Void

  var body: some View {
    TimelineView(.animation(paused: !group.riders.contains(where: \.stale))) { timeline in
      let opacity = staleOpacity(at: timeline.date)
      Canvas { context, size in draw(&context, size, opacity) }
    }
    .allowsHitTesting(false)
  }
}

/// Opacity `GROUP_STALE_MAX_OPACITY` → `GROUP_STALE_MIN_OPACITY` and back, `GROUP_STALE_PULSE_SECONDS`
/// each way.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `staleAlpha`
private func staleOpacity(at date: Date) -> Double {
  let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: GROUP_STALE_PULSE_SECONDS * 2)
    / GROUP_STALE_PULSE_SECONDS
  let t = phase <= 1 ? phase : 2 - phase
  return GROUP_STALE_MAX_OPACITY + (GROUP_STALE_MIN_OPACITY - GROUP_STALE_MAX_OPACITY) * t
}

private extension Color {
  init(argb: UInt32) {
    self.init(
      .sRGB,
      red: Double((argb >> 16) & 0xFF) / 255,
      green: Double((argb >> 8) & 0xFF) / 255,
      blue: Double(argb & 0xFF) / 255,
      opacity: Double((argb >> 24) & 0xFF) / 255
    )
  }
}

/// Dots stay this far inside the display edge, clear of the rim gauges.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GROUP_IN_RANGE_MARGIN`
private let GROUP_IN_RANGE_MARGIN: CGFloat = 38
private let GROUP_DOT_RADIUS: CGFloat = 3
/// On the nav page, where the map is the page.
private let GROUP_FOCUS_DOT_RADIUS: CGFloat = 4.5
/// Triangle bases sit in the outermost points, over the rim gauges.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GROUP_EDGE_INSET`
private let GROUP_EDGE_INSET: CGFloat = 1
private let GROUP_TRIANGLE_MIN: CGFloat = 7
private let GROUP_TRIANGLE_MAX: CGFloat = 12
/// Triangle base width as a share of its length.
private let GROUP_TRIANGLE_BASE: CGFloat = 0.9
private let GROUP_OUTLINE: CGFloat = 0.75
private let GROUP_OUTLINE_COLOR = Color.black.opacity(0.9)
/// A Rider the phone has not heard from for a while: last known place, faded and pulsing.
private let GROUP_STALE_MAX_OPACITY = 0.7
private let GROUP_STALE_MIN_OPACITY = 0.2
private let GROUP_STALE_PULSE_SECONDS = 0.7
