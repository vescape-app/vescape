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
/// far a page has taken over. Readouts retreat toward their gauges as the page moves into view.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `FrameLayout`
struct FrameLayout: View {
  let frame: WatchFrame
  var muted: Bool = false
  var ambient: AmbientMode = .off
  var showReadouts: Bool = true
  /// How far the *navigation* page has taken over. The telemetry readouts leave for it, but the nav
  /// stack — route, chevron, distance — is what the page is, so it stays and grows.
  var navFocus: Double = 0
  /// How far a page that is not navigation has taken over (the control axis, weather, radar). Those
  /// want the whole centre, so the nav stack leaves with the readouts.
  var awayFocus: Double = 0
  /// The route the phone pushed, drawn under everything else. Nil is no Navigation, or a route the
  /// rider cleared — the frame then renders exactly as it did before there was one.
  var route: WatchRoute?
  var routeStatus: WatchRouteStatus?
  var routeGeneration: Int = 0
  /// The joined Group Ride; nil draws no group. Hidden in ambient.
  var groupRide: WatchGroupRide?
  /// The rider's own colour, so route, chevron and rider dot match the phone map.
  var navColor: Color = Palette.nav
  /// Whether the rider turned the direction arrow on (phone: Settings > Watch).
  var navArrowEnabled: Bool = false
  var unitSystem: String = "metric"

  /// One eased zoom and course for every map layer, so the Group Ride marks sit where the route is
  /// drawn mid-zoom and mid-turn. `mapMoving` holds while it eases, and runs the layers' timelines.
  @State private var mapView = WatchMapView(spanM: WatchMapProjection.clampedSpanM(nil), courseDeg: nil)
  @State private var mapMoving = false

  /// Readouts retreat for any page; this is the one the existing layout animates against.
  private var focus: Double { max(navFocus, awayFocus) }

  /// The opposite pull on the nav stack: it survives nav focus and leaves for everything else.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `navStackAlpha`
  private var navStackAlpha: Double { fadeOut(awayFocus) }
  private var tiltColor: Color { (muted || ambient.active) ? Palette.dimText : Palette.tilt }

  /// Nav is all-or-nothing: the phone sends bearing and distance together or not at all, so one
  /// without the other is a frame this build should not draw half of.
  private var navLanes: (bearingDeg: Double, distanceM: Double)? {
    guard routeStatus?.canDraw(receivedRouteId: route?.routeId) != false else { return nil }
    guard let bearing = frame.navBearing, let distance = frame.navDistanceM else { return nil }
    return (bearing, distance)
  }

  private var routeNotice: WatchRouteNotice? {
    routeStatus?.notice(
      receivedRouteId: route?.routeId,
      hasPosition: frame.navBearing != nil && frame.navDistanceM != nil && frame.riderEastM != nil && frame.riderNorthM != nil
    )
  }

  /// What the map eases towards: Navigation's lanes, else the Group Ride's own. The Group Ride's
  /// course already holds across a stop; a nil frame course holds too.
  private var mapTarget: MapTarget {
    if navLanes == nil, let groupRide {
      return MapTarget(spanM: WatchMapProjection.clampedSpanM(groupRide.spanM), courseDeg: groupRide.courseDeg)
    }
    return MapTarget(spanM: WatchMapProjection.clampedSpanM(frame.routeSpanM), courseDeg: frame.courseDeg)
  }

  /// Nothing draws the map in ambient or with neither Navigation nor a Group Ride, so it lands
  /// there instead of easing.
  private var mapAnimates: Bool { !ambient.active && (navLanes != nil || groupRide != nil) }

