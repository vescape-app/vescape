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
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `MirrorScreen`
struct MirrorScreen: View {
  @ObservedObject var link: PhoneLink
  /// watchOS's single always-on signal. Wear OS gets a callback with panel capabilities; here the
  /// environment value is the whole of it.
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced

  /// Optional because `scrollPosition(id:)` binds an optional; it is only nil mid-flight between
  /// pages, and every read below treats that as "not on the gauges".
  @State private var vertical: VerticalPage? = .gauges
  @State private var control: ControlPage? = .gauges
  @State private var pageFocus: [Axis: Double] = [:]
  /// A page is interactive only once it has settled: a tap landing mid-transition belongs to the
  /// gesture, not to the control it happened to be over.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `activePage`
  @State private var settling = false
  /// Restarted by every page change; the horizontal axis drifts back to the gauges when it runs out.
  @State private var lastInteraction = Date()

  private var ambient: AmbientMode { AmbientMode(active: isLuminanceReduced) }

  var body: some View {
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
      .onPreferenceChange(PageFocusKey.self) { values in
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { pageFocus = values }
      }
      .task(id: tick) { link.refresh() }
    }
    .onChange(of: isLuminanceReduced) { _, reduced in
      // The wrist goes always-on wherever the rider left it. Ambient only ever draws the gauges, so
      // park both axes there first — otherwise the gauges would be pinned over a control page the
      // rider can no longer swipe away.
      guard reduced else { return }
      vertical = .gauges
      control = .gauges
    }
  }

  /// Re-evaluation cadence: the phone's own push interval while the screen is on, and the reduced
  /// ambient one while it is not.
  private var refreshInterval: TimeInterval {
    isLuminanceReduced ? AMBIENT_REFRESH_INTERVAL_SECONDS : ACTIVE_REFRESH_INTERVAL_SECONDS
  }

  /// Something that changes on every timeline beat, so the reduce runs once per beat instead of
  /// once per body evaluation.
  private var tick: Int { Int(Date().timeIntervalSince1970 / refreshInterval) }

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
        ForEach(VerticalPage.allCases) { page in
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
    }
    .coordinateSpace(name: Axis.vertical)
    .scrollTargetBehavior(.paging)
    .scrollPosition(id: $vertical)
    // The rim gauges are the furniture on this edge; a scroll bar over them is the thing being
    // fixed here, not a thing to keep.
    .scrollIndicators(.hidden)
    // Ambient has already parked the axis, and a page animation there is wasted panel.
    .scrollDisabled(isLuminanceReduced)
    .onChange(of: vertical) { _, _ in beginSettling() }
  }

  @ViewBuilder
  private func verticalContent(_ page: VerticalPage) -> some View {
    switch page {
    case .radar:
      PendingPage(title: "Radar")
    case .weather:
      PendingPage(title: "Weather")
    case .gauges:
      controls
    case .nav:
      // The pinned gauges shed their readouts as this page moves into view.
      PendingPage(title: "Navigation")
    }
  }

  /// The horizontal control axis, live only on the gauges page. From a control page a vertical
  /// swipe would open a blank page over something the rider is working on, which is why Android
  /// gates the vertical axis on the control page too — here the nesting does that by itself.
  private var controls: some View {
    ScrollView(.horizontal) {
      LazyHStack(spacing: 0) {
        ForEach(ControlPage.allCases) { page in
          controlContent(page)
            .containerRelativeFrame([.horizontal, .vertical])
            .background {
              pagePosition(axis: .horizontal, index: page.rawValue, origin: ControlPage.gauges.rawValue)
            }
            .id(page)
        }
      }
      .scrollTargetLayout()
    }
    .coordinateSpace(name: Axis.horizontal)
    .scrollTargetBehavior(.paging)
    .scrollPosition(id: $control)
    .scrollIndicators(.hidden)
    .scrollDisabled(isLuminanceReduced)
    .onChange(of: control) { _, _ in
      beginSettling()
      lastInteraction = Date()
    }
    .task(id: lastInteraction) {
      // Horizontal pages are transient controls, so an untouched wrist drifts back to the gauges.
      // The vertical axis is never moved: weather and the navigation map are places a rider parks
      // on deliberately.
      guard !isLuminanceReduced, control != .gauges else { return }
      try? await Task.sleep(for: .seconds(CONTROL_IDLE_RETURN_SECONDS))
      guard !Task.isCancelled else { return }
      withAnimation { control = .gauges }
    }
  }

  @ViewBuilder
  private func controlContent(_ page: ControlPage) -> some View {
    switch page {
    case .gauges:
      // Empty on purpose: this page *is* the gauges, pinned at the root behind this transparent
      // axis. Only the reason a stalled stream has stopped gets to use the centre.
      if case .disconnected = link.mirror.status {
        DisconnectedLayout(link: link.link, ambient: ambient)
      } else {
        Color.clear
      }
    case .move:
      PendingPage(title: "Move")
    case .lights:
      PendingPage(title: "Lights")
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
      FrameLayout(
        frame: EMPTY_FRAME, muted: false, ambient: ambient, showReadouts: false, focus: focus
      )
    case .waiting:
      FrameLayout(frame: link.mirror.frame ?? EMPTY_FRAME, muted: false, ambient: ambient, focus: focus)
    case .stale:
      FrameLayout(frame: link.mirror.frame ?? EMPTY_FRAME, muted: true, ambient: ambient, focus: focus)
    case .live:
      FrameLayout(frame: link.mirror.frame ?? EMPTY_FRAME, muted: false, ambient: ambient, focus: focus)
    }
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
        key: PageFocusKey.self,
        value: [axis: min(1, abs(position))]
      )
    }
  }

  private var focus: Double {
    guard !isLuminanceReduced else { return 0 }
    return max(
      pageFocus[.vertical] ?? (vertical == .gauges ? 0 : 1),
      pageFocus[.horizontal] ?? (control == .gauges ? 0 : 1)
    )
  }

  // MARK: - Transition gating

  /// Holds every page's controls off until the transition that brought it here has finished.
  private func beginSettling() {
    settling = true
    Task {
      try? await Task.sleep(for: .seconds(PAGE_SETTLE_SECONDS))
      settling = false
    }
  }

  private func interactionEnabled(_ page: ControlPage) -> Bool {
    !isLuminanceReduced && !settling && control == page && vertical == .gauges
  }
}

