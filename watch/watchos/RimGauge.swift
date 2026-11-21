import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt
enum Rim {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `GAUGE_RIM_INSET`
  /// @platform-diff watchOS uses half its 4 pt stroke width; Wear OS keeps a 3 dp inset.
  static let inset: CGFloat = RimStyle.strong.valueWidth / 2

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `GAUGE_INNER_INSET`
  /// @platform-diff watchOS uses 12 pt to reclaim space inside its rectangular rim; Wear OS uses 14 dp.
  static let innerInset: CGFloat = 12

  static let cornerRatio: CGFloat = 0.215

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `TOP_GAP`
  static let topGap: CGFloat = 5

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `TEMP_SWEEP`
  static let tempGap: CGFloat = 6
  static let tempSpanRatio: CGFloat = 0.10

  static let batteryEndInset: CGFloat = 10

  static func path(in size: CGSize, inset: CGFloat) -> Path {
    let metrics = Metrics(size: size, inset: inset)
    let rect = metrics.rect
    let radius = metrics.radius

    var path = Path()
    path.move(to: CGPoint(x: rect.midX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
    path.addArc(
      center: CGPoint(x: rect.maxX - radius, y: rect.minY + radius),
      radius: radius, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false
    )
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
    path.addArc(
      center: CGPoint(x: rect.maxX - radius, y: rect.maxY - radius),
      radius: radius, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false
    )
    path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
    path.addArc(
      center: CGPoint(x: rect.minX + radius, y: rect.maxY - radius),
      radius: radius, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false
    )
    path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
    path.addArc(
      center: CGPoint(x: rect.minX + radius, y: rect.minY + radius),
      radius: radius, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false
    )
    path.closeSubpath()
    return path
  }

  struct Metrics {
    let rect: CGRect
    let radius: CGFloat

    init(size: CGSize, inset: CGFloat) {
      rect = CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset)
      let display = min(size.width, size.height) * Rim.cornerRatio
      radius = min(max(display - inset, 0), min(rect.width, rect.height) / 2)
    }

    private var halfTop: CGFloat { rect.width / 2 - radius }
    private var side: CGFloat { rect.height - 2 * radius }
    private var corner: CGFloat { .pi / 2 * radius }
    var perimeter: CGFloat { 2 * (rect.width - 2 * radius) + 2 * side + 4 * corner }

    private var rightEdgeEnd: CGFloat { (halfTop + corner + side) / perimeter }
    private var bottomEdgeStart: CGFloat { (halfTop + 2 * corner + side) / perimeter }

    private var rightMid: CGFloat { (halfTop + corner + side / 2) / perimeter }

    private var gap: CGFloat { Rim.topGap / perimeter }
    private var tempGap: CGFloat { Rim.tempGap / perimeter }
    private var tempSpan: CGFloat { (corner + Rim.batteryEndInset + side * Rim.tempSpanRatio) / perimeter }

    var speed: RimSpan { RimSpan(origin: 1 - rightMid, head: 1 - gap) }
    var duty: RimSpan { RimSpan(origin: rightMid, head: gap) }

    var battery: RimSpan {
      RimSpan(
        origin: 1 - bottomEdgeStart - Rim.batteryEndInset / perimeter,
        head: bottomEdgeStart + Rim.batteryEndInset / perimeter
      )
    }

    var motorTemp: RimSpan {
      let origin = battery.origin + tempGap
      return RimSpan(origin: origin, head: origin + tempSpan)
    }

    var ctrlTemp: RimSpan {
      let origin = battery.head - tempGap
      return RimSpan(origin: origin, head: origin - tempSpan)
    }
  }
}

struct RimSpan {
  let origin: Double
  let head: Double

  func trim(_ fraction: Double) -> ClosedRange<Double> {
    let tip = origin + (head - origin) * min(max(fraction, 0), 1)
    return min(origin, tip)...max(origin, tip)
  }

  var full: ClosedRange<Double> { min(origin, head)...max(origin, head) }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `GaugeStyle`
struct RimStyle {
  let guideWidth: CGFloat
  let valueWidth: CGFloat
  let drawsHead: Bool

  static let strong = RimStyle(guideWidth: 2, valueWidth: 4, drawsHead: true)
  static let soft = RimStyle(guideWidth: 1, valueWidth: 2, drawsHead: false)
}

extension GraphicsContext {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `drawGauge`
  func drawRimGauge(
    _ rim: Path,
    span: RimSpan,
    fraction: Double,
    color: Color,
    style: RimStyle,
    glow: Double,
    center: CGPoint
  ) {
    let guide = span.full
    stroke(
      rim.trimmedPath(from: guide.lowerBound, to: guide.upperBound),
      with: .color(Palette.guide),
      style: StrokeStyle(lineWidth: style.guideWidth, lineCap: .butt)
    )

    guard fraction > 0 else { return }
    let value = span.trim(fraction)
    let lit = rim.trimmedPath(from: value.lowerBound, to: value.upperBound)

    if glow > 0 {
      drawInnerGlow(rim, lit: lit, color: color, strength: glow)
    }
    stroke(lit, with: .color(color), style: StrokeStyle(lineWidth: style.valueWidth, lineCap: .butt))

    guard style.drawsHead else { return }
    let tip = span.origin + (span.head - span.origin) * min(max(fraction, 0), 1)
    drawHeadTick(rim, at: tip, color: color, width: style.valueWidth, center: center)
  }

