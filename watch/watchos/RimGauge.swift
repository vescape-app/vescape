import SwiftUI

/// The rectangular rim: where each gauge sits on the edge of the display, and how a reading is
/// drawn along it.
///
/// Wear OS draws its arcs on one screen-centred circle, because the panel is one. The Apple Watch
/// panel is a rounded rectangle, and fitting that circle inside it would throw away the corners and
/// shrink every readout to fit a shape the hardware does not have (docs/watchos.md). So the arcs
/// become a path around the display edge, and everything angular about the Android layout —
/// "start at 180°, sweep 90°" — becomes a span of that path instead.
///
/// Positions are perimeter fractions, clockwise from top centre: `0`/`1` top centre, `0.25` right
/// edge, `0.5` bottom centre, `0.75` left edge. The rounded rectangle is symmetric, so those four
/// land exactly on the midpoints whatever the case size, which is what keeps the layout honest
/// between a 40 mm and a 44 mm watch rather than tuned to one of them.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt
enum Rim {
  /// Distance from the layout edge to the path every rim gauge is drawn on. Wide enough that the
  /// whole stroke clears the bezel: the gauge line has width, so a path laid on the very edge is
  /// half-hidden even when its geometry is right.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `GAUGE_RIM_INSET`
  static let inset: CGFloat = 5

  /// Distance from the layout edge to the area a centre page may use. Everything outside it belongs
  /// to the pinned rim gauges, so a page that ignores this insets its content into them.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `GAUGE_INNER_INSET`
  static let innerInset: CGFloat = 14

  /// The display's own corner rounding, as a share of its short side. Apple publishes no API for
  /// it, so this is matched against the known panel geometry rather than read from the device:
  /// roughly 34.5 pt on the 162 pt-wide 40 mm display and 40 pt on the 184 pt 44 mm one, which is
  /// the same ratio on both — so it is wrong in the same direction on every case size rather than
  /// tuned to one of them.
  ///
  /// Getting this wrong is not subtle, and it fails in two different ways. Too large and the path
  /// bows visibly inside the bezel at the corners; too small and the corner arcs fall outside the
  /// rounded display entirely and are clipped away, leaving four straight runs with gaps where the
  /// corners should be.
  static let cornerRatio: CGFloat = 0.215

  /// A gap either side of top centre, so the two top gauges read as two rather than one ring.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `TOP_GAP`
  static let topGap: CGFloat = 5

  /// Gap between the bottom (battery) gauge and a temperature gauge, and how far up the *straight*
  /// side edge that temperature gauge climbs once it has rounded the corner.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `TEMP_SWEEP`
  static let tempGap: CGFloat = 6
  static let tempSpanRatio: CGFloat = 0.10

  /// Leave some of the flat bottom edge for the temperature corners.
  static let batteryEndInset: CGFloat = 10

  /// The perimeter, clockwise from top centre. Trimming this by fraction is how every gauge is
  /// drawn, so the corner rounding is described once and no gauge restates it.
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

  /// Where each gauge sits, worked out from the display's actual edges rather than from fixed
  /// fractions of the perimeter.
  ///
  /// Wear OS can name its gauges in degrees — "start at 180°, sweep 90°" — because every point on a
  /// circle is the same distance from the centre. A rectangle has four edges of two different
  /// lengths, so the same constant means a different place on a 40 mm watch than on a 49 mm one:
  /// a bottom span written as a fixed share of the perimeter runs past the short bottom edge and
  /// climbs the sides. Every span here is anchored to an edge or a corner instead, so "battery
  /// along the bottom" means the bottom, whatever case it is drawn on.
  struct Metrics {
    let rect: CGRect
    let radius: CGFloat

    init(size: CGSize, inset: CGFloat) {
      rect = CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset)
      // The ratio describes the *display*, so the inset comes off the radius rather than being
      // folded into the size it is derived from. Taking the ratio of the already-inset rect
      // shrinks the curve by a fraction of the inset instead of by the inset, and the path drifts
      // off the bezel by more the further in it sits.
      let display = min(size.width, size.height) * Rim.cornerRatio
      radius = min(max(display - inset, 0), min(rect.width, rect.height) / 2)
    }

