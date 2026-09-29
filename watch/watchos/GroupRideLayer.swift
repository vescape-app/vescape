import SwiftUI

/// Every other Rider who fits on the nav map, as a dot in their colour, over the route and under the
/// gauges. A flagged Rider's dot wears a thin orange or red ring. Without Navigation there is no
/// route to carry the Rider's own ring, so this draws it at the same spot. In nav focus each live dot
/// gets its distance label. Riders beyond the map are `GroupRideEdgeLayer`'s.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideLayer`
struct GroupRideLayer: View {
  let group: WatchGroupRide
  let drawOwnRing: Bool
  let ownColor: Color
  /// Nav-focus progress: the dots grow and the labels fade in as the nav page takes the screen.
  var focus: Double = 0
  var unitSystem: String = "metric"

  var body: some View {
    StalePulse(group: group) { context, size, staleOpacity in
      let map = WatchMapProjection(size: size, spanM: group.spanM, courseDeg: group.courseDeg)
      if drawOwnRing { context.drawRiderDot(at: map.rider, color: ownColor) }
      let dots = map.marks(for: group.riders, sizes: groupRideMarkSizes(size: size, focus: focus))
        .filter { $0.kind == .dot }
      for mark in dots {
        let opacity = mark.rider.stale ? staleOpacity : 1
        if let ring = flagColor(mark.rider) {
          let ringPath = circle(mark.point, mark.size + GROUP_RING_GAP)
          context.stroke(ringPath, with: .color(GROUP_OUTLINE_COLOR), lineWidth: GROUP_RING_WIDTH + GROUP_OUTLINE * 2)
          context.stroke(ringPath, with: .color(ring), lineWidth: GROUP_RING_WIDTH)
        }
        context.fill(circle(mark.point, mark.size + GROUP_OUTLINE), with: .color(GROUP_OUTLINE_COLOR.opacity(opacity)))
        context.fill(circle(mark.point, mark.size), with: .color(Color(argb: mark.rider.colorArgb).opacity(opacity)))
      }
      // Labels over every dot, so a neighbour's dot never cuts one.
      for mark in dots { context.drawGroupRideLabel(for: mark, map: map, focus: focus, unitSystem: unitSystem) }
    }
  }

  private func circle(_ centre: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
  }
}

/// Every Rider beyond the nav map, as a triangle in their colour on the display edge, apex inward.
/// Drawn over the rim gauges, so the caller layers it above them. A triangle is always the Rider's
/// own colour; a flag shows only in its nav-focus label. Hidden in ambient like the dots.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideEdgeLayer`
struct GroupRideEdgeLayer: View {
  let group: WatchGroupRide
  /// Nav-focus progress: the labels fade in as the nav page takes the screen.
  var focus: Double = 0
  var unitSystem: String = "metric"

