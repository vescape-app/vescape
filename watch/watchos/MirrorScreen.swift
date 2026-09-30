import SwiftUI

/// Screen shell around the live Watch Frame. The rim gauges (``FrameLayout``) are pinned at the
/// root and drawn once; both page axes are transparent and only swap what sits in the centre, so
/// the rider never loses speed, duty, battery and temperatures by navigating away.
///
/// The page structure is Android's, axis for axis and order for order: radar and weather above the
/// gauges, the navigation focus below, and the Board controls across. Most of those pages are
/// filled by later slices of the port — what this screen owns is that the axes exist, travel in the
/// same directions, and gate their contents the same way.
///
/// **Navigation inputs.** Swipes are kept exactly as Android has them. The Digital Crown drives the
/// vertical scroll view as well: an alternative input, not a
/// replacement for touch and not a Board control (docs/watchos.md).
///
/// Ambient does not replace this tree, it settles it: the pages stay mounted and are parked on the
/// gauges, so going in and out of the Always On state never rebuilds the screen or restarts the
/// idle clock. What ambient changes is inside ``AmbientMode``.
///
/// Leaving reports an asleep wake level. Tilt, Move and Lights also gate on the active scene phase.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `MirrorScreen`
/// @platform-diff watchOS uses system navigation to leave the app, without Wear OS's close prompt.
struct MirrorScreen: View {
  @ObservedObject var link: PhoneLink
  /// watchOS's single always-on signal. Wear OS gets a callback with panel capabilities; here the
  /// environment value is the whole of it.
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced

  /// Optional because `scrollPosition(id:)` binds an optional; it is only nil mid-flight between
  /// pages, and every read below treats that as "not on the gauges".
  @State private var vertical: VerticalPage? = .gauges
  @State private var control: ControlPage? = .gauges
  @State private var pagePositions: [Axis: Double] = [:]
  @State private var settledPositions: [Axis: Double] = [:]
  @State private var verticalPagingEnabled = true
  /// A control page holding the rider's finger: a Board Move hold or a Tilt stick drag. Both pagers
  /// lock while it is true and the idle return is suspended: a hold must not be read as a page
  /// swipe, and the page must never move out from under a finger that is driving the board.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `controlHeld`
  @State private var controlHeld = false
  /// A sideways drag the Tilt stick took from the control pager, points the pages follow the finger
  /// by. Zero whenever no such drag is in flight.
  @State private var controlDrag: CGFloat = 0
  @State private var lastInteraction = Date()
  /// Foreground/background, which is what decides whether the Mirror is awake at all. Ambient is a
  /// second, narrower question asked only while it is.
  @Environment(\.scenePhase) private var scenePhase

  private var ambient: AmbientMode { AmbientMode(active: isLuminanceReduced) }

  var body: some View {
    // Pager hit regions and page sizes must share the full-screen bounds of FrameLayout.
    // Keeping only the gauges edge-to-edge leaves dead strips and offset page boundaries.
    mirrorBody.ignoresSafeArea()
  }

