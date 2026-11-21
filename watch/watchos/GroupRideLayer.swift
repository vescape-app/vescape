import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `GroupRideLayer`
struct GroupRideLayer: View {
  let group: WatchGroupRide
  let mapView: WatchMapView
  let mapMoving: Bool
  var focus: Double = 0
  var distanceUnit: String = "km"

  var body: some View {
    GroupRideCanvas(group: group, mapView: mapView, mapMoving: mapMoving) { context, map, staleOpacity in
      let marks = map.marks(for: group.riders, sizes: groupRideMarkSizes(size: map.size, focus: focus))
      for mark in marks where mark.kind == .dot {
        let opacity = mark.rider.stale ? staleOpacity : 1
        context.fill(circle(mark.point, mark.size + GROUP_OUTLINE), with: .color(GROUP_OUTLINE_COLOR.opacity(opacity)))
        context.fill(circle(mark.point, mark.size), with: .color(Color(argb: mark.rider.colorArgb).opacity(opacity)))
      }
      context.drawGroupRideLabels(marks: marks, kind: .dot, map: map, focus: focus, distanceUnit: distanceUnit)
    }
  }

  private func circle(_ centre: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `GroupRideEdgeLayer`
struct GroupRideEdgeLayer: View {
  let group: WatchGroupRide
  let mapView: WatchMapView
  let mapMoving: Bool
  var focus: Double = 0
  var distanceUnit: String = "km"

  var body: some View {
    GroupRideCanvas(group: group, mapView: mapView, mapMoving: mapMoving) { context, map, staleOpacity in
      let marks = map.marks(for: group.riders, sizes: groupRideMarkSizes(size: map.size, focus: focus))
      for mark in marks where mark.kind == .triangle {
        let opacity = mark.rider.stale ? staleOpacity : 1
        let path = triangle(mark)
        context.stroke(
          path, with: .color(GROUP_OUTLINE_COLOR.opacity(opacity)),
          style: StrokeStyle(lineWidth: GROUP_OUTLINE * 2, lineJoin: .round)
        )
        context.fill(path, with: .color(Color(argb: mark.rider.colorArgb).opacity(opacity)))
      }
      context.drawGroupRideLabels(marks: marks, kind: .triangle, map: map, focus: focus, distanceUnit: distanceUnit)
    }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `drawEdgeTriangle`
  private func triangle(_ mark: WatchGroupRideMark) -> Path {
    var path = Path()
    path.addLines(mark.triangleCorners)
    path.closeSubpath()
    return path
  }
}

private struct GroupRideLabel {
  let distance: GraphicsContext.ResolvedText
  let distanceWidth: CGFloat
  let heatColor: Color?
  let battery: GraphicsContext.ResolvedText?
  let size: CGSize
}

private extension GraphicsContext {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `GroupRideLabels`
  func drawGroupRideLabels(
    marks: [WatchGroupRideMark], kind: WatchGroupRideMarkKind, map: WatchMapProjection, focus: Double, distanceUnit: String
  ) {
    guard focus > GROUP_LABEL_MIN_FOCUS else { return }
    let labels = marks.map { $0.rider.stale ? nil : measureLabel($0.rider, distanceUnit: distanceUnit) }
    let placed = map.placeLabels(
      marks: marks, labels: labels.map { $0?.size }, gap: GROUP_LABEL_GAP, navFocus: focus
    )
    var context = self
    context.opacity = focus
    for (i, mark) in marks.enumerated() where mark.kind == kind {
      guard let label = labels[i], let origin = placed[i] else { continue }
      let height = label.size.height
      context.draw(label.distance, at: origin, anchor: .topLeading)
      let flagX = origin.x + label.distanceWidth + GROUP_LABEL_FLAG_GAP
      if let heatColor = label.heatColor {
        let box = CGSize(width: height * THERMOMETER_ASPECT, height: height * THERMOMETER_HEIGHT)
        context.drawThermometer(
          in: CGRect(origin: CGPoint(x: flagX, y: origin.y + (height - box.height) / 2), size: box), color: heatColor
        )
      } else if let battery = label.battery {
        context.draw(battery, at: CGPoint(x: flagX, y: origin.y), anchor: .topLeading)
      }
    }
  }

  func measureLabel(_ rider: GroupRideFrameRider, distanceUnit: String) -> GroupRideLabel {
    let font = WatchTypography.mono(size: GROUP_LABEL_FONT_SIZE)
    let unbounded = CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
    let distance = resolve(
      Text(groupRideDistanceLabel(rider.distanceM, distanceUnit: distanceUnit)).font(font).foregroundColor(Palette.secondaryText)
    )
    let distanceSize = distance.measure(in: unbounded)
    var heatColor: Color?
    var battery: GraphicsContext.ResolvedText?
    switch groupRideLabelFlag(rider) {
    case .hot(let level):
      heatColor = Palette.level(level)
    case .battery(let percent, let level):
      if let color = Palette.level(level) { battery = resolve(Text("\(percent)%").font(font).foregroundColor(color)) }
    default:
      break
    }
    let height = distanceSize.height
    let flagWidth: CGFloat
    if heatColor != nil {
      flagWidth = GROUP_LABEL_FLAG_GAP + height * THERMOMETER_ASPECT
    } else if let battery {
      flagWidth = GROUP_LABEL_FLAG_GAP + battery.measure(in: unbounded).width
    } else {
      flagWidth = 0
    }
    return GroupRideLabel(
      distance: distance, distanceWidth: distanceSize.width, heatColor: heatColor, battery: battery,
      size: CGSize(width: distanceSize.width + flagWidth, height: height)
    )
  }
}

extension GraphicsContext {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `drawThermometer`
  func drawThermometer(in box: CGRect, color: Color) {
    let line = THERMOMETER_STROKE
    let cx = box.midX
    let bulbRadius = box.width / 2
    let bulb = CGPoint(x: cx, y: box.maxY - bulbRadius)
    let stemWidth = box.width * THERMOMETER_STEM
    let stemTop = box.minY + line / 2
    let stemBottom = bulb.y
    let stem = Path(
      roundedRect: CGRect(x: cx - stemWidth / 2, y: stemTop, width: stemWidth, height: stemBottom - stemTop),
      cornerRadius: stemWidth / 2
    )
    stroke(stem, with: .color(color), lineWidth: line)
    fill(
      Path(ellipseIn: CGRect(x: bulb.x - bulbRadius, y: bulb.y - bulbRadius, width: bulbRadius * 2, height: bulbRadius * 2)),
      with: .color(color)
    )
    let mercuryTop = stemBottom - (stemBottom - stemTop) * THERMOMETER_FILL
    fill(Path(CGRect(x: cx - stemWidth / 2, y: mercuryTop, width: stemWidth, height: stemBottom - mercuryTop)), with: .color(color))
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `groupRideMarkSizes`
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

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `rememberStalePulse`
private struct GroupRideCanvas: View {
  let group: WatchGroupRide
  let mapView: WatchMapView
  let mapMoving: Bool
  let draw: (inout GraphicsContext, WatchMapProjection, Double) -> Void

  var body: some View {
    let pulsing = group.riders.contains(where: \.stale)
    TimelineView(.animation(paused: !pulsing && !mapMoving)) { timeline in
      let opacity = staleOpacity(at: timeline.date)
      let at = mapMoving ? timeline.date : .distantFuture
      Canvas { context, size in
        let map = WatchMapProjection(size: size, spanM: mapView.spanM(at: at), courseDeg: mapView.courseDeg(at: at))
        draw(&context, map, opacity)
      }
    }
    .allowsHitTesting(false)
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `staleAlpha`
private func staleOpacity(at date: Date) -> Double {
  let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: GROUP_STALE_PULSE_SECONDS * 2)
    / GROUP_STALE_PULSE_SECONDS
  let t = phase <= 1 ? phase : 2 - phase
  return GROUP_STALE_MAX_OPACITY + (GROUP_STALE_MIN_OPACITY - GROUP_STALE_MAX_OPACITY) * t
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `GROUP_IN_RANGE_MARGIN`
private let GROUP_IN_RANGE_MARGIN: CGFloat = 38
private let GROUP_DOT_RADIUS: CGFloat = 3
private let GROUP_FOCUS_DOT_RADIUS: CGFloat = 4.5
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRideLayer.kt `GROUP_EDGE_INSET`
private let GROUP_EDGE_INSET: CGFloat = 1
private let GROUP_TRIANGLE_MIN: CGFloat = 7
private let GROUP_TRIANGLE_MAX: CGFloat = 12
private let GROUP_OUTLINE: CGFloat = 0.75
private let GROUP_LABEL_FONT_SIZE: CGFloat = 9
private let GROUP_LABEL_GAP: CGFloat = 3
private let GROUP_LABEL_FLAG_GAP: CGFloat = 3
private let GROUP_LABEL_MIN_FOCUS = 0.01
private let THERMOMETER_ASPECT: CGFloat = 0.45
private let THERMOMETER_HEIGHT: CGFloat = 1
private let THERMOMETER_STEM: CGFloat = 0.5
private let THERMOMETER_FILL: CGFloat = 0.5
private let THERMOMETER_STROKE: CGFloat = 0.8
private let GROUP_OUTLINE_COLOR = Color.black.opacity(0.9)
private let GROUP_STALE_MAX_OPACITY = 0.7
private let GROUP_STALE_MIN_OPACITY = 0.2
private let GROUP_STALE_PULSE_SECONDS = 0.7