  var body: some View {
    StalePulse(group: group) { context, size, staleOpacity in
      let map = WatchMapProjection(size: size, spanM: group.spanM, courseDeg: group.courseDeg)
      let triangles = map.marks(for: group.riders, sizes: groupRideMarkSizes(size: size, focus: focus))
        .filter { $0.kind == .triangle }
      for mark in triangles {
        let opacity = mark.rider.stale ? staleOpacity : 1
        let path = triangle(mark)
        context.stroke(
          path, with: .color(GROUP_OUTLINE_COLOR.opacity(opacity)),
          style: StrokeStyle(lineWidth: GROUP_OUTLINE * 2, lineJoin: .round)
        )
        context.fill(path, with: .color(Color(argb: mark.rider.colorArgb).opacity(opacity)))
      }
      for mark in triangles { context.drawGroupRideLabel(for: mark, map: map, focus: focus, unitSystem: unitSystem) }
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

/// A live Rider's flag colour: orange for a warning, red for critical, the worse of battery and heat.
/// Nil for a Rider with nothing to flag, and for a stale one — their readings are as old as their
/// place.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `flagColor`
private func flagColor(_ rider: GroupRideFrameRider) -> Color? {
  rider.stale ? nil : levelColor(rider.flagLevel)
}

func levelColor(_ level: TelemetryLevel) -> Color? {
  switch level {
  case .normal: return nil
  case .warning: return Palette.warning
  case .critical: return Palette.critical
  }
}

private extension GraphicsContext {
  /// A mark's nav-focus label: grey distance, then a flag — a thermometer when the Rider runs hot,
  /// else their battery % when it is low, each in its level's colour. Stale Riders get none; their
  /// distance is as old as their place.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GroupRideLabels`
  func drawGroupRideLabel(for mark: WatchGroupRideMark, map: WatchMapProjection, focus: Double, unitSystem: String) {
    guard focus > GROUP_LABEL_MIN_FOCUS, !mark.rider.stale else { return }
    let rider = mark.rider
    let font = WatchTypography.mono(size: GROUP_LABEL_FONT_SIZE)
    let unbounded = CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
    let distance = resolve(
      Text(groupRideDistanceLabel(rider.distanceM, unitSystem: unitSystem)).font(font).foregroundColor(Palette.secondaryText)
    )
    let distanceSize = distance.measure(in: unbounded)
    let heatColor = levelColor(rider.heatLevel)
    var battery: GraphicsContext.ResolvedText?
    if heatColor == nil, let percent = rider.batteryPercent, let color = levelColor(rider.batteryLevel) {
      battery = resolve(Text("\(percent)%").font(font).foregroundColor(color))
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
    let origin = map.labelOrigin(
      for: mark,
      labelSize: CGSize(width: distanceSize.width + flagWidth, height: height),
      gap: GROUP_LABEL_GAP,
      ring: GROUP_RING_GAP + GROUP_RING_WIDTH,
      navFocus: focus
    )
    var context = self
    context.opacity = focus
    context.draw(distance, at: origin, anchor: .topLeading)
    let flagX = origin.x + distanceSize.width + GROUP_LABEL_FLAG_GAP
    if let heatColor {
      context.drawThermometer(
        in: CGRect(x: flagX, y: origin.y + height * 0.1, width: height * THERMOMETER_ASPECT, height: height * 0.8),
        color: heatColor
      )
    } else if let battery {
      context.draw(battery, at: CGPoint(x: flagX, y: origin.y), anchor: .topLeading)
    }
  }
}

extension GraphicsContext {
  /// Thermometer in `box`: stroked stem, filled bulb, a short mercury line up the stem.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `drawThermometer`
  func drawThermometer(in box: CGRect, color: Color) {
    let line = THERMOMETER_STROKE
    let cx = box.midX
    let stemWidth = box.width * 0.28
    let bulbRadius = box.width * 0.24
    let bulb = CGPoint(x: cx, y: box.maxY - bulbRadius - line / 2)
    let stemTop = box.minY + line / 2
    let stemBottom = bulb.y - bulbRadius * 0.6
    let stem = Path(
      roundedRect: CGRect(x: cx - stemWidth / 2, y: stemTop, width: stemWidth, height: stemBottom - stemTop),
      cornerRadius: stemWidth / 2
    )
    stroke(stem, with: .color(color), lineWidth: line)
    fill(
      Path(ellipseIn: CGRect(x: bulb.x - bulbRadius, y: bulb.y - bulbRadius, width: bulbRadius * 2, height: bulbRadius * 2)),
      with: .color(color)
    )
    var mercury = Path()
    mercury.move(to: bulb)
    mercury.addLine(to: CGPoint(x: cx, y: stemTop + (stemBottom - stemTop) * 0.35))
    stroke(mercury, with: .color(color), lineWidth: stemWidth * 0.45)
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

extension Color {
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
/// A flagged dot's ring: this far outside the dot, this thick.
private let GROUP_RING_GAP: CGFloat = 2.5
private let GROUP_RING_WIDTH: CGFloat = 1.5
private let GROUP_LABEL_FONT_SIZE: CGFloat = 9
/// Label clear of its dot, ring or triangle apex.
private let GROUP_LABEL_GAP: CGFloat = 3
/// Between the distance and its flag.
private let GROUP_LABEL_FLAG_GAP: CGFloat = 3
/// Labels are not drawn at all until nav focus is under way.
private let GROUP_LABEL_MIN_FOCUS = 0.01
/// Thermometer width as a share of the label's line height.
private let THERMOMETER_ASPECT: CGFloat = 0.5
private let THERMOMETER_STROKE: CGFloat = 1.3
private let GROUP_OUTLINE_COLOR = Color.black.opacity(0.9)
/// A Rider the phone has not heard from for a while: last known place, faded and pulsing.
private let GROUP_STALE_MAX_OPACITY = 0.7
private let GROUP_STALE_MIN_OPACITY = 0.2
private let GROUP_STALE_PULSE_SECONDS = 0.7
