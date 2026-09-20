import SwiftUI

/// Navigation overlay on the Watch Frame: a hollow chevron riding just inside the rim at the
/// target's bearing (relative to travel direction, so "up" is straight ahead), plus a map pin and
/// the remaining distance above the battery readout. Nav has no slot of its own — it floats over
/// the gauges, and the whole overlay is absent unless the phone actually sent nav lanes, so a rider
/// without a destination sees the plain telemetry frame.
///
/// `focus` is the nav-focus progress: as the telemetry readouts leave, the chevron and the distance
/// grow into the room they free up. `stackAlpha` is the opposite pull — the control and weather
/// pages take the whole centre, so the nav stack fades out with the readouts.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavPointer.kt `NavPointer`
/// @platform-diff Wear OS places the chevron on the circle its gauges ring. Here it rides the
///   display's own rounded-rectangle perimeter (``Rim``) at the same bearing, so a bearing of 90°
///   points at the right *edge* rather than at a point on a circle the panel does not have.
struct NavPointer: View {
  let bearingDeg: Double
  let distanceM: Double
  var unitSystem: String = "metric"
  var focus: Double = 0
  var stackAlpha: Double = 1
  /// Whether the rider turned the direction arrow on. The chevron alone is opt-in (phone: Settings
  /// > Watch); everything else nav draws — route, rider dot, pin, distance — ignores the switch.
  var arrowEnabled: Bool
  var color: Color

  var body: some View {
    ZStack {
      if arrowEnabled {
        Canvas { context, size in
          let grow = 1 + CHEVRON_FOCUS_GROWTH * focus
          let at = Rim.point(in: size, inset: NAV_RIM_INSET, bearingDeg: bearingDeg)
          context.drawChevron(
            at: at,
            width: CHEVRON_WIDTH * grow,
            height: CHEVRON_HEIGHT * grow,
            rotationDeg: bearingDeg,
            color: color
          )
        }
        .opacity(stackAlpha)
      }

      VStack(spacing: 0) {
        Spacer(minLength: 0)
        HStack(spacing: PIN_GAP) {
          Canvas { context, size in
            context.drawMapPin(
              at: CGPoint(x: size.width / 2, y: size.height / 2),
              size: min(size.width, size.height) * 0.74,
              color: color
            )
          }
          .frame(width: PIN_BOX, height: PIN_BOX)
          Text(WatchGauge.distance(distanceM, unitSystem: unitSystem))
            .font(WatchTypography.mono(size: DISTANCE_FONT_SIZE))
            .foregroundStyle(color)
            .monospacedDigit()
        }
        .padding(.bottom, NAV_READOUT_BOTTOM_INSET)
      }
      // Drops into the band the battery readout vacates, and grows there.
      .offset(y: READOUT_FOCUS_DROP * focus)
      .scaleEffect(1 + READOUT_FOCUS_GROWTH * focus)
      .opacity(stackAlpha)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Distance remaining")
    .accessibilityValue(WatchGauge.distance(distanceM, unitSystem: unitSystem))
  }
}

/// What the nav page shows when the phone is not navigating: a centred, dim two-liner that fades in
/// as the readouts leave, so nav focus with nothing to show is never a blank screen.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `NavAbsentHint`
struct NavAbsentHint: View {
  var focus: Double = 0
  var stackAlpha: Double = 1