  var body: some View {
    // A stale frame in ambient is the one case with nothing to say: the readings it would keep are
    // exactly the ones that have stopped arriving, so ambient empties every lane instead.
    let blind = ambient.active && muted

    ZStack {
      // Bottom layer: the route ahead and the rider on it, under every gauge and readout. Ambient
      // skips it — the lanes animate their zoom, and a moving map is the most expensive thing the
      // always-on panel could be asked to draw.
      if navLanes != nil, !ambient.active {
        NavRoute(
          route: route,
          generation: routeGeneration,
          frame: frame,
          mapView: mapView,
          mapMoving: mapMoving,
          focus: navFocus,
          color: muted ? Palette.dimText : navColor
        )
        .opacity(navStackAlpha)
      }

      // Group Ride dots: over the route, under every gauge and number. Hidden in ambient.
      if let groupRide, !ambient.active {
        GroupRideLayer(
          group: groupRide,
          mapView: mapView,
          mapMoving: mapMoving,
          drawOwnRing: navLanes == nil,
          ownColor: muted ? Palette.dimText : navColor,
          focus: navFocus,
          unitSystem: unitSystem
        )
        .opacity(navStackAlpha)
      }

      gauges(blind: blind)

      // Navigation, only while the phone is sending it. No destination means no nav lanes, and the
      // frame renders exactly as it would without this slice.
      if let routeNotice {
        if !ambient.active {
          RouteLoadingNotice(notice: routeNotice, color: navColor).opacity(navStackAlpha)
        }
      } else if let navLanes {
        NavPointer(
          bearingDeg: navLanes.bearingDeg,
          distanceM: navLanes.distanceM,
          unitSystem: unitSystem,
          focus: navFocus,
          stackAlpha: navStackAlpha,
          arrowEnabled: navArrowEnabled,
          color: (muted || ambient.active) ? Palette.dimText : navColor,
          remoteTilt: frame.remoteTilt,
          tiltColor: tiltColor
        )
      } else {
        // Nav focus with nothing to show would be a blank rectangle. Say why, but only once the
        // drag is nearly done, so it never flickers under the departing readouts.
        // A joined Group Ride is something to show on the map page: no "no navigation" over it.
        if groupRide == nil {
          NavAbsentHint(focus: navFocus, stackAlpha: navStackAlpha)
        }
        // No navigation: the tilt badge keeps the distance's slot to itself.
        VStack(spacing: 0) {
          Spacer(minLength: 0)
          TiltBadge(value: frame.remoteTilt, color: tiltColor)
            .padding(.bottom, NAV_READOUT_BOTTOM_INSET)
        }
        .opacity(navStackAlpha * (1 - navFocus))
      }

      if showReadouts {
        VStack(spacing: 0) {
          heroes(blind: blind)
            .scaleEffect(1 - HERO_FOCUS_SHRINK * focus)
            .offset(y: -HERO_FOCUS_RISE * focus)
          Spacer(minLength: 0)
        }
        .opacity(fadeOut(focus))

        // Scale the temperature layer around the screen centre, matching Android's outward
        // movement. The battery has its own layer because it retreats straight down.
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

      // Group Ride edge triangles: over the rim gauges. Hidden in ambient.
      if let groupRide, !ambient.active {
        GroupRideEdgeLayer(
          group: groupRide, mapView: mapView, mapMoving: mapMoving, focus: navFocus, unitSystem: unitSystem
        )
          .opacity(navStackAlpha)
      }
    }
    .ignoresSafeArea()
    .onAppear { retargetMap(animate: false) }
    .onChange(of: mapTarget) { retargetMap(animate: mapAnimates) }
    // Ambient (or losing both map sources) lands a map mid-ease, as Wear's relaunched effect does.
    .onChange(of: mapAnimates) { if !mapAnimates { retargetMap(animate: false) } }
    // Stops the layers' timelines once the map has landed, so a still map never redraws.
    .task(id: mapView.settlesAt) {
      let remaining = mapView.settlesAt.timeIntervalSinceNow
      if remaining > 0 {
        try? await Task.sleep(for: .seconds(remaining))
        if Task.isCancelled { return }
      }
      mapMoving = false
    }
  }

  private func retargetMap(animate: Bool) {
    let now = Date()
    mapView.retarget(spanM: mapTarget.spanM, courseDeg: mapTarget.courseDeg, at: now, animate: animate)
    mapMoving = mapView.settlesAt > now
  }

  // MARK: - Rim

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

  // MARK: - Readouts

  /// The pair the ride is actually read off, given the width the rectangle has and the circle did
  /// not: full-size digits side by side instead of two numbers squeezed between two arcs.
  private func heroes(blind: Bool) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      hero(WatchGauge.hero(frame.speed.map { UnitPresentation.speedFromKmh($0, unitSystem) }, blind: blind), unit: UnitPresentation.speedUnit(unitSystem), color: speedColor)
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
  }

  /// Values sit in the lower corners, level with the battery % between them; labels follow the
  /// straight side above each value. The entire layer still spreads from the screen centre during
  /// a swipe.
  private func temperatureReadouts(blind: Bool) -> some View {
    GeometryReader { geometry in
      let metrics = Rim.Metrics(size: geometry.size, inset: Rim.inset)
      let valueInset = metrics.radius * 0.85
      // Align the row-stepped temperature values with the battery baseline.
      let valueY = metrics.rect.maxY - BOTTOM_READOUT_INSET - SECONDARY_FONT_SIZE * 0.6 + TEMP_VALUE_NUDGE
      // The label anchors at the temperature arc's upper end: it starts where the arc reaches the
      // straight side edge and runs down beside the value below it.
      let rim = Rim.path(in: geometry.size, inset: Rim.inset)
      let lineTop = rim.trimmedPath(from: 0, to: metrics.ctrlTemp.head).currentPoint?.y
        ?? metrics.rect.maxY - metrics.radius
      let labelY = lineTop + TEMP_LABEL_LENGTH / 2

      temperatureReadout(
        "MOTOR", value: WatchGauge.temp(frame.motorTemp, blind: blind),
        color: ambient.lane(frame.motorTemp, muted: muted, Palette.motorTemp),
        valuePosition: CGPoint(x: metrics.rect.minX + valueInset, y: valueY),
        labelPosition: CGPoint(x: metrics.rect.minX + 6, y: labelY), rotation: 90
      )
      temperatureReadout(
        "CTRL", value: WatchGauge.temp(frame.ctrlTemp, blind: blind),
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

/// Down at the shoulders: the km/h / % label bottom sits at the height where the speed and duty
/// arcs reach the rim, just under the clock and weather stack.
private let HERO_TOP_INSET: CGFloat = 39.5
private let HERO_FONT_SIZE: CGFloat = 38

/// A dash is set well below hero size so it reads as "nothing here" rather than as a filled bar.
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

/// What ``FrameLayout``'s map eases towards.
private struct MapTarget: Equatable {
  let spanM: Double
  let courseDeg: Double?
}
