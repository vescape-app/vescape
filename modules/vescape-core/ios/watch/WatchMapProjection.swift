import CoreGraphics
import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchMapProjection`
struct WatchMapProjection {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `RIDER_DROP`
  static let riderDrop: CGFloat = 34
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `ROUTE_EDGE_INSET`
  static let edgeInset: CGFloat = 24
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapSpan`
  /// @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilder.swift `GROUP_RIDE_DEFAULT_SPAN_M`
  static let defaultSpanM = 600.0
  static let minSpanM = 150.0
  static let maxSpanM = 2_000.0

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapSpan`
  static func clampedSpanM(_ spanM: Double?) -> Double {
    min(maxSpanM, max(minSpanM, spanM ?? defaultSpanM))
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `riderPoint`
  static func riderPoint(in size: CGSize) -> CGPoint {
    CGPoint(x: size.width / 2, y: size.height / 2 + riderDrop)
  }

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
  /// @platform-diff Wear OS measures range against the round face's circle. The Apple Watch display
  func place(eastM: Double, northM: Double, margin: CGFloat) -> WatchMapPlacement {
    let rad = relativeBearingDeg(eastM: eastM, northM: northM, courseDeg: courseDeg) * .pi / 180
    let direction = CGVector(dx: sin(rad), dy: -cos(rad))
    let reach = (eastM * eastM + northM * northM).squareRoot() * scale
    let point = CGPoint(x: rider.x + direction.dx * reach, y: rider.y + direction.dy * reach)
    let inRange = abs(point.x - centre.x) <= size.width / 2 - margin
      && abs(point.y - centre.y) <= size.height / 2 - margin
    return WatchMapPlacement(point: point, direction: direction, inRange: inRange)
  }

  /// @platform-diff Wear OS meets its round face's circle. The Apple Watch display is a rounded
  func edgePoint(direction: CGVector, inset: CGFloat, cornerRadius: CGFloat) -> WatchEdgePoint {
    let bounds = CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset)
    let exit = rayExit(direction: direction, rect: bounds, cornerRadius: cornerRadius)
    let point = CGPoint(x: rider.x + direction.dx * exit.distance, y: rider.y + direction.dy * exit.distance)
    return WatchEdgePoint(point: point, outward: exit.normal)
  }

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
      let inRange = CGRect(origin: .zero, size: size).insetBy(dx: sizes.inRangeMargin, dy: sizes.inRangeMargin)
      let boundaryM = Double(rayExit(direction: placed.direction, rect: inRange, cornerRadius: 0).distance) / scale
      length = edgeTriangleLength(
        distanceM: rider.distanceM, boundaryM: boundaryM, min: sizes.triangleMin, max: sizes.triangleMax
      )
    }
    return WatchGroupRideMark(rider: rider, kind: .triangle, point: edge.point, direction: edge.outward, size: length)
  }

  func marks(for riders: [GroupRideFrameRider], sizes: WatchGroupRideMarkSizes) -> [WatchGroupRideMark] {
    riders.sorted { $0.distanceM > $1.distanceM }.map { mark(for: $0, sizes: sizes) }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `placeLabels`
  /// @platform-diff "On the display" is its rectangle here; Wear OS uses its round face's circle.
  func placeLabels(
    marks: [WatchGroupRideMark], labels: [CGSize?], gap: CGFloat, navFocus: Double
  ) -> [CGPoint?] {
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
      if CGRect(origin: base, size: labelSize).intersects(readout),
         base.y + height - readout.minY <= height * LABEL_NUDGE_STEPS.last! {
        spots.append(CGPoint(x: base.x, y: readout.minY - height))
      }
    }
    for base in bases {
      for step in LABEL_NUDGE_STEPS {
        for sign in [1.0, -1.0] as [CGFloat] {
          spots.append(CGPoint(x: base.x + nudge.dx * step * height * sign, y: base.y + nudge.dy * step * height * sign))
        }
      }
    }
    return spots
  }

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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchGroupRideMark`
struct WatchGroupRideMark: Equatable {
  let rider: GroupRideFrameRider
  let kind: WatchGroupRideMarkKind
  let point: CGPoint
  let direction: CGVector
  let size: CGFloat

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `overlaps`
  func overlaps(_ box: CGRect) -> Bool {
    switch kind {
    case .dot:
      return CGRect(x: point.x - size, y: point.y - size, width: size * 2, height: size * 2).intersects(box)
    case .triangle:
      return triangleOverlaps(triangleCorners, box)
    }
  }

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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchGroupRideMarkSizes`
struct WatchGroupRideMarkSizes {
  var inRangeMargin: CGFloat
  var edgeInset: CGFloat
  var edgeCornerRadius: CGFloat
  var dotRadius: CGFloat
  var triangleMin: CGFloat
  var triangleMax: CGFloat
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `edgeTriangleLength`
func edgeTriangleLength(distanceM: Double, boundaryM: Double, min minLength: CGFloat, max maxLength: CGFloat) -> CGFloat {
  let near = Swift.min(Swift.max(boundaryM, 1), GROUP_FAR_M - 1)
  let t = log(Swift.max(distanceM, near) / near) / log(GROUP_FAR_M / near)
  return minLength + (maxLength - minLength) * CGFloat(Swift.min(Swift.max(1 - t, 0), 1))
}

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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `LABEL_NUDGE_STEPS`
private let LABEL_NUDGE_STEPS: [CGFloat] = [0.5, 1]

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `GROUP_TRIANGLE_BASE`
let GROUP_TRIANGLE_BASE: CGFloat = 0.9

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `NAV_READOUT_LEFT`
/// @platform-diff The readout takes more of the narrow 40 mm display ("2.5 km" alone spans 29–72%),
private let NAV_READOUT_KEEP_OUT = (left: 0.25, right: 0.75, top: 0.745, focusDrop: 0.075, bottom: 0.94)

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `GROUP_FAR_M`
private let GROUP_FAR_M = 3_000.0

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `WatchMapPlacement`
struct WatchMapPlacement: Equatable {
  let point: CGPoint
  let direction: CGVector
  let inRange: Bool
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapProjection.kt `relativeBearingDeg`
func relativeBearingDeg(eastM: Double, northM: Double, courseDeg: Double) -> Double {
  let absolute = atan2(eastM, northM) * 180 / .pi
  return ((absolute - courseDeg).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}
