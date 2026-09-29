import CoreGraphics
import Foundation

/// The nav route's heading-up projection, in points: the Rider sits `riderDrop` below the display
/// centre, their course points up, and the clamped span of metres fits the display's shorter side
/// minus `edgeInset`. The route line and the Group Ride marks share it, so a Rider on the route is
/// drawn on it.
///
/// Shared with the wrist (`watch/watchos/` symlinks this file) so the placement math is tested here.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchMapProjection`
struct WatchMapProjection {
  /// The Rider sits this far below the centre, so more of the map is ahead than behind.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `RIDER_DROP`
  static let riderDrop: CGFloat = 34
  /// Display margin the map's span is fitted inside.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `ROUTE_EDGE_INSET`
  static let edgeInset: CGFloat = 24
  /// Fallback metres across the display until the phone publishes its camera span.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `DEFAULT_ROUTE_SPAN_M`
  /// @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_DEFAULT_SPAN_M`
  static let defaultSpanM = 600.0
  static let minSpanM = 150.0
  static let maxSpanM = 2_000.0

  /// The phone map's span, clamped to what a wrist can draw, or the fallback.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `clampRouteSpanM`
  static func clampedSpanM(_ spanM: Double?) -> Double {
    min(maxSpanM, max(minSpanM, spanM ?? defaultSpanM))
  }

  /// Where the Rider sits on a display of `size`: `riderDrop` below its centre.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `riderPoint`
  static func riderPoint(in size: CGSize) -> CGPoint {
    CGPoint(x: size.width / 2, y: size.height / 2 + riderDrop)
  }

  /// Points per metre when `spanM` (already clamped) metres fit the display's shorter side less
  /// `edgeInset`.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `pixelsPerMetre`
  static func pointsPerMetre(size: CGSize, spanM: Double) -> Double {
    (min(size.width, size.height) - edgeInset) / spanM
  }

  let size: CGSize
  let courseDeg: Double
  private let scale: Double

  init(size: CGSize, spanM: Double?, courseDeg: Double) {
    self.size = size
    self.courseDeg = courseDeg
    scale = Self.pointsPerMetre(size: size, spanM: Self.clampedSpanM(spanM))
  }

  var centre: CGPoint { CGPoint(x: size.width / 2, y: size.height / 2) }
  var rider: CGPoint { Self.riderPoint(in: size) }
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

  /// Every nav-focus label's top-left, aligned with `marks`: `labels` holds each mark's label size,
  /// or nil for a mark without one. Nearest Rider first, so the closest keep their natural spot.
  /// Each label tries, in order: beside a dot on the side away from the Rider, then toward it (both
  /// on the display), or inward of a triangle's apex; each of those slid up off the nav readout; then
  /// nudged by `LABEL_NUDGE_STEPS` label heights — up or down beside a dot, either way along the edge
  /// beside a triangle. The first spot `gap` clear of the nav readout and clear of every label
  /// already placed and every mark wins — its own too, since a nudge along the edge can slide a label
  /// back onto its own triangle. None clear, and the label is dropped (nil): its mark stays, and the
  /// Group Ride page has the details. A label never sits more than one label height from its
  /// natural spot.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `placeLabels`
  /// @platform-diff "On the display" is its rectangle here; Wear OS uses its round face's circle.
  func placeLabels(
    marks: [WatchGroupRideMark], labels: [CGSize?], gap: CGFloat, navFocus: Double
  ) -> [CGPoint?] {
    // `gap` clear of the readout too, so a label never reads as part of it.
    let readout = navReadoutBounds(navFocus: navFocus, displaySize: size).insetBy(dx: -gap, dy: -gap)
    var placed = [CGRect?](repeating: nil, count: marks.count)
    let order = marks.indices.filter { labels[$0] != nil }.sorted {
      let a = marks[$0].rider, b = marks[$1].rider
      return a.distanceM != b.distanceM ? a.distanceM < b.distanceM : a.id < b.id
    }
    for i in order {
      guard let labelSize = labels[i] else { continue }
      let box = labelSpots(for: marks[i], labelSize: labelSize, gap: gap, readout: readout)
        .lazy
        .map { CGRect(origin: $0, size: labelSize) }
        .first { box in
          !box.intersects(readout)
            && !placed.contains { $0?.intersects(box) ?? false }
            && !marks.contains { $0.overlaps(box) }
        }
      placed[i] = box
    }
    return placed.map { $0?.origin }
  }

