import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `MirrorScreen`
/// @platform-diff watchOS uses system navigation to leave the app, without Wear OS's close prompt.
struct MirrorScreen: View {
  @ObservedObject var link: PhoneLink
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced

  @State private var vertical: VerticalPage? = .gauges
  @State private var control: ControlPage? = .gauges
  @State private var pagePositions: [Axis: Double] = [:]
  @State private var settledPositions: [Axis: Double] = [:]
  @State private var verticalPagingEnabled = true
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `controlHeld`
  @State private var controlHeld = false
  @State private var controlDrag: CGFloat = 0
  @State private var lastInteraction = Date()
  @Environment(\.scenePhase) private var scenePhase

  private var ambient: AmbientMode { AmbientMode(active: isLuminanceReduced) }

  var body: some View {
    mirrorBody.ignoresSafeArea()
  }

  private var mirrorBody: some View {
    TimelineView(.periodic(from: .now, by: refreshInterval)) { _ in
      ZStack {
        pages
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
              temperatureUnit: link.settings.temperatureUnit,
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
      .overlay {
        if let notice = link.rideNoticeCard {
          RideNoticeCard(notice: notice, ambient: ambient) { hideRideNotice(notice) }
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
        let positions = pagePositions
        try? await Task.sleep(for: .milliseconds(100))
        guard !Task.isCancelled else { return }
        settledPositions = positions
        if let horizontal = positions[.horizontal], abs(horizontal.rounded() - horizontal) < 0.001 {
          verticalPagingEnabled = abs(horizontal) < 0.001
        }
      }
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
      guard reduced else { return }
      vertical = .gauges
      control = .gauges
      controlDrag = 0
      verticalPagingEnabled = true
    }
    .onChange(of: scenePhase) { _, _ in reportWakeLevel() }
    .onAppear { reportWakeLevel() }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `hideRideNotice`
  private func hideRideNotice(_ notice: RideNoticeFrameItem) {
    link.hideRideNotice(notice)
    vertical = .gauges
    control = .gauges
    controlDrag = 0
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `wakeHeartbeat`
  private func reportWakeLevel() {
    let level: WatchMirrorWakeLevel
    switch scenePhase {
    case .active: level = isLuminanceReduced ? .ambient : .active
    case .inactive: level = .ambient
    default: level = .asleep
    }
    link.reportWakeLevel(level)
  }

  private var refreshInterval: TimeInterval {
    isLuminanceReduced ? AMBIENT_REFRESH_INTERVAL_SECONDS : ACTIVE_REFRESH_INTERVAL_SECONDS
  }

  private var tick: Int64 { Int64(Date().timeIntervalSince1970 / refreshInterval) }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `radarVisible`
  private var radarVisible: Bool {
    vertical == .radar && scenePhase == .active && !isLuminanceReduced
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `freshWeather`
  private var freshWeather: WatchWeather? { link.freshWeather() }

  private var pages: some View {
    ScrollView(.vertical) {
      LazyVStack(spacing: 0) {
        ForEach(verticalPages) { page in
          verticalContent(page)
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
    .scrollIndicators(.hidden)
    .environment(\.isScrollEnabled, !isLuminanceReduced && verticalPagingEnabled && !controlHeld)
    .onChange(of: vertical) { _, _ in lastInteraction = Date() }
    .onChange(of: link.groupRide == nil) { _, left in
      if left, vertical == .group { vertical = .nav }
    }
  }

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
        distanceUnit: link.settings.distanceUnit,
        timeFormat: link.settings.timeFormat,
        streetMapEnabled: link.settings.streetMapEnabled
      )
    case .weather:
      WeatherScreen(
        forecast: freshWeather,
        everReceived: link.weather != nil,
        timeFormat: link.settings.timeFormat,
        temperatureUnit: link.settings.temperatureUnit
      )
    case .gauges:
      controls
    case .nav:
      Color.clear
    case .group:
      if let groupRide = link.groupRide {
        GroupRidePage(
          group: groupRide,
          settled: groupPageSettled,
          distanceUnit: link.settings.distanceUnit,
          onPageBack: { withAnimation { vertical = .nav } }
        )
      } else {
        Color.clear
      }
    }
  }

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
      .offset(x: controlDrag)
      .contentShape(Rectangle())
    }
    .coordinateSpace(name: Axis.horizontal)
    .scrollTargetBehavior(.paging)
    .scrollPosition(id: $control)
    .scrollIndicators(.hidden)
    .environment(\.isScrollEnabled, !isLuminanceReduced && !controlHeld)
    .onChange(of: control) { _, _ in lastInteraction = Date() }
  }

  @ViewBuilder
  private func controlContent(_ page: ControlPage) -> some View {
    switch page {
    case .gauges:
      if let linkNotice {
        DisconnectedLayout(notice: linkNotice, ambient: ambient)
      } else {
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
        interactionEnabled: interactionEnabled(.move),
        onHoldChanged: { controlHeld = $0 }
      )
    case .lights:
      LightsScreen(link: link, interactionEnabled: interactionEnabled(.lights))
    case .diagnostics:
      DiagnosticsPanel(link: link, interactionEnabled: interactionEnabled(.diagnostics))
    }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `MirrorContent`
  @ViewBuilder
  private var frame: some View {
    switch link.mirror.status {
    case .disconnected:
      layout(EMPTY_FRAME, muted: false, showReadouts: linkNotice == nil)
    case .waiting, .live:
      layout(link.mirror.frame ?? EMPTY_FRAME, muted: false)
    case .stale:
      layout(link.mirror.frame ?? EMPTY_FRAME, muted: true)
    }
  }

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
      routeStatus: link.routeStatus,
      groupRide: link.groupRide,
      navArrowEnabled: link.settings.navArrowEnabled,
      telemetryTrailEnabled: link.settings.telemetryTrailEnabled,
      telemetryGroupEnabled: link.settings.telemetryGroupEnabled,
      telemetryRouteEnabled: link.settings.telemetryRouteEnabled,
      streetMapEnabled: link.settings.streetMapEnabled,
      mapGaugesPercent: link.settings.mapGaugesPercent,
      distanceUnit: link.settings.distanceUnit,
      temperatureUnit: link.settings.temperatureUnit
    )
  }

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

  private var verticalPosition: Double {
    pagePositions[.vertical] ?? Double((vertical ?? .gauges).rawValue - VerticalPage.gauges.rawValue)
  }

  private var horizontalPosition: Double {
    pagePositions[.horizontal] ?? Double((control ?? .gauges).rawValue)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `navFocus`
  private var navFocus: Double {
    guard !isLuminanceReduced else { return 0 }
    return min(1, max(0, verticalPosition))
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMapScene.kt `navStackAlpha`
  private var awayFocus: Double {
    guard !isLuminanceReduced else { return 0 }
    let groupFocus = verticalPosition - Double(VerticalPage.nav.rawValue - VerticalPage.gauges.rawValue)
    return min(1, max(max(0, -verticalPosition), abs(horizontalPosition), groupFocus))
  }

  private var groupPageSettled: Bool {
    guard !isLuminanceReduced, vertical == .group, let position = settledPositions[.vertical] else { return false }
    return abs(position - Double(VerticalPage.group.rawValue - VerticalPage.gauges.rawValue)) < 0.001
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `activePage`
  private func interactionEnabled(_ page: ControlPage) -> Bool {
    guard !isLuminanceReduced, control == page, vertical == .gauges,
      let horizontal = settledPositions[.horizontal],
      let verticalPosition = settledPositions[.vertical]
    else { return false }
    return abs(horizontal - Double(page.rawValue)) < 0.001 && abs(verticalPosition) < 0.001
  }

}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `VERTICAL_PAGE_RADAR`
enum VerticalPage: Int, CaseIterable, Identifiable {
  case radar
  case weather
  case gauges
  case nav
  case group

  var id: Int { rawValue }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `CONTROL_PAGE_GAUGES`
enum ControlPage: Int, CaseIterable, Identifiable {
  case gauges
  case tilt
  case move
  case lights
  case diagnostics

  var id: Int { rawValue }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `CONTROL_IDLE_RETURN_MS`
private let CONTROL_IDLE_RETURN_SECONDS: TimeInterval = 45

private struct PagePositionKey: PreferenceKey {
  static let defaultValue: [Axis: Double] = [:]

  static func reduce(value: inout [Axis: Double], nextValue: () -> [Axis: Double]) {
    value.merge(nextValue(), uniquingKeysWith: { current, _ in current })
  }
}