  private func drawInnerGlow(_ rim: Path, lit: Path, color: Color, strength: Double) {
    var fill = self
    fill.clip(to: rim)
    let depth = min(rim.boundingRect.width, rim.boundingRect.height) / 4
    let steps = 16
    var previousAlpha = 0.0
    for step in 0..<steps {
      let progress = 0.5 + 0.5 * (Double(step) + 0.5) / Double(steps)
      let intensity: Double
      if progress < 0.8 {
        intensity = (progress - 0.5) / 0.3 * 0.4
      } else if progress < 0.95 {
        intensity = 0.4 + (progress - 0.8) / 0.15 * 0.34
      } else {
        intensity = 0.74 + (progress - 0.95) / 0.05 * 0.26
      }
      let alpha = min(1, strength * intensity)
      let addedAlpha = (alpha - previousAlpha) / max(1 - previousAlpha, 0.0001)
      fill.stroke(
        lit, with: .color(color.opacity(addedAlpha)),
        style: StrokeStyle(
          lineWidth: depth * 4 * (1 - progress), lineCap: .butt, lineJoin: .round
        )
      )
      previousAlpha = alpha
    }
  }

  private func drawHeadTick(
    _ rim: Path, at position: Double, color: Color, width: CGFloat, center: CGPoint
  ) {
    let epsilon = 0.002
    let before = max(position - epsilon, 0)
    let after = min(position + epsilon, 1)
    guard
      let start = rim.trimmedPath(from: 0, to: before).currentPoint,
      let end = rim.trimmedPath(from: 0, to: after).currentPoint
    else { return }

    let dx = end.x - start.x
    let dy = end.y - start.y
    let length = max(sqrt(dx * dx + dy * dy), 0.0001)
    let normal = CGPoint(x: -dy / length, y: dx / length)
    let point = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)

    let toCentre = CGPoint(x: center.x - point.x, y: center.y - point.y)
    let facesCentre = normal.x * toCentre.x + normal.y * toCentre.y >= 0
    let inward = facesCentre ? normal : CGPoint(x: -normal.x, y: -normal.y)

    var tick = Path()
    tick.move(to: CGPoint(x: point.x + inward.x * HEAD_TICK_INNER, y: point.y + inward.y * HEAD_TICK_INNER))
    tick.addLine(to: CGPoint(x: point.x - inward.x * HEAD_TICK_OUTER, y: point.y - inward.y * HEAD_TICK_OUTER))
    stroke(tick, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .butt))
  }
}

private let HEAD_TICK_INNER: CGFloat = 7
private let HEAD_TICK_OUTER: CGFloat = 2

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `STRONG_GLOW`
let STRONG_GLOW = 0.38

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `dimGlow`
func dimGlow(_ focus: Double) -> Double { 1 - min(max(focus, 0), 1) * GLOW_FOCUS_DIM }

private let GLOW_FOCUS_DIM = 0.55

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `fadeOut`
func fadeOut(_ focus: Double) -> Double { min(max(1 - focus * FOCUS_FADE_RATE, 0), 1) }

private let FOCUS_FADE_RATE = 1.8

extension Rim {
  static func point(in size: CGSize, inset: CGFloat, bearingDeg: Double) -> CGPoint {
    let metrics = Metrics(size: size, inset: inset)
    let rect = metrics.rect
    let radius = metrics.radius
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    let angle = bearingDeg * .pi / 180
    let direction = CGPoint(x: CGFloat(sin(angle)), y: CGFloat(-cos(angle)))
    let halfWidth = rect.width / 2
    let halfHeight = rect.height / 2

    var distance = CGFloat.greatestFiniteMagnitude
    if direction.x != 0 { distance = min(distance, halfWidth / abs(direction.x)) }
    if direction.y != 0 { distance = min(distance, halfHeight / abs(direction.y)) }
    guard distance.isFinite else { return centre }
    var point = CGPoint(x: centre.x + direction.x * distance, y: centre.y + direction.y * distance)

    guard abs(point.x - centre.x) > halfWidth - radius, abs(point.y - centre.y) > halfHeight - radius
    else { return point }
    let corner = CGPoint(
      x: centre.x + (point.x > centre.x ? 1 : -1) * (halfWidth - radius),
      y: centre.y + (point.y > centre.y ? 1 : -1) * (halfHeight - radius)
    )
    let offset = CGPoint(x: centre.x - corner.x, y: centre.y - corner.y)
    let half = offset.x * direction.x + offset.y * direction.y
    let outside = offset.x * offset.x + offset.y * offset.y - radius * radius
    let discriminant = half * half - outside
    guard discriminant >= 0 else { return point }
    let hit = -half + sqrt(discriminant)
    point = CGPoint(x: centre.x + direction.x * hit, y: centre.y + direction.y * hit)
    return point
  }
}
