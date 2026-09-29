import SwiftUI

/// Every other Rider who fits on the nav map, as a dot in their colour, over the route and under the
/// gauges. Without Navigation there is no route to carry the Rider's own ring, so this draws it at
/// the same spot. Riders beyond the map are not drawn here.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideLayer`
struct GroupRideLayer: View {
  let group: WatchGroupRide
  let drawOwnRing: Bool
  let ownColor: Color
  /// Nav-focus progress: the dots grow as the nav page takes the screen.
  var focus: Double = 0

  var body: some View {
    Canvas { context, size in
      let map = WatchMapProjection(size: size, spanM: group.spanM, courseDeg: group.courseDeg)
      if drawOwnRing { context.drawRiderDot(at: map.rider, color: ownColor) }
      let radius = GROUP_DOT_RADIUS + (GROUP_FOCUS_DOT_RADIUS - GROUP_DOT_RADIUS) * focus
      // Far first, so a close Rider lands on top at a similar bearing.
      for rider in group.riders.sorted(by: { $0.distanceM > $1.distanceM }) {
        let placed = map.place(eastM: rider.eastM, northM: rider.northM, margin: GROUP_IN_RANGE_MARGIN)
        guard placed.inRange else { continue }
        let opacity = rider.stale ? GROUP_STALE_OPACITY : 1
        context.fill(circle(placed.point, radius + GROUP_DOT_OUTLINE), with: .color(.black.opacity(0.9 * opacity)))
        context.fill(circle(placed.point, radius), with: .color(Color(argb: rider.colorArgb).opacity(opacity)))
      }
    }
    .allowsHitTesting(false)
  }

  private func circle(_ centre: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
  }
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

/// Dots stay this far inside the display's shorter half, clear of the rim gauges.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GROUP_IN_RANGE_MARGIN`
private let GROUP_IN_RANGE_MARGIN: CGFloat = 38
private let GROUP_DOT_RADIUS: CGFloat = 3
/// On the nav page, where the map is the page.
private let GROUP_FOCUS_DOT_RADIUS: CGFloat = 4.5
private let GROUP_DOT_OUTLINE: CGFloat = 0.75
/// A Rider the phone has not heard from for a while: last known place, faded.
private let GROUP_STALE_OPACITY = 0.45