  var body: some View {
    VStack(spacing: 4) {
      PhosphorGlyph(.mapPin, size: HINT_ICON_SIZE, color: Palette.dimText)
      Text("No navigation")
        .font(WatchTypography.ui(size: 14))
        .foregroundStyle(Palette.secondaryText)
      Text("Set a destination on your phone")
        .font(WatchTypography.ui(size: HINT_FONT_SIZE))
        .foregroundStyle(Palette.dimText)
        .multilineTextAlignment(.center)
    }
    .padding(.horizontal, 24)
    // Only once the drag is nearly done, so it never flickers under the departing readouts.
    .opacity(fadeIn(focus) * stackAlpha)
  }
}

/// The mirror of ``fadeOut``: a page's own content arrives only after the readouts have gone.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `fadeIn`
func fadeIn(_ focus: Double) -> Double { min(max((focus - FADE_IN_START) / (1 - FADE_IN_START), 0), 1) }

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `HINT_FADE_ONSET`
private let FADE_IN_START = 0.6

extension GraphicsContext {
  /// Wide hollow chevron over a translucent fill. Points up before rotation, centred on `at`.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavPointer.kt `drawChevron`
  func drawChevron(at: CGPoint, width: CGFloat, height: CGFloat, rotationDeg: Double, color: Color) {
    let halfW = width / 2
    let halfH = height / 2
    let notch = height * 0.34
    var outline = Path()
    outline.move(to: CGPoint(x: at.x, y: at.y - halfH))
    outline.addLine(to: CGPoint(x: at.x + halfW, y: at.y + halfH * 0.28))
    outline.addLine(to: CGPoint(x: at.x + halfW, y: at.y + halfH))
    outline.addLine(to: CGPoint(x: at.x, y: at.y + halfH - notch))
    outline.addLine(to: CGPoint(x: at.x - halfW, y: at.y + halfH))
    outline.addLine(to: CGPoint(x: at.x - halfW, y: at.y + halfH * 0.28))
    outline.closeSubpath()
    let rotated = outline.applying(
      CGAffineTransform(translationX: at.x, y: at.y)
        .rotated(by: rotationDeg * .pi / 180)
        .translatedBy(x: -at.x, y: -at.y)
    )
    fill(rotated, with: .color(color.opacity(0.22)))
    stroke(rotated, with: .color(color), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
  }

  /// Map-pin glyph: stroked head, two tail lines to the tip, filled centre dot.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavPointer.kt `drawMapPin`
  func drawMapPin(at: CGPoint, size: CGFloat, color: Color) {
    let head = size * 0.36
    let headCentre = CGPoint(x: at.x, y: at.y - size * 0.5 + head)
    let stroke = StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round)
    var arc = Path()
    // Head arc gap sits at the bottom (canvas y is down), where the two tail lines take over.
    arc.addArc(
      center: headCentre, radius: head,
      startAngle: .degrees(145), endAngle: .degrees(145 + 250), clockwise: false
    )
    self.stroke(arc, with: .color(color), style: stroke)
    let tip = CGPoint(x: at.x, y: at.y + size * 0.5)
    for degrees in [35.0, 145.0] {
      var tail = Path()
      tail.move(to: pointOnCircle(centre: headCentre, radius: head, degrees: degrees))
      tail.addLine(to: tip)
      self.stroke(tail, with: .color(color), style: stroke)
    }
    fill(
      Path(ellipseIn: CGRect(
        x: headCentre.x - head * 0.34, y: headCentre.y - head * 0.34,
        width: head * 0.68, height: head * 0.68
      )),
      with: .color(color)
    )
  }
}

private func pointOnCircle(centre: CGPoint, radius: CGFloat, degrees: Double) -> CGPoint {
  let radians = degrees * .pi / 180
  return CGPoint(x: centre.x + radius * cos(radians), y: centre.y + radius * sin(radians))
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavPointer.kt `NAV_RIM_INSET`
private let NAV_RIM_INSET: CGFloat = 22
/// Sits in the band between the rider dot and the battery readout.
private let NAV_READOUT_BOTTOM_INSET: CGFloat = 32
private let CHEVRON_FOCUS_GROWTH = 0.18
private let READOUT_FOCUS_DROP: CGFloat = 6
private let READOUT_FOCUS_GROWTH = 0.25
private let CHEVRON_WIDTH: CGFloat = 26
private let CHEVRON_HEIGHT: CGFloat = 22
private let PIN_BOX: CGFloat = 11
private let PIN_GAP: CGFloat = 3
private let DISTANCE_FONT_SIZE: CGFloat = 12
private let HINT_ICON_SIZE: CGFloat = 22
private let HINT_FONT_SIZE: CGFloat = 11
