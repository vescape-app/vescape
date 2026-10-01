import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/AndroidWatchMirror.kt
/// @platform-diff WCSession lives for the process; stop releases callbacks without deactivating the system session.
/// WCSession delivery adapter. System reachability already gates sleeping/unreachable wrist apps;
/// unlike Wear's Data Layer, the wake lease is needed for cadence and Group Ride only (ADR-0033).
private final class IOSWatchMirrorTransport: WatchMirrorTransport {
  private let pusher: WatchTelemetryPusher
  private var pushedWeather: WatchWeather?
  init(record: @escaping (String, [String: Any?]) -> Void) { pusher = WatchTelemetryPusher(record: record) }
  var reachable: Bool { pusher.canPush }
  var requiresWakeReport: Bool { false }
  func start(command: @escaping (WatchCommand) -> Void) {
    pusher.onCommand = command
    pusher.onColdStateDelivered = { WatchRouteMirror.shared.channelDelivered($0) }
    pusher.onColdStateFailed = { WatchRouteMirror.shared.channelFailed($0) }
    pusher.start()
  }
  func stop() {
    pusher.onCommand = nil
    pusher.onColdStateDelivered = nil
    pusher.onColdStateFailed = nil
  }
  func pushFrame(_ frame: Data) { pusher.pushFrame(frame) }
  func pushGroup(_ frame: Data) { pusher.pushGroupRideFrame(frame) }
  func pushRouteStatus(_ status: WatchRouteStatus) { pusher.pushRouteStatus(status) }
  func pushSettings(_ settings: WatchSettings) { pusher.pushColdState(channel: watchSettingsChannel, payload: settings.payload) }
  func pushWeather(_ weather: WatchWeather) {
    guard weather != pushedWeather else { return }
    pushedWeather = weather
    pusher.pushColdState(channel: watchWeatherChannel, payload: weather.payload)
  }
  func pushRoute(_ payload: [String: Any]) { pusher.pushColdState(channel: watchRouteChannel, payload: payload) }
  func pushBoard(_ board: WatchBoardLights) { pusher.pushColdState(channel: watchBoardChannel, payload: board.payload) }
}

private final class IOSWatchMirrorSources: WatchMirrorSources {
  func routeStatus() -> WatchRouteStatus {
    let navigation = NavigationController.shared
    let current = navigation.current
    let phase: WatchRoutePhase
    if navigation.computing { phase = .computing }
    else if current == nil { phase = .idle }
    else if current?.status != .ready || WatchRouteMirror.shared.failed { phase = .failed }
    else { phase = .ready }
    return WatchRouteStatus(phase: phase, routeId: WatchRouteMirror.shared.desiredRouteId)
  }
  func subscribe(
    routeChanged: @escaping () -> Void,
    weatherChanged: @escaping (WatchWeather) -> Void,
    routePayload: @escaping ([String: Any]) -> Void
  ) -> () -> Void {
    WeatherCoordinator.shared.onNativeChange = { weatherChanged($0.watchWeather) }
    if let known = WeatherCoordinator.shared.current { weatherChanged(known.watchWeather) }
    NavigationController.shared.onWatchChange = routeChanged
    WatchRouteMirror.shared.attach(to: NavigationController.shared, push: routePayload)
    return {
      WeatherCoordinator.shared.onNativeChange = nil
      NavigationController.shared.onWatchChange = nil
      WatchRouteMirror.shared.detach(from: NavigationController.shared)
    }
  }
}

func iosWatchMirror(
  scheduler: Scheduler, snapshot: @escaping () -> WatchSnapshot,
  isStale: @escaping () -> Bool, groupFrame: @escaping () -> GroupRideFrame?,
  command: @escaping (WatchCommand) -> Void,
  record: @escaping (String, [String: Any?]) -> Void
) -> WatchMirrorCoordinator {
  WatchMirrorCoordinator(
    scheduler: scheduler, nowMs: { Int64(ProcessInfo.processInfo.systemUptime * 1000) },
    snapshot: snapshot, isStale: isStale, groupFrame: groupFrame,
    transport: IOSWatchMirrorTransport(record: record), sources: IOSWatchMirrorSources(),
    command: command, record: record
  )
}

extension WatchMirrorCoordinator {
  /// Settings are process scoped, even when the board telemetry settings have no session to reload.
  /// The returned strength belongs to the existing Board Move relay, not the mirror.
  func reloadSettings(from appData: AppDataRepository) -> Int? {
    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "watch_settings_read", error: error)
      return nil
    }
    let hz = AppDataRepository.wearPushRateHz(settings["wearPushRateHz"] ?? nil)
      ?? AppDataRepository.defaultWearPushRateHz
    let strength = AppDataRepository.boardMoveStrengthPercent(settings["boardMoveStrengthPercent"] ?? nil)
    applySettings(WatchSettings(
      riderColor: (settings["riderColor"] ?? nil) as? String,
      boardMoveStrengthPercent: strength,
      navArrowEnabled: (settings["wearNavArrowEnabled"] ?? nil) as? Bool ?? false,
      telemetryTrailEnabled: (settings["wearTelemetryTrailEnabled"] ?? nil) as? Bool ?? true,
      unitSystem: (settings["unitSystem"] ?? nil) as? String == "imperial" ? "imperial" : "metric",
      tiltRatePercent: AppDataRepository.wearTiltRatePercent(settings["wearTiltRatePercent"] ?? nil) ?? watchDefaultTiltRatePercent
    ), intervalMs: Int64(1000 / hz))
    return strength
  }
}