  private var mirrorBody: some View {
    // A timeline rather than a timer: in the Always On state the system decides how often this
    // re-evaluates, so a stopped stream ages into `disconnected` at whatever rate the watch is
    // willing to pay for, and the degradation is itself the measurement docs/watchos.md wants.
    TimelineView(.periodic(from: .now, by: refreshInterval)) { _ in
      ZStack {
        pages
        // Pinned over the pages and never inside one: the rider keeps speed, duty, battery and
        // temperatures on every page. Nothing in it takes pointer input, so the pages below stay
        // reachable through it.
        frame
          .allowsHitTesting(false)
      }
      .overlay(alignment: .topLeading) {
        if linkNotice != nil {
          EmptyView()
        } else {
          HStack(spacing: 0) {
            WeatherReadout(
              forecast: freshWeather,
              ambient: ambient,
              onTap: interactionEnabled(.gauges) ? { withAnimation { vertical = .weather } } : nil
            )
            .frame(maxWidth: .infinity)
            Color.clear
              .frame(maxWidth: .infinity)
              .frame(height: 0)
          }
          .opacity(fadeOut(max(navFocus, awayFocus)))
          .allowsHitTesting(interactionEnabled(.gauges))
          .padding(.horizontal, Rim.innerInset)
          .padding(.top, 10)
        }
      }
      .onPreferenceChange(PagePositionKey.self) { values in
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
          pagePositions = values
          settledPositions = [:]
          lastInteraction = Date()
        }
      }
      .task(id: pagePositions) {
        // A cancellable quiet period validates measured alignment, never an assumed animation
        // duration. Every movement cancels this task and closes the interaction gate immediately.
        let positions = pagePositions
        try? await Task.sleep(for: .milliseconds(100))
        guard !Task.isCancelled else { return }
        settledPositions = positions
        if let horizontal = positions[.horizontal], abs(horizontal.rounded() - horizontal) < 0.001 {
          verticalPagingEnabled = abs(horizontal) < 0.001
        }
      }
      // A hold both suspends the countdown and, on release, restarts it: the 45 s is measured from
      // the last thing the rider did, and a long hold is very much something they did.
      .onChange(of: controlHeld) { _, _ in lastInteraction = Date() }
      .task(id: lastInteraction) {
        try? await Task.sleep(for: .seconds(CONTROL_IDLE_RETURN_SECONDS))
        guard !Task.isCancelled, !controlHeld, !isLuminanceReduced, control != .gauges
        else { return }
        withAnimation { control = .gauges }
      }
      .task(id: tick) { link.refresh() }
    }
    .onChange(of: isLuminanceReduced) { _, reduced in
      reportWakeLevel()
      // The wrist goes always-on wherever the rider left it. Ambient only ever draws the gauges, so
      // park both axes there first — otherwise the gauges would be pinned over a control page the
      // rider can no longer swipe away.
      guard reduced else { return }
      vertical = .gauges
      control = .gauges
      controlDrag = 0
      verticalPagingEnabled = true
    }
    .onChange(of: scenePhase) { _, _ in reportWakeLevel() }
    .onAppear { reportWakeLevel() }
  }

  /// The phone owns the push cadence but not the fact it turns on: only the wrist knows whether it
  /// is on screen, in the Always On state, or gone. Reported on every change of either input.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `wakeHeartbeat`
  private func reportWakeLevel() {
    let level: WatchMirrorWakeLevel
    switch scenePhase {
    case .active: level = isLuminanceReduced ? .ambient : .active
    // Inactive is the Always On state's phase as much as it is a transition, so it is reported as
    // ambient rather than as gone: a wrist that is still drawing wants frames, only fewer.
    case .inactive: level = .ambient
    default: level = .asleep
    }
    link.reportWakeLevel(level)
  }

  /// Re-evaluation cadence: the phone's own push interval while the screen is on, and the reduced
  /// ambient one while it is not.
  private var refreshInterval: TimeInterval {
    isLuminanceReduced ? AMBIENT_REFRESH_INTERVAL_SECONDS : ACTIVE_REFRESH_INTERVAL_SECONDS
  }

  /// Something that changes on every timeline beat, so the reduce runs once per beat instead of
  /// once per body evaluation.
  // Series 6 uses 32-bit Int; epoch-based refresh counts already exceed its range.
  private var tick: Int64 { Int64(Date().timeIntervalSince1970 / refreshInterval) }

  /// Whether the radar page is allowed to fetch. It is the one surface on the wrist that spends
  /// network on its own, so this is the difference between an idle watch and a fetching one: the
  /// radar page has to be the settled page, the app has to be in the foreground, and the wrist must
  /// not be in the Always On state. A wrist left on the radar page and then lowered stops fetching
  /// rather than looping on a screen nobody can see.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `radarVisible`
  private var radarVisible: Bool {
    vertical == .radar && scenePhase == .active && !isLuminanceReduced
  }

  /// The phone's forecast while it is still worth believing. Re-read per timeline beat, so an
  /// aged-out reading disappears on its own without waiting for a push that is never coming.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `freshWeather`
  private var freshWeather: WatchWeather? { link.freshWeather() }

  // MARK: - Axes

  /// One scroll view owns the whole vertical axis, and the crown with it. Android stacks the same
  /// four pages; nesting two vertical pagers there made them compete for the same drag, and the
  /// same would be true of two crown-bound views here.
  ///
  /// A paging `ScrollView` rather than `TabView(.verticalPage)`, for one reason: the vertical page
  /// style draws a dot indicator down the right edge and offers no way to turn it off —
  /// `indexDisplayMode` exists only on `.page`. Those dots land exactly on the duty gauge, which
  /// runs up that same edge. watchOS binds the Digital Crown to a scroll view natively, so this
  /// keeps the crown, keeps the swipe, gains page snapping, and lets the indicator be hidden.
  private var pages: some View {
    ScrollView(.vertical) {
      LazyVStack(spacing: 0) {
        ForEach(verticalPages) { page in
          verticalContent(page)
            // Each page is exactly one screen, which is what makes paging land on page boundaries.
            .containerRelativeFrame([.horizontal, .vertical])
            .background {
              pagePosition(axis: .vertical, index: page.rawValue, origin: VerticalPage.gauges.rawValue)
            }
            .id(page)
        }
      }
      .scrollTargetLayout()
      .contentShape(Rectangle())
    }
    .coordinateSpace(name: Axis.vertical)
    .scrollTargetBehavior(.paging)
    .scrollPosition(id: $vertical)
    // The rim gauges are the furniture on this edge; a scroll bar over them is the thing being
    // fixed here, not a thing to keep.
    .scrollIndicators(.hidden)
    // Ambient has already parked the axis, and a page animation there is wasted panel.
    // Set the axis's environment directly so the nested horizontal pager can override it.
    .environment(\.isScrollEnabled, !isLuminanceReduced && verticalPagingEnabled && !controlHeld)
    .onChange(of: vertical) { _, _ in lastInteraction = Date() }
    // Leaving the ride on the Group Ride page lands on navigation, one page up.
    .onChange(of: link.groupRide == nil) { _, left in
      if left, vertical == .group { vertical = .nav }
    }
  }

  /// The Group Ride page exists only while joined. It is the last page, so adding or dropping it
  /// never renumbers the pages above it.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `VERTICAL_PAGE_COUNT_JOINED`
  private var verticalPages: [VerticalPage] {
    link.groupRide == nil ? VerticalPage.allCases.filter { $0 != .group } : VerticalPage.allCases
  }

  @ViewBuilder
  private func verticalContent(_ page: VerticalPage) -> some View {
    switch page {
    case .radar:
      RadarScreen(
        visible: radarVisible,
        forecast: freshWeather,
        onFetchFailed: { link.recordRadarFailure() },
        riderColor: Palette.rider(link.settings.riderColor) ?? Palette.speed,
        unitSystem: link.settings.unitSystem
      )
    case .weather:
      WeatherScreen(forecast: freshWeather, everReceived: link.weather != nil)
    case .gauges:
      controls
    case .nav:
      // Empty on purpose, like the gauges control page: this page *is* the route and the nav stack,
      // which the pinned frame already draws. It grows into the centre as the readouts leave.
      Color.clear
    case .group:
      if let groupRide = link.groupRide {
        GroupRidePage(
          group: groupRide,
          settled: groupPageSettled,
          unitSystem: link.settings.unitSystem,
          onPageBack: { withAnimation { vertical = .nav } }
        )
      } else {
        Color.clear
      }
    }
  }

  /// The horizontal control axis, live only on the gauges page. From a control page a vertical
  /// swipe would open a blank page over something the rider is working on, which is why Android
  /// gates the vertical axis on the control page too. Each axis has its own scroll-enabled value.
  private var controls: some View {
    ScrollView(.horizontal) {
      LazyHStack(spacing: 0) {
        ForEach(ControlPage.allCases) { page in
          controlContent(page)
            .containerRelativeFrame([.horizontal, .vertical])
            .background {
              Color.black
                .contentShape(Rectangle())
                .onTapGesture { lastInteraction = Date() }
            }
            .contentShape(Rectangle())
            .background {
              pagePosition(axis: .horizontal, index: page.rawValue, origin: ControlPage.gauges.rawValue)
            }
            .id(page)
        }
      }
      .scrollTargetLayout()
      // The Tilt page's sideways drag, drawn the way the pager would: every page moves together, and
      // the page positions measured below follow it, so fades and gates behave as on a native drag.
      .offset(x: controlDrag)
      .contentShape(Rectangle())
    }
    .coordinateSpace(name: Axis.horizontal)
    .scrollTargetBehavior(.paging)
    .scrollPosition(id: $control)
    .scrollIndicators(.hidden)
    // Override the outer vertical scroll lock: returning horizontally must remain possible. A held
    // Move or a Tilt drag is the one thing that closes this axis too — leaving the page mid-hold
    // would cancel the press and strand the rider's intent somewhere the page no longer shows.
    .environment(\.isScrollEnabled, !isLuminanceReduced && !controlHeld)
    .onChange(of: control) { _, _ in lastInteraction = Date() }
  }

  @ViewBuilder
  private func controlContent(_ page: ControlPage) -> some View {
    switch page {
    case .gauges:
      // Empty on purpose: this page *is* the gauges, pinned at the root behind this transparent
      // axis. Only the reason a stalled stream has stopped gets to use the centre.
      if let linkNotice {
        DisconnectedLayout(notice: linkNotice, ambient: ambient)
      } else {
        // Keep the pager slot; weather and telemetry are pinned above it.
        Color.clear
      }
    case .tilt:
      TiltScreen(
        link: link,
        interactionEnabled: interactionEnabled(.tilt),
        onHoldChanged: { controlHeld = $0 },
        onPageDrag: { offset in
          var transaction = Transaction()
          transaction.disablesAnimations = true
          withTransaction(transaction) { controlDrag = offset }
        },
        onPageRelease: { step in
          // Nothing offset: the page is leaving with no sideways drag in flight.
          guard controlDrag != 0 else { return }
          withAnimation {
            controlDrag = 0
            if let next = ControlPage(rawValue: ControlPage.tilt.rawValue + step) { control = next }
          }
        }
      )
    case .move:
      MoveScreen(
        link: link,
        // The transition gate and the pager locks answer different questions: this one refuses to
        // *start* a hold on a page that has not settled, the locks stop a started hold from being
        // taken away by a swipe.
        interactionEnabled: interactionEnabled(.move),
        onHoldChanged: { controlHeld = $0 }
      )
    case .lights:
      LightsScreen(link: link, interactionEnabled: interactionEnabled(.lights))
    case .diagnostics:
      DiagnosticsPanel(link: link, interactionEnabled: interactionEnabled(.diagnostics))
    }
  }

  // MARK: - The pinned frame

  /// The gauge shell is the app, so a stalled stream keeps its gauges and reads the reason inside
  /// them. Dropping to a bare notice threw the layout away exactly when the rider was already lost,
  /// and it hid that the clock and the battery gauge still had something to say.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `MirrorContent`
  @ViewBuilder
  private var frame: some View {
    switch link.mirror.status {
    case .disconnected:
      // Nothing the wrist could fix: the shell reads as it does for a board-less frame.
      layout(EMPTY_FRAME, muted: false, showReadouts: linkNotice == nil)
    case .waiting, .live:
      layout(link.mirror.frame ?? EMPTY_FRAME, muted: false)
    case .stale:
      layout(link.mirror.frame ?? EMPTY_FRAME, muted: true)
    }
  }

  /// The phone-link problem to name while no frames arrive; nil when there is none worth saying.
  private var linkNotice: MirrorLinkNotice? {
    MirrorStateReducer.linkNotice(status: link.mirror.status, link: link.link)
  }

  private func layout(_ frame: WatchFrame, muted: Bool, showReadouts: Bool = true) -> FrameLayout {
    FrameLayout(
      frame: frame,
      muted: muted,
      ambient: ambient,
      showReadouts: showReadouts,
      navFocus: navFocus,
      awayFocus: awayFocus,
      route: link.route,
      routeGeneration: link.routeGeneration,
      groupRide: link.groupRide,
      navColor: Palette.rider(link.settings.riderColor) ?? Palette.nav,
      navArrowEnabled: link.settings.navArrowEnabled,
      unitSystem: link.settings.unitSystem
    )
  }

  /// Read actual page displacement so dragging, cancelling, crown scrolling and snapping all
  /// drive the same fade. Measure every mounted page because lazy stacks can unload the gauges.
  private func pagePosition(axis: Axis, index: Int, origin: Int) -> some View {
    GeometryReader { geometry in
      let bounds = geometry.frame(in: .named(axis))
      let length = axis == .horizontal ? geometry.size.width : geometry.size.height
      let offset = axis == .horizontal ? bounds.minX : bounds.minY
      let position = length > 0 ? Double(index - origin) - Double(offset / length) : 0
      Color.clear.preference(
        key: PagePositionKey.self,
        value: [axis: position]
      )
    }
  }

  /// Where the vertical axis is, relative to the gauges: positive toward navigation, negative
  /// toward weather and radar.
  private var verticalPosition: Double {
    pagePositions[.vertical] ?? Double((vertical ?? .gauges).rawValue - VerticalPage.gauges.rawValue)
  }

  private var horizontalPosition: Double {
    pagePositions[.horizontal] ?? Double((control ?? .gauges).rawValue)
  }

  /// The nav page taking over. The readouts leave for it; the nav stack is what it is made of, so
  /// that stays and grows.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `navFocus`
  private var navFocus: Double {
    guard !isLuminanceReduced else { return 0 }
    return min(1, max(0, verticalPosition))
  }

  /// Any other page taking over — the control axis, weather, radar, and the Group Ride page below
  /// navigation. Those want the whole centre, so the nav stack leaves with the readouts.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt `navStackAlpha`
  private var awayFocus: Double {
    guard !isLuminanceReduced else { return 0 }
    let groupFocus = verticalPosition - Double(VerticalPage.nav.rawValue - VerticalPage.gauges.rawValue)
    return min(1, max(max(0, -verticalPosition), abs(horizontalPosition), groupFocus))
  }

  /// The Group Ride page is the settled vertical page, so its list may take the crown and the drag.
  private var groupPageSettled: Bool {
    guard !isLuminanceReduced, vertical == .group, let position = settledPositions[.vertical] else { return false }
    return abs(position - Double(VerticalPage.group.rawValue - VerticalPage.gauges.rawValue)) < 0.001
  }

  // MARK: - Transition gating

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `activePage`
  private func interactionEnabled(_ page: ControlPage) -> Bool {
    guard !isLuminanceReduced, control == page, vertical == .gauges,
      let horizontal = settledPositions[.horizontal],
      let verticalPosition = settledPositions[.vertical]
    else { return false }
    return abs(horizontal - Double(page.rawValue)) < 0.001 && abs(verticalPosition) < 0.001
  }

}

