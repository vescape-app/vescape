import SwiftUI

/// Wrist layout for a live Watch Frame, adapted to the rectangle.
///
/// Wear OS hangs three arcs off one screen-centred circle with the temperatures written as curved
/// text along the rim. Here the gauges follow the display edge (``Rim``) and the readouts take the
/// bands the rectangle gives that a circle does not: speed and duty across the top, motor and
/// controller in the bottom corners beside their own arcs, battery between them. The centre stays
/// free for whatever page the rider is on. Same metrics, same units, same colours — the shape is the
/// accepted platform difference (docs/watchos.md), the numbers are not.
///
/// `muted` dims every value so a frozen (stale) reading is never shown as live. `showReadouts`
/// strips every value out of the shell and leaves the gauges, the clock and nothing else: a stalled
/// stream has nothing to put in them but dashes, and a row of dashes is noise around the one thing
/// worth reading, which is why it stalled.
///
/// There is no wall clock here. Wear OS draws its own because a full-screen activity hides the
/// system time; watchOS keeps the system time on top of every app, so a second one is a duplicate
/// sitting next to the real thing.
///
/// @platform-diff watchOS renders the system clock over the app; Android's `WatchClock` has no peer.
///
/// This layout is pinned at the root of the mirror, behind the pages: the rim gauges are permanent
/// furniture and never move, whatever page the rider swipes or turns the crown to. `focus` says how
/// far a page has taken over — read as a closure so a drag repaints the gauges without recomposing
/// the layout around them.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `FrameLayout`
struct FrameLayout: View {
  let frame: WatchFrame
  var muted: Bool = false
  var ambient: AmbientMode = .off
  var showReadouts: Bool = true
  var focus: Double = 0

  var body: some View {
    // A stale frame in ambient is the one case with nothing to say: the readings it would keep are
    // exactly the ones that have stopped arriving, so ambient empties every lane instead.
    let blind = ambient.active && muted

    ZStack {
      gauges(blind: blind)

      if showReadouts {
        VStack(spacing: 0) {
          heroes(blind: blind)
          Spacer(minLength: 0)
          bottomReadouts(blind: blind)
        }
        .opacity(fadeOut(focus))
      }
    }
    .ignoresSafeArea()
  }

  // MARK: - Rim

  private func gauges(blind: Bool) -> some View {
    Canvas { context, size in
      let rim = Rim.path(in: size, inset: Rim.inset)
      let metrics = Rim.Metrics(size: size, inset: Rim.inset)
      let glow = ambient.glow(STRONG_GLOW * dimGlow(focus))

      context.drawRimGauge(
        rim, span: metrics.speed,
        fraction: blind ? 0 : WatchGauge.speedFraction(frame.speed),
        color: speedColor, style: .strong, glow: glow
      )
      context.drawRimGauge(
        rim, span: metrics.duty,
        fraction: blind ? 0 : WatchGauge.dutyFraction(frame.duty),
        color: dutyColor, style: .strong, glow: glow
      )
      context.drawRimGauge(
        rim, span: metrics.battery,
        fraction: blind ? 0 : WatchGauge.batteryFraction(frame.battery),
        color: batteryColor, style: .soft, glow: glow * BATTERY_GLOW_SCALE
      )
      context.drawRimGauge(
        rim, span: metrics.motorTemp,
        fraction: blind ? 0 : WatchGauge.tempFraction(frame.motorTemp),
        color: ambient.lane(frame.motorTemp, muted: muted, Palette.motorTemp),
        style: .soft, glow: glow * TEMP_GLOW_SCALE
      )
      context.drawRimGauge(
        rim, span: metrics.ctrlTemp,
        fraction: blind ? 0 : WatchGauge.tempFraction(frame.ctrlTemp),
        color: ambient.lane(frame.ctrlTemp, muted: muted, Palette.ctrlTemp),
        style: .soft, glow: glow * TEMP_GLOW_SCALE
      )
    }
    .ignoresSafeArea()
  }

  // MARK: - Readouts

