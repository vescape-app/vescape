import CoreGraphics
import Foundation

/// The nav route's heading-up projection, in points: the Rider sits `riderDrop` below the display
/// centre, their course points up, and the clamped span of metres fits the display's shorter side
/// minus `edgeInset`. The route line and the Group Ride marks share it, so a Rider on the route is
/// drawn on it.
///
/// Shared with the wrist (`watch/watchos/` symlinks this file) so the placement math is tested here.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `HeadingUpMap`
struct WatchMapProjection {
  /// The Rider sits this far below the centre, so more of the map is ahead than behind.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `RIDER_DROP`
  static let riderDrop: CGFloat = 34
  /// Display margin the map's span is fitted inside.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `ROUTE_EDGE_INSET`
  static let edgeInset: CGFloat = 24
  /// Fallback metres across the display until the phone publishes its camera span.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `DEFAULT_ROUTE_SPAN_M`
  static let defaultSpanM = 600.0
  static let minSpanM = 150.0
  static let maxSpanM = 2_000.0

  /// The phone map's span, clamped to what a wrist can draw, or the fallback.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `clampRouteSpanM`
  static func clampedSpanM(_ spanM: Double?) -> Double {
    min(maxSpanM, max(minSpanM, spanM ?? defaultSpanM))
  }

  let size: CGSize
  let courseDeg: Double
  private let scale: Double

  init(size: CGSize, spanM: Double?, courseDeg: Double) {
    self.size = size
    self.courseDeg = courseDeg
    scale = (min(size.width, size.height) - Self.edgeInset) / Self.clampedSpanM(spanM)
  }

  var centre: CGPoint { CGPoint(x: size.width / 2, y: size.height / 2) }
  var rider: CGPoint { CGPoint(x: centre.x, y: centre.y + Self.riderDrop) }
  /// Place a point `eastM`/`northM` metres from the Rider. In range = inside the display inset by
  /// `margin` on every side.
  ///
  /// @platform-diff Wear OS measures range against the round face's circle. The Apple Watch display
  ///   is a rectangle and the route already runs into its corners, so a Rider there is in range too.
  func place(eastM: Double, northM: Double, margin: CGFloat) -> WatchMapPlacement {
    let rad = relativeBearingDeg(eastM: eastM, northM: northM, courseDeg: courseDeg) * .pi / 180
    let direction = CGVector(dx: sin(rad), dy: -cos(rad))
    let reach = (eastM * eastM + northM * northM).squareRoot() * scale
    let point = CGPoint(x: rider.x + direction.dx * reach, y: rider.y + direction.dy * reach)
    let inRange = abs(point.x - centre.x) <= size.width / 2 - margin
      && abs(point.y - centre.y) <= size.height / 2 - margin
    return WatchMapPlacement(point: point, direction: direction, inRange: inRange)
  }