  /// `placeLabels`'s candidate top-lefts for one label, most natural first.
  private func labelSpots(
    for mark: WatchGroupRideMark, labelSize: CGSize, gap: CGFloat, readout: CGRect
  ) -> [CGPoint] {
    let width = labelSize.width
    let height = labelSize.height
    let bases: [CGPoint]
    let nudge: CGVector
    switch mark.kind {
    case .dot:
      let reach = mark.size + gap
      let top = mark.point.y - height / 2
      let right = CGPoint(x: mark.point.x + reach, y: top)
      let left = CGPoint(x: mark.point.x - reach - width, y: top)
      let display = CGRect(origin: .zero, size: size)
      bases = (mark.point.x >= rider.x ? [right, left] : [left, right])
        .filter { display.contains(CGRect(origin: $0, size: labelSize)) }
      nudge = CGVector(dx: 0, dy: -1)
    case .triangle:
      // Inward along the edge normal, far enough that the box's own half-extent clears the apex.
      let inward = CGVector(dx: -mark.direction.dx, dy: -mark.direction.dy)
      let extent = min(
        abs(inward.dx) > 1e-3 ? width / 2 / abs(inward.dx) : .greatestFiniteMagnitude,
        abs(inward.dy) > 1e-3 ? height / 2 / abs(inward.dy) : .greatestFiniteMagnitude
      )
      let reach = mark.size + gap + extent
      bases = [CGPoint(x: mark.point.x + inward.dx * reach - width / 2, y: mark.point.y + inward.dy * reach - height / 2)]
      nudge = CGVector(dx: -mark.direction.dy, dy: mark.direction.dx)
    }
    var spots: [CGPoint] = []
    for base in bases {
      spots.append(base)
      // Up until clear of the readout, but no further than a nudge would go.
      if CGRect(origin: base, size: labelSize).intersects(readout),
         base.y + height - readout.minY <= height * LABEL_NUDGE_STEPS.last! {
        spots.append(CGPoint(x: base.x, y: readout.minY - height))
      }
    }
    for base in bases {
      for step in LABEL_NUDGE_STEPS {
        // Up first beside a dot (the readout is below); either way along the edge beside a triangle.
        for sign in [1.0, -1.0] as [CGFloat] {
          spots.append(CGPoint(x: base.x + nudge.dx * step * height * sign, y: base.y + nudge.dy * step * height * sign))
        }
      }
    }
    return spots
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
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchEdgePoint`
struct WatchEdgePoint: Equatable {
  let point: CGPoint
  let outward: CGVector
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchGroupRideMarkKind`
enum WatchGroupRideMarkKind: Equatable {
  case dot
  case triangle
}

/// Where and how one Rider is drawn. A dot centres on `point` with radius `size`, and `direction` is
/// the ray from the Rider. A triangle's base centre is `point` on the display edge, `direction` the
/// outward normal, `size` its length: the apex sits at point − direction × size.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchGroupRideMark`
struct WatchGroupRideMark: Equatable {
  let rider: GroupRideFrameRider
  let kind: WatchGroupRideMarkKind
  let point: CGPoint
  let direction: CGVector
  let size: CGFloat

  /// Whether `box` covers any of this mark, for `placeLabels`: a dot's bounding square, or a
  /// triangle's own shape. A box around a triangle would either miss its base corners on a diagonal
  /// rim or reach past its apex onto the label's natural spot.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `overlaps`
  func overlaps(_ box: CGRect) -> Bool {
    switch kind {
    case .dot:
      return CGRect(x: point.x - size, y: point.y - size, width: size * 2, height: size * 2).intersects(box)
    case .triangle:
      return triangleOverlaps(triangleCorners, box)
    }
  }

  /// A triangle mark's corners: the two base ends on the edge, then the apex `size` inward. Base
  /// width is `GROUP_TRIANGLE_BASE` of the length.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `triangleCorners`
  var triangleCorners: [CGPoint] {
    let side = CGVector(
      dx: -direction.dy * size * GROUP_TRIANGLE_BASE / 2, dy: direction.dx * size * GROUP_TRIANGLE_BASE / 2)
    return [
      CGPoint(x: point.x + side.dx, y: point.y + side.dy),
      CGPoint(x: point.x - side.dx, y: point.y - side.dy),
      CGPoint(x: point.x - direction.dx * size, y: point.y - direction.dy * size),
    ]
  }
}

/// Separating-axis test: `triangle` and `box` overlap unless the box's axes or one of the triangle's
/// edge normals separates them. Touching is not overlapping.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `triangleOverlaps`
private func triangleOverlaps(_ triangle: [CGPoint], _ box: CGRect) -> Bool {
  let corners = [
    CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY),
    CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY),
  ]
  let edgeNormals = triangle.indices.map { i -> CGVector in
    let a = triangle[i], b = triangle[(i + 1) % triangle.count]
    return CGVector(dx: a.y - b.y, dy: b.x - a.x)
  }
  return ([CGVector(dx: 1, dy: 0), CGVector(dx: 0, dy: 1)] + edgeNormals).allSatisfy { axis in
    let t = triangle.map { $0.x * axis.dx + $0.y * axis.dy }
    let c = corners.map { $0.x * axis.dx + $0.y * axis.dy }
    return t.max()! > c.min()! && c.max()! > t.min()!
  }
}