/// Radar and weather above the gauges, navigation focus below, and the Group Ride page below that
/// while joined. Radar sits above the forecast because it is the same subject one step further out —
/// the rider swipes up from the numbers, to the hours, to the sky itself.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `VERTICAL_PAGE_RADAR`
enum VerticalPage: Int, CaseIterable, Identifiable {
  case radar
  case weather
  case gauges
  case nav
  case group

  var id: Int { rawValue }
}

/// Gauges centre, Remote Tilt, Board Move, board Lights, diagnostics.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `CONTROL_PAGE_GAUGES`
enum ControlPage: Int, CaseIterable, Identifiable {
  case gauges
  case tilt
  case move
  case lights
  case diagnostics

  var id: Int { rawValue }
}

/// Idle time after which the horizontal axis drifts back to the gauges.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `CONTROL_IDLE_RETURN_MS`
private let CONTROL_IDLE_RETURN_SECONDS: TimeInterval = 45

/// Each page on an axis reports the same displacement, including when the gauges are offscreen.
private struct PagePositionKey: PreferenceKey {
  static let defaultValue: [Axis: Double] = [:]

  static func reduce(value: inout [Axis: Double], nextValue: () -> [Axis: Double]) {
    value.merge(nextValue(), uniquingKeysWith: { current, _ in current })
  }
}
