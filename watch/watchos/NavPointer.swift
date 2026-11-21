import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/NavPointer.kt `NavPointer`
/// @platform-diff Wear OS places the chevron on the circle its gauges ring. Here it rides the
struct NavPointer: View {
  let bearingDeg: Double
  let distanceM: Double
  var distanceUnit: String = "km"
  var focus: Double = 0
  var stackAlpha: Double = 1
  var arrowEnabled: Bool
  var color: Color
  var remoteTilt: Int?
  var tiltColor: Color = Palette.tilt

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
          Text(WatchGauge.distance(distanceM, distanceUnit: distanceUnit))
            .font(WatchTypography.mono(size: DISTANCE_FONT_SIZE))
            .foregroundStyle(color)
            .monospacedDigit()
          TiltBadge(value: remoteTilt, color: tiltColor)
            .padding(.leading, TILT_BADGE_GAP)
        }
        .padding(.bottom, NAV_READOUT_BOTTOM_INSET)
      }
      .offset(y: READOUT_FOCUS_DROP * focus)
      .scaleEffect(1 + READOUT_FOCUS_GROWTH * focus)
      .opacity(stackAlpha)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Distance remaining")
    .accessibilityValue(WatchGauge.distance(distanceM, distanceUnit: distanceUnit))
  }
}

extension GraphicsContext {
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

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavPointer.kt `drawMapPin`
  func drawMapPin(at: CGPoint, size: CGFloat, color: Color) {
    let head = size * 0.36
    let headCentre = CGPoint(x: at.x, y: at.y - size * 0.5 + head)
    let stroke = StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round)
    var arc = Path()
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
let NAV_READOUT_BOTTOM_INSET: CGFloat = 32
private let CHEVRON_FOCUS_GROWTH = 0.18
private let READOUT_FOCUS_DROP: CGFloat = 6
private let READOUT_FOCUS_GROWTH = 0.25
private let CHEVRON_WIDTH: CGFloat = 26
private let CHEVRON_HEIGHT: CGFloat = 22
private let PIN_BOX: CGFloat = 11
private let PIN_GAP: CGFloat = 3
private let DISTANCE_FONT_SIZE: CGFloat = 12

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapScene.kt `TiltBadge`
struct TiltBadge: View {
  let value: Int?
  let color: Color

  var body: some View {
    if let value, WatchTiltStick.rounded(WatchTiltStick.percent(value: value)) != 0 {
      Text("\u{2220}\(WatchTiltStick.format(WatchTiltStick.percent(value: value)))")
        .font(WatchTypography.mono(size: DISTANCE_FONT_SIZE))
        .monospacedDigit()
        .foregroundStyle(color)
        .fixedSize()
        .accessibilityLabel("Remote tilt")
    }
  }
}

private let TILT_BADGE_GAP: CGFloat = 8

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapScene.kt `RouteFailureNotice`
struct RouteFailureNotice: View {
  var body: some View {
    Text("Route unavailable").font(WatchTypography.ui(size: 12)).foregroundStyle(Palette.primaryText)
  }
}