  /// Where the ray from the Rider (not the display centre) along unit `direction` leaves the
  /// display, `inset` inside its edge, whose corners are rounded by `cornerRadius`.
  ///
  /// @platform-diff Wear OS meets its round face's circle. The Apple Watch display is a rounded
  ///   rectangle, so the triangle lands on it and stands square to the straight edge or corner arc.
  func edgePoint(direction: CGVector, inset: CGFloat, cornerRadius: CGFloat) -> WatchEdgePoint {
    let bounds = CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset)
    let exit = rayExit(direction: direction, rect: bounds, cornerRadius: cornerRadius)
    let point = CGPoint(x: rider.x + direction.dx * exit.distance, y: rider.y + direction.dy * exit.distance)
    return WatchEdgePoint(point: point, outward: exit.normal)
  }

  /// `rider`'s mark: a dot on the map while in range, else a triangle on the display edge along the
  /// ray from the Rider, longer the closer they are. A stale Rider's triangle is the shortest.
  func mark(for rider: GroupRideFrameRider, sizes: WatchGroupRideMarkSizes) -> WatchGroupRideMark {
    let placed = place(eastM: rider.eastM, northM: rider.northM, margin: sizes.inRangeMargin)
    if placed.inRange {
      return WatchGroupRideMark(
        rider: rider, kind: .dot, point: placed.point, direction: placed.direction, size: sizes.dotRadius
      )
    }
    let edge = edgePoint(direction: placed.direction, inset: sizes.edgeInset, cornerRadius: sizes.edgeCornerRadius)
    let length: CGFloat
    if rider.stale {
      length = sizes.triangleMin
    } else {
      // In range is the display's rectangle less the margin, square-cornered.
      let inRange = CGRect(origin: .zero, size: size).insetBy(dx: sizes.inRangeMargin, dy: sizes.inRangeMargin)
      let boundaryM = Double(rayExit(direction: placed.direction, rect: inRange, cornerRadius: 0).distance) / scale
      length = edgeTriangleLength(
        distanceM: rider.distanceM, boundaryM: boundaryM, min: sizes.triangleMin, max: sizes.triangleMax
      )
    }
    return WatchGroupRideMark(rider: rider, kind: .triangle, point: edge.point, direction: edge.outward, size: length)
  }

  /// Every Rider's mark, farthest first, so a close Rider lands on top at a similar bearing.
  func marks(for riders: [GroupRideFrameRider], sizes: WatchGroupRideMarkSizes) -> [WatchGroupRideMark] {
    riders.sorted { $0.distanceM > $1.distanceM }.map { mark(for: $0, sizes: sizes) }
  }

  /// Top-left of a `labelSize` label for `mark`: beside a dot on the side away from the Rider, `gap`
  /// clear of it and of its flag ring when it wears one (`ring` further out); inward of a triangle's
  /// apex by `gap`. Then `clearOfNavReadout`.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `labelTopLeft`
  func labelOrigin(
    for mark: WatchGroupRideMark, labelSize: CGSize, gap: CGFloat, ring: CGFloat, navFocus: Double
  ) -> CGPoint {
    let width = labelSize.width
    let height = labelSize.height
    let origin: CGPoint
    switch mark.kind {
    case .dot:
      let ringed = !mark.rider.stale && mark.rider.flagLevel != .normal
      let reach = mark.size + (ringed ? ring : 0) + gap
      let x = mark.point.x >= rider.x ? mark.point.x + reach : mark.point.x - reach - width
      origin = CGPoint(x: x, y: mark.point.y - height / 2)
    case .triangle:
      // Inward along the edge normal, far enough that the box's own half-extent clears the apex.
      let inward = CGVector(dx: -mark.direction.dx, dy: -mark.direction.dy)
      let extent = min(
        abs(inward.dx) > 1e-3 ? width / 2 / abs(inward.dx) : .greatestFiniteMagnitude,
        abs(inward.dy) > 1e-3 ? height / 2 / abs(inward.dy) : .greatestFiniteMagnitude
      )
      let reach = mark.size + gap + extent
      origin = CGPoint(
        x: mark.point.x + inward.dx * reach - width / 2,
        y: mark.point.y + inward.dy * reach - height / 2
      )
    }
    return CGPoint(
      x: origin.x,
      y: clearOfNavReadout(origin: origin, labelSize: labelSize, navFocus: navFocus, displaySize: size)
    )
  }

  /// Points along unit `direction` from the Rider to where the ray leaves `rect` with corners
  /// rounded by `cornerRadius`, and the outward normal there. Straight edges first, then the corner
  /// arc: a ray leaving the box inside a corner square leaves the shape through that corner's circle.
  private func rayExit(direction: CGVector, rect: CGRect, cornerRadius: CGFloat) -> (distance: CGFloat, normal: CGVector) {
    let from = rider
    let tx = direction.dx > 0 ? (rect.maxX - from.x) / direction.dx
      : direction.dx < 0 ? (rect.minX - from.x) / direction.dx : .greatestFiniteMagnitude
    let ty = direction.dy > 0 ? (rect.maxY - from.y) / direction.dy
      : direction.dy < 0 ? (rect.minY - from.y) / direction.dy : .greatestFiniteMagnitude
    let distance = min(tx, ty)
    let straight = tx < ty
      ? CGVector(dx: direction.dx > 0 ? 1 : -1, dy: 0)
      : CGVector(dx: 0, dy: direction.dy > 0 ? 1 : -1)
    let hit = CGPoint(x: from.x + direction.dx * distance, y: from.y + direction.dy * distance)
    let radius = min(cornerRadius, rect.width / 2, rect.height / 2)
    guard radius > 0 else { return (distance, straight) }
    let corner = CGPoint(
      x: min(max(hit.x, rect.minX + radius), rect.maxX - radius),
      y: min(max(hit.y, rect.minY + radius), rect.maxY - radius)
    )
    guard corner.x != hit.x, corner.y != hit.y else { return (distance, straight) }
    let offset = CGVector(dx: from.x - corner.x, dy: from.y - corner.y)
    let half = offset.dx * direction.dx + offset.dy * direction.dy
    let outside = offset.dx * offset.dx + offset.dy * offset.dy - radius * radius
    let arc = -half + max(half * half - outside, 0).squareRoot()
    let onArc = CGPoint(x: from.x + direction.dx * arc, y: from.y + direction.dy * arc)
    return (arc, CGVector(dx: (onArc.x - corner.x) / radius, dy: (onArc.y - corner.y) / radius))
  }
}