/// Radar and weather above the gauges, navigation focus below. Radar sits above the forecast
/// because it is the same subject one step further out — the rider swipes up from the numbers, to
/// the hours, to the sky itself.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `VERTICAL_PAGE_RADAR`
enum VerticalPage: Int, CaseIterable, Identifiable {
  case radar
  case weather
  case gauges
  case nav

  var id: Int { rawValue }
}

/// Gauges centre, Board Move, board Lights, diagnostics.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `CONTROL_PAGE_GAUGES`
enum ControlPage: Int, CaseIterable, Identifiable {
  case gauges
  case move
  case lights
  case diagnostics

  var id: Int { rawValue }
}

/// Idle time after which the horizontal axis drifts back to the gauges.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `CONTROL_IDLE_RETURN_MS`
private let CONTROL_IDLE_RETURN_SECONDS: TimeInterval = 45

/// How long a page transition is assumed to take. Android reads the pager's own scroll state;
/// watchOS does not publish one, so the gate is a timer over the system page animation.
private let PAGE_SETTLE_SECONDS: TimeInterval = 0.35

/// Each page on an axis reports the same displacement, including when the gauges are offscreen.
private struct PageFocusKey: PreferenceKey {
  static let defaultValue: [Axis: Double] = [:]

  static func reduce(value: inout [Axis: Double], nextValue: () -> [Axis: Double]) {
    value.merge(nextValue(), uniquingKeysWith: { current, _ in current })
  }
}