  /// The pair the ride is actually read off, given the width the rectangle has and the circle did
  /// not: full-size digits side by side instead of two numbers squeezed between two arcs.
  private func heroes(blind: Bool) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      hero(WatchGauge.hero(frame.speed, blind: blind), unit: "km/h", color: speedColor)
      hero(WatchGauge.hero(frame.duty, blind: blind), unit: "%", color: dutyColor)
    }
    .padding(.top, HERO_TOP_INSET)
    .padding(.horizontal, Rim.innerInset)
  }

  private func hero(_ value: String, unit: String, color: Color) -> some View {
    // The placeholder is not just a small number: an em dash set at display size reads as a
    // progress bar, which is exactly the wrong thing for "no reading" to look like.
    let empty = value == WatchGauge.dash

    return VStack(spacing: -2) {
      Text(value)
        .font(.system(size: empty ? HERO_EMPTY_FONT_SIZE : HERO_FONT_SIZE, weight: .semibold, design: .rounded))
        .foregroundStyle(color)
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
      Text(unit)
        .font(.system(size: 10))
        .foregroundStyle(Palette.secondaryText)
    }
    .frame(maxWidth: .infinity)
  }

  /// Motor and controller sit over the corners their own arcs grow out of, battery between them
  /// over its own. Wear OS bends these along the rim; a rectangle has a flat bottom edge and three
  /// readouts fit across it upright, which is easier to read and needs no curved text at all.
  private func bottomReadouts(blind: Bool) -> some View {
    HStack(alignment: .bottom, spacing: 0) {
      labelled(
        "MOTOR", WatchGauge.temp(frame.motorTemp, blind: blind),
        ambient.lane(frame.motorTemp, muted: muted, Palette.motorTemp)
      )
      labelled(
        "BATT", WatchGauge.batteryPercent(frame.battery, blind: blind), batteryColor
      )
      labelled(
        "CTRL", WatchGauge.temp(frame.ctrlTemp, blind: blind),
        ambient.lane(frame.ctrlTemp, muted: muted, Palette.ctrlTemp)
      )
    }
    .padding(.bottom, BOTTOM_READOUT_INSET)
    .padding(.horizontal, Rim.innerInset)
  }

  private func labelled(_ label: String, _ value: String, _ color: Color) -> some View {
    VStack(spacing: 0) {
      Text(value)
        .font(.system(size: SECONDARY_FONT_SIZE, weight: .medium, design: .rounded))
        .foregroundStyle(color)
        .monospacedDigit()
      Text(label)
        .font(.system(size: 8))
        .foregroundStyle(Palette.secondaryText)
    }
    .frame(maxWidth: .infinity)
  }

  // MARK: - Lane colours

  private var speedColor: Color {
    ambient.skeleton((muted || frame.speed == nil) ? Palette.dimText : Palette.speed)
  }

  private var dutyColor: Color {
    ambient.skeleton((muted || frame.duty == nil) ? Palette.dimText : Palette.duty)
  }

  /// Low battery keeps its warning colour into ambient: it is the one reading a glance must not
  /// mistake for ordinary state.
  private var batteryColor: Color {
    guard !muted, let battery = frame.battery else { return ambient.skeleton(Palette.dimText) }
    if ambient.active && battery < WatchGauge.batteryWarningPercent { return Palette.warning }
    return ambient.readout(Palette.battery(for: battery))
  }
}

/// Stable gauge shell shown before the first phone frame; every board lane renders as disabled.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `EMPTY_FRAME`
let EMPTY_FRAME = WatchFrame()

/// Clear of the clock, and clear of the two gauges climbing toward it.
private let HERO_TOP_INSET: CGFloat = 22
private let HERO_FONT_SIZE: CGFloat = 38

/// A dash is set well below hero size so it reads as "nothing here" rather than as a filled bar.
private let HERO_EMPTY_FONT_SIZE: CGFloat = 20
private let SECONDARY_FONT_SIZE: CGFloat = 15
private let BOTTOM_READOUT_INSET: CGFloat = 12

/// The quieter gauges carry less glow than the headline pair, the same ratios Android uses.
private let BATTERY_GLOW_SCALE = 0.55
private let TEMP_GLOW_SCALE = 0.7