/// A point on the display edge; `outward` is the unit outward normal there.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `EdgePoint`
struct WatchEdgePoint: Equatable {
  let point: CGPoint
  let outward: CGVector
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideMarkKind`
enum WatchGroupRideMarkKind: Equatable {
  case dot
  case triangle
}

/// Where and how one Rider is drawn. A dot centres on `point` with radius `size`, and `direction` is
/// the ray from the Rider. A triangle's base centre is `point` on the display edge, `direction` the
/// outward normal, `size` its length: the apex sits at point − direction × size.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideMark`
struct WatchGroupRideMark: Equatable {
  let rider: GroupRideFrameRider
  let kind: WatchGroupRideMarkKind
  let point: CGPoint
  let direction: CGVector
  let size: CGFloat
}

/// The point measures `WatchMapProjection.mark` needs.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideMarkSizes`
struct WatchGroupRideMarkSizes {
  /// Dots stay this far inside the display edge, clear of the rim gauges.
  var inRangeMargin: CGFloat
  /// Triangle bases sit this far inside the display edge.
  var edgeInset: CGFloat
  /// The display's corner rounding at `edgeInset`.
  var edgeCornerRadius: CGFloat
  var dotRadius: CGFloat
  var triangleMin: CGFloat
  var triangleMax: CGFloat
}

/// A far Rider's triangle length: `max` right at the in-range `boundaryM` on their ray, `min` at
/// `GROUP_FAR_M` or beyond, log-scaled between.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `edgeTriangleLength`
func edgeTriangleLength(distanceM: Double, boundaryM: Double, min minLength: CGFloat, max maxLength: CGFloat) -> CGFloat {
  let near = Swift.min(Swift.max(boundaryM, 1), GROUP_FAR_M - 1)
  let t = log(Swift.max(distanceM, near) / near) / log(GROUP_FAR_M / near)
  return minLength + (maxLength - minLength) * CGFloat(Swift.min(Swift.max(1 - t, 0), 1))
}

/// A Rider's compact distance: "680m", "2.1km" in the Rider's units. The wrist's own distance
/// formatting without the space, so the label stays short beside its mark.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `groupRideDistanceLabel`
func groupRideDistanceLabel(_ distanceM: Double, unitSystem: String) -> String {
  UnitPresentation.distance(distanceM, unitSystem: unitSystem).replacingOccurrences(of: " ", with: "")
}

/// The label's top, slid up until the box clears the nav distance readout. The readout drops and
/// grows with `navFocus`; at full focus it spans about x 29–71% and y 82–94% of the display.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `clearOfNavReadout`
func clearOfNavReadout(origin: CGPoint, labelSize: CGSize, navFocus: Double, displaySize: CGSize) -> CGFloat {
  let keepOut = NAV_READOUT_KEEP_OUT
  let readoutTop = displaySize.height * (keepOut.top + keepOut.focusDrop * navFocus)
  let overlapsX = origin.x < displaySize.width * keepOut.right
    && origin.x + labelSize.width > displaySize.width * keepOut.left
  let overlapsY = origin.y + labelSize.height > readoutTop && origin.y < displaySize.height * keepOut.bottom
  return overlapsX && overlapsY ? readoutTop - labelSize.height : origin.y
}

/// The nav distance readout at full nav focus, as shares of the display: x 29–71%, y 82–94%. Its
/// top sits `focusDrop` higher before focus, where the readout is smaller and higher.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `NAV_READOUT_LEFT`
let NAV_READOUT_KEEP_OUT = (left: 0.29, right: 0.71, top: 0.745, focusDrop: 0.075, bottom: 0.94)

/// Beyond this the triangle stops shrinking.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GROUP_FAR_M`
let GROUP_FAR_M = 3_000.0

/// One point placed on the heading-up map. `direction` is the unit ray from the Rider towards it in
/// screen space.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `MapPlacement`
struct WatchMapPlacement: Equatable {
  let point: CGPoint
  let direction: CGVector
  /// Inside the display, clear of the rim gauges by the placing caller's margin.
  let inRange: Bool
}

/// Bearing of an east/north offset relative to `courseDeg`, degrees clockwise in 0..<360: 0
/// straight ahead, 90 right, 180 behind.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `relativeBearingDeg`
func relativeBearingDeg(eastM: Double, northM: Double, courseDeg: Double) -> Double {
  let absolute = atan2(eastM, northM) * 180 / .pi
  return ((absolute - courseDeg).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}

/// The joined Group Ride as the wrist knows it: the latest Group Ride Frame, with the Rider's course
/// held across frames that carry none, so a stopped Rider keeps the last heading-up direction.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `WatchGroupRide`
struct WatchGroupRide: Equatable {
  /// The Rider's course, degrees clockwise from north; 0 (north-up) until one has ever arrived.
  var courseDeg: Double
  var spanM: Double
  var riders: [GroupRideFrameRider]

  /// The next state for an arriving frame, keeping `previous`'s course when the frame has none.
  static func accepting(_ frame: GroupRideFrame, previous: WatchGroupRide?) -> WatchGroupRide {
    WatchGroupRide(
      courseDeg: frame.courseDeg ?? previous?.courseDeg ?? 0,
      spanM: frame.spanM,
      riders: frame.riders
    )
  }

  /// Where `rider` is relative to the Rider's travel direction: 0 ahead, 90 right, 180 behind.
  func bearingDeg(of rider: GroupRideFrameRider) -> Double {
    relativeBearingDeg(eastM: rider.eastM, northM: rider.northM, courseDeg: courseDeg)
  }
}

/// Three missed 1 Hz frames and the group is gone from the wrist.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GROUP_RIDE_TIMEOUT_MS`
let GROUP_RIDE_TIMEOUT_MS: Int64 = 3_500
