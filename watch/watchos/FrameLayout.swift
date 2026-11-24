import SwiftUI

/// @platform-diff watchOS renders the system clock over the app; Android's `WatchClock` has no peer.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `FrameLayout`
struct FrameLayout: View {
  let frame: WatchFrame
  var muted: Bool = false
  var ambient: AmbientMode = .off
  var showReadouts: Bool = true
  var navFocus: Double = 0
  var awayFocus: Double = 0
  var route: WatchRoute?
  var routeStatus: WatchRouteStatus?
  var groupRide: WatchGroupRide?
  var navArrowEnabled: Bool = false
  var telemetryTrailEnabled: Bool = true
  var telemetryGroupEnabled: Bool = true
  var telemetryRouteEnabled: Bool = true
  var streetMapEnabled: Bool = true
  var mapGaugesPercent: Int = WatchMapGauges.defaultPercent
  var distanceUnit: String = "km"
  var temperatureUnit: String = "celsius"

  private var focus: Double { max(navFocus, awayFocus) }

  var body: some View {
    let blind = ambient.active && muted
    WatchMapScene(
      frame: frame, muted: muted, ambient: ambient,
      navFocus: navFocus, awayFocus: awayFocus,
      route: route, routeStatus: routeStatus, groupRide: groupRide,
      navArrowEnabled: navArrowEnabled,
      telemetryTrailEnabled: telemetryTrailEnabled, telemetryGroupEnabled: telemetryGroupEnabled,
      telemetryRouteEnabled: telemetryRouteEnabled, streetMapEnabled: streetMapEnabled,
      mapGaugesPercent: mapGaugesPercent, distanceUnit: distanceUnit
    ) {
      gauges(blind: blind)
    } readouts: {
      if showReadouts {
        VStack(spacing: 0) {
          heroes(blind: blind)
            .scaleEffect(1 - HERO_FOCUS_SHRINK * focus)
            .offset(y: -HERO_FOCUS_RISE * focus)
          Spacer(minLength: 0)
        }
        .opacity(fadeOut(focus))

        temperatureReadouts(blind: blind)
        .scaleEffect(1 + TEMP_FOCUS_SPREAD * focus)
        .opacity(fadeOut(focus))

        VStack(spacing: 0) {
          Spacer(minLength: 0)
          secondaryValue(WatchGauge.batteryPercent(frame.battery, blind: blind), color: batteryColor)
            .accessibilityLabel("Battery")
            .padding(.bottom, BOTTOM_READOUT_INSET)
        }
        .offset(y: BATTERY_FOCUS_DROP * focus)
        .opacity(fadeOut(focus))
      }
    }
    .ignoresSafeArea()
  }

  private func gauges(blind: Bool) -> some View {
    Canvas { context, size in
      let rim = Rim.path(in: size, inset: Rim.inset)
      let metrics = Rim.Metrics(size: size, inset: Rim.inset)
      let glowDim = ambient.glow(dimGlow(focus))
      let glow = STRONG_GLOW * glowDim
      let batteryFraction = blind ? 0 : WatchGauge.batteryFraction(frame.battery)
      let motorFraction = blind ? 0 : WatchGauge.tempFraction(frame.motorTemp)
      let ctrlFraction = blind ? 0 : WatchGauge.tempFraction(frame.ctrlTemp)
      // @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `FrameLayout`
      let batteryGlow = (0.06 + 0.20 * batteryFraction) * glowDim
      let motorGlow = (0.08 + 0.40 * motorFraction) * glowDim
      let ctrlGlow = (0.08 + 0.40 * ctrlFraction) * glowDim
      let centre = CGPoint(x: metrics.rect.midX, y: metrics.rect.midY)

      context.drawRimGauge(
        rim, span: metrics.speed,
        fraction: blind ? 0 : WatchGauge.speedFraction(frame.speed),
        color: speedColor, style: .strong, glow: glow, center: centre
      )
      context.drawRimGauge(
        rim, span: metrics.duty,
        fraction: blind ? 0 : WatchGauge.dutyFraction(frame.duty),
        color: dutyColor, style: .strong, glow: glow, center: centre
      )
      context.drawRimGauge(
        rim, span: metrics.battery,
        fraction: batteryFraction,
        color: batteryColor, style: .soft, glow: batteryGlow, center: centre
      )
      context.drawRimGauge(
        rim, span: metrics.motorTemp,
        fraction: motorFraction,
        color: ambient.lane(frame.motorTemp, muted: muted, Palette.motorTemp),
        style: .soft, glow: motorGlow, center: centre
      )
      context.drawRimGauge(
        rim, span: metrics.ctrlTemp,
        fraction: ctrlFraction,
        color: ambient.lane(frame.ctrlTemp, muted: muted, Palette.ctrlTemp),
        style: .soft, glow: ctrlGlow, center: centre
      )
    }
    .ignoresSafeArea()
  }