    /// Straight run along the top or bottom edge, and up a side.
    private var halfTop: CGFloat { rect.width / 2 - radius }
    private var side: CGFloat { rect.height - 2 * radius }
    private var corner: CGFloat { .pi / 2 * radius }
    var perimeter: CGFloat { 2 * (rect.width - 2 * radius) + 2 * side + 4 * corner }

    /// Landmarks clockwise from top centre, as perimeter fractions.
    private var rightEdgeEnd: CGFloat { (halfTop + corner + side) / perimeter }
    private var bottomEdgeStart: CGFloat { (halfTop + 2 * corner + side) / perimeter }

    /// Mid-height of a side edge: where the two headline gauges start from, the rectangle's answer
    /// to Android's 9 and 3 o'clock.
    private var rightMid: CGFloat { (halfTop + corner + side / 2) / perimeter }

    private var gap: CGFloat { Rim.topGap / perimeter }
    private var tempGap: CGFloat { Rim.tempGap / perimeter }
    /// A temperature starts where the battery stopped and has to get through the corner arc before
    /// it reaches the straight edge, so the corner is part of its length rather than a gap in it.
    private var tempSpan: CGFloat { (corner + Rim.batteryEndInset + side * Rim.tempSpanRatio) / perimeter }

    /// Speed climbs the left edge toward the top, duty the right: the same two quadrants Android
    /// uses, and the same direction of travel, so a rider moving between the wrists reads them the
    /// same way round.
    var speed: RimSpan { RimSpan(origin: 1 - rightMid, head: 1 - gap) }
    var duty: RimSpan { RimSpan(origin: rightMid, head: gap) }

    /// Battery owns the bottom edge and only the bottom edge, filling left to right.
    var battery: RimSpan {
      RimSpan(
        origin: 1 - bottomEdgeStart - Rim.batteryEndInset / perimeter,
        head: bottomEdgeStart + Rim.batteryEndInset / perimeter
      )
    }

    /// Temperatures continue out of the battery line through the bottom corners and up the side
    /// edges — the same "small arcs either side of the battery gauge" as Android, laid onto the
    /// only stretch of rim a rectangle has spare.
    /// Each temperature picks up just past the end of the battery edge, rounds the bottom corner
    /// and carries on up the side — one continuous line out of the battery's, the way speed and
    /// duty run continuously into the top corners. Anchoring them to the straight edge instead left
    /// the corner arc unused, and a bare corner between two lit gauges reads as a gap in the rim
    /// rather than as two separate readings.
    ///
    /// Fractions increase clockwise, so "onward from the bottom edge" is an increase on the left
    /// and a decrease on the right.
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

/// One gauge's stretch of the rim. A reading grows from ``origin`` toward ``head``; `head` may sit
/// *before* `origin` on the perimeter, which is how duty and battery fill backwards along it.
struct RimSpan {
  let origin: Double
  let head: Double

  /// The sub-range a reading of `fraction` covers, as a trim range on the rim path.
  func trim(_ fraction: Double) -> ClosedRange<Double> {
    let tip = origin + (head - origin) * min(max(fraction, 0), 1)
    return min(origin, tip)...max(origin, tip)
  }

  var full: ClosedRange<Double> { min(origin, head)...max(origin, head) }
}

/// One rim gauge's line weights. Speed and duty are the headline pair and carry a head tick;
/// battery and the temperatures are quieter furniture underneath them.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `GaugeStyle`
struct RimStyle {
  let guideWidth: CGFloat
  let valueWidth: CGFloat
  let drawsHead: Bool