/// The point measures `WatchMapProjection.mark` needs.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchGroupRideMarkSizes`
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
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `edgeTriangleLength`
func edgeTriangleLength(distanceM: Double, boundaryM: Double, min minLength: CGFloat, max maxLength: CGFloat) -> CGFloat {
  let near = Swift.min(Swift.max(boundaryM, 1), GROUP_FAR_M - 1)
  let t = log(Swift.max(distanceM, near) / near) / log(GROUP_FAR_M / near)
  return minLength + (maxLength - minLength) * CGFloat(Swift.min(Swift.max(1 - t, 0), 1))
}

/// The nav distance readout's keep-out box. It drops and grows with `navFocus`; at full focus it
/// spans about x 25–75% and y 82–94% of the display.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `navReadoutBounds`
func navReadoutBounds(navFocus: Double, displaySize: CGSize) -> CGRect {
  let keepOut = NAV_READOUT_KEEP_OUT
  let top = displaySize.height * (keepOut.top + keepOut.focusDrop * navFocus)
  return CGRect(
    x: displaySize.width * keepOut.left,
    y: top,
    width: displaySize.width * (keepOut.right - keepOut.left),
    height: displaySize.height * keepOut.bottom - top
  )
}

/// A crowded label's nudges, in label heights; the last is the farthest a label strays from its mark.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `LABEL_NUDGE_STEPS`
private let LABEL_NUDGE_STEPS: [CGFloat] = [0.5, 1]

/// A triangle mark's base width as a share of its length.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `GROUP_TRIANGLE_BASE`
let GROUP_TRIANGLE_BASE: CGFloat = 0.9

/// The nav distance readout at full nav focus, as shares of the display: x 25–75%, y 82–94%. Its
/// top sits `focusDrop` higher before focus, where the readout is smaller and higher.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `NAV_READOUT_LEFT`
/// @platform-diff The readout takes more of the narrow 40 mm display ("2.5 km" alone spans 29–72%),
///   so the keep-out is wider here than Wear OS's 29–71%.
private let NAV_READOUT_KEEP_OUT = (left: 0.25, right: 0.75, top: 0.745, focusDrop: 0.075, bottom: 0.94)

/// Beyond this the triangle stops shrinking.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `GROUP_FAR_M`
private let GROUP_FAR_M = 3_000.0

/// One point placed on the heading-up map. `direction` is the unit ray from the Rider towards it in
/// screen space.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchMapPlacement`
struct WatchMapPlacement: Equatable {
  let point: CGPoint
  let direction: CGVector
  /// Inside the display, clear of the rim gauges by the placing caller's margin.
  let inRange: Bool
}

/// Bearing of an east/north offset relative to `courseDeg`, degrees clockwise in 0..<360: 0
/// straight ahead, 90 right, 180 behind.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `relativeBearingDeg`
func relativeBearingDeg(eastM: Double, northM: Double, courseDeg: Double) -> Double {
  let absolute = atan2(eastM, northM) * 180 / .pi
  return ((absolute - courseDeg).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}