  private func heroes(blind: Bool) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      hero(WatchGauge.hero(frame.speed.map { UnitPresentation.speedFromKmh($0, distanceUnit) }, blind: blind), unit: UnitPresentation.speedUnit(distanceUnit), label: muted ? "Stale Speed" : "Speed", color: speedColor)
      hero(WatchGauge.hero(frame.duty, blind: blind), unit: "%", label: muted ? "Stale Duty" : "Duty", color: dutyColor)
    }
    .padding(.top, HERO_TOP_INSET)
    .padding(.horizontal, Rim.innerInset)
  }

  private func hero(_ value: String, unit: String, label: String, color: Color) -> some View {
    let empty = value == WatchGauge.dash

    return VStack(spacing: -2) {
      Text(value)
        .font(WatchTypography.mono(size: empty ? HERO_EMPTY_FONT_SIZE : HERO_FONT_SIZE, weight: .semibold))
        .foregroundStyle(color)
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
      Text(unit)
        .font(WatchTypography.mono(size: 10))
        .foregroundStyle(Palette.secondaryText)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue("\(value) \(unit)")
  }

  private func temperatureReadouts(blind: Bool) -> some View {
    GeometryReader { geometry in
      let metrics = Rim.Metrics(size: geometry.size, inset: Rim.inset)
      let valueInset = metrics.radius * 0.85
      let valueY = metrics.rect.maxY - BOTTOM_READOUT_INSET - SECONDARY_FONT_SIZE * 0.6 + TEMP_VALUE_NUDGE
      let rim = Rim.path(in: geometry.size, inset: Rim.inset)
      let lineTop = rim.trimmedPath(from: 0, to: metrics.ctrlTemp.head).currentPoint?.y
        ?? metrics.rect.maxY - metrics.radius
      let labelY = lineTop + TEMP_LABEL_LENGTH / 2

      temperatureReadout(
        "MOTOR", value: WatchGauge.temp(frame.motorTemp, blind: blind, temperatureUnit: temperatureUnit),
        color: ambient.lane(frame.motorTemp, muted: muted, Palette.motorTemp),
        valuePosition: CGPoint(x: metrics.rect.minX + valueInset, y: valueY),
        labelPosition: CGPoint(x: metrics.rect.minX + 6, y: labelY), rotation: 90
      )
      temperatureReadout(
        "CTRL", value: WatchGauge.temp(frame.ctrlTemp, blind: blind, temperatureUnit: temperatureUnit),
        color: ambient.lane(frame.ctrlTemp, muted: muted, Palette.ctrlTemp),
        valuePosition: CGPoint(x: metrics.rect.maxX - valueInset, y: valueY),
        labelPosition: CGPoint(x: metrics.rect.maxX - 6, y: labelY), rotation: -90
      )
    }
  }

  private func temperatureReadout(
    _ label: String, value: String, color: Color,
    valuePosition: CGPoint, labelPosition: CGPoint, rotation: Double
  ) -> some View {
    ZStack {
      DegreeNumber(
        value: value.hasSuffix("°") ? String(value.dropLast()) : value,
        size: SECONDARY_FONT_SIZE,
        color: color
      )
      .position(valuePosition)
      Text(label)
        .font(WatchTypography.ui(size: 7))
        .foregroundStyle(Palette.secondaryText)
        .frame(width: TEMP_LABEL_LENGTH, height: 9, alignment: rotation > 0 ? .leading : .trailing)
        .rotationEffect(.degrees(rotation))
        .position(labelPosition)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue(value)
  }

  private func secondaryValue(_ value: String, color: Color) -> some View {
    Text(value)
      .font(WatchTypography.mono(size: SECONDARY_FONT_SIZE, weight: .medium))
      .foregroundStyle(color)
      .monospacedDigit()
      .fixedSize()
  }

  private var speedColor: Color {
    ambient.skeleton((muted || frame.speed == nil) ? Palette.dimText : Palette.speed)
  }

  private var dutyColor: Color {
    ambient.skeleton((muted || frame.duty == nil) ? Palette.dimText : Palette.duty)
  }

  private var batteryColor: Color {
    guard !muted, let battery = frame.battery else { return ambient.skeleton(Palette.dimText) }
    if ambient.active && battery < WatchGauge.batteryWarningPercent { return Palette.warning }
    return ambient.readout(Palette.battery(for: battery))
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `EMPTY_FRAME`
let EMPTY_FRAME = WatchFrame()

private let HERO_TOP_INSET: CGFloat = 39.5
private let HERO_FONT_SIZE: CGFloat = 38

private let HERO_EMPTY_FONT_SIZE: CGFloat = 20
private let SECONDARY_FONT_SIZE: CGFloat = 14
private let TEMP_LABEL_LENGTH: CGFloat = 28
private let TEMP_VALUE_NUDGE: CGFloat = 2
private let BOTTOM_READOUT_INSET: CGFloat = 8

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `HERO_FOCUS_RISE`
private let HERO_FOCUS_RISE: CGFloat = 30
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `HERO_FOCUS_SHRINK`
private let HERO_FOCUS_SHRINK = 0.12
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `BATTERY_FOCUS_DROP`
private let BATTERY_FOCUS_DROP: CGFloat = 18
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `TEMP_FOCUS_SPREAD`
private let TEMP_FOCUS_SPREAD = 0.06