  static let strong = RimStyle(guideWidth: 2, valueWidth: 4, drawsHead: true)
  static let soft = RimStyle(guideWidth: 1, valueWidth: 2, drawsHead: false)
}

extension GraphicsContext {
  /// One gauge: a thin guide across its whole span, the value drawn over it, a soft wider pass
  /// underneath for the glow, and a tick at the head.
  ///
  /// An inward gradient follows the rim's normal, with a perpendicular edge at the value tip.
  /// Ambient keeps only the line.
  ///
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

  /// Butt-ended strokes keep the glow perpendicular to the path at both ends. Clipping to the
  /// rim removes their outer halves, leaving only the inward gradient, including around corners.
  private func drawInnerGlow(_ rim: Path, lit: Path, color: Color, strength: Double) {
    var fill = self
    fill.clip(to: rim)
    let depth = min(rim.boundingRect.width, rim.boundingRect.height) / 4
    // Fixed work per gauge, independent of display size. Sixteen overlapping bands retain
    // the soft falloff without the previous 75–100 strokes per gauge.
    let steps = 16
    var previousAlpha = 0.0
    for step in 0..<steps {
      let progress = 0.5 + 0.5 * (Double(step) + 0.5) / Double(steps)
      // Android's stops: transparent halfway out, 40% at 80%, 74% at 95%, full at the rim.
      let intensity: Double
      if progress < 0.8 {
        intensity = (progress - 0.5) / 0.3 * 0.4
      } else if progress < 0.95 {
        intensity = 0.4 + (progress - 0.8) / 0.15 * 0.34
      } else {
        intensity = 0.74 + (progress - 0.95) / 0.05 * 0.26
      }
      let alpha = min(1, strength * intensity)
      // Each narrower stroke adds only the opacity missing from the wider passes beneath it.
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

  /// A short tick across the rim at the current value, perpendicular to whichever edge it landed
  /// on. The normal is taken from the path itself rather than from the edge, so the tick stays
  /// square to the line as it travels through a rounded corner.
  ///
  /// Which way it then points is decided by the screen centre, not by the direction of travel. The
  /// perpendicular of a path tangent flips sign with the tangent, and the two headline gauges run
  /// opposite ways around the rim — speed clockwise up the left edge, duty counter-clockwise up the
  /// right — so taking the raw normal aimed one tick inward and the other out under the bezel.
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

    // Point the tick at the centre of the screen, whichever way the gauge happens to travel.
    let toCentre = CGPoint(x: center.x - point.x, y: center.y - point.y)
    let facesCentre = normal.x * toCentre.x + normal.y * toCentre.y >= 0
    let inward = facesCentre ? normal : CGPoint(x: -normal.x, y: -normal.y)

    var tick = Path()
    tick.move(to: CGPoint(x: point.x + inward.x * HEAD_TICK_INNER, y: point.y + inward.y * HEAD_TICK_INNER))
    tick.addLine(to: CGPoint(x: point.x - inward.x * HEAD_TICK_OUTER, y: point.y - inward.y * HEAD_TICK_OUTER))
    stroke(tick, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .butt))
  }
}

/// The head tick reaches inward, where there is room, and barely past the rim, where there is not.
private let HEAD_TICK_INNER: CGFloat = 7
private let HEAD_TICK_OUTER: CGFloat = 2

/// Gradient fill strength on the gauges page; every gauge scales its glow off this.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `STRONG_GLOW`
let STRONG_GLOW = 0.38

/// How far the glow recedes once a page has taken focus. The value lines are left alone: they still
/// carry the reading, they just stop competing with whatever took the centre.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `dimGlow`
func dimGlow(_ focus: Double) -> Double { 1 - min(max(focus, 0), 1) * GLOW_FOCUS_DIM }

private let GLOW_FOCUS_DIM = 0.55

/// Telemetry readouts clear out ahead of the drag, so a page is alone well before it settles.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `fadeOut`
func fadeOut(_ focus: Double) -> Double { min(max(1 - focus * FOCUS_FADE_RATE, 0), 1) }

private let FOCUS_FADE_RATE = 1.8
