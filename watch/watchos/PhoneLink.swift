import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

/// @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TelemetryState.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/PhoneLinkMonitor.kt
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = PhoneLink()
  var onActivation: (() -> Void)?
  @Published private(set) var mirror = MirrorStateReducer.reduce(frame: nil, lastFrameAtMs: nil, nowMs: 0)
  @Published private(set) var link: MirrorPhoneLink = .unknown
  @Published private(set) var lastFrameAt: Date?
  @Published private(set) var activation: WCSessionActivationState = .notActivated
  @Published private(set) var reachable = false
  @Published private(set) var companionInstalled = false
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `WatchDiagnostics`
  @Published private(set) var diagnostics = WatchDiagnosticsLog()
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `SettingsState`
  @Published private(set) var settings: WatchSettings = .wristDefaults

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `WeatherState`
  @Published private(set) var weather: WatchWeather?

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `RouteState`
  @Published private(set) var route: WatchRoute?
  @Published private(set) var routeStatus: WatchRouteStatus?

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt `BoardState`
  @Published private(set) var board = WatchBoardLights()
  @Published private(set) var lastBattery = WatchBatteryDefaults.value

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchGroupRide.kt `GroupRideState`
  @Published private(set) var groupRide: WatchGroupRide?

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/RideNoticeCard.kt `RideNoticeState`
  @Published private(set) var rideNoticeCard: RideNoticeFrameItem?

  private var wakeLevel: WatchMirrorWakeLevel = .asleep
  private var wakeHeartbeat: Timer?

  private var received = WatchFrameRate()
  private var applied = WatchFrameRate()

  private var intake = WatchMirrorIntake()

  var receivedHz: Double { received.hertz(nowMs: Self.nowMs()) }
  var appliedHz: Double { applied.hertz(nowMs: Self.nowMs()) }

  var statusLabel: String {
    switch activation {
    case .activated: break
    case .inactive: return "inactive"
    case .notActivated: return "not activated"
    @unknown default: return "unknown"
    }
    if !companionInstalled { return "no phone app" }
    return reachable ? "reachable" : "unreachable"
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `recordRadarFailure`
  @MainActor
  func recordRadarFailure() { diagnostics.recordRadarFailure(nowMs: Self.wallClockMs()) }

  @MainActor
  func recordReplay(fixture: String, sampleCount: Int) {
    diagnostics.recordReplay(fixture: fixture, sampleCount: sampleCount, nowMs: Self.wallClockMs())
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `wakeHeartbeat`
  func reportWakeLevel(_ level: WatchMirrorWakeLevel) {
    wakeLevel = level
    diagnostics.recordWakeLevel(level, nowMs: Self.wallClockMs())
    sendWakeLevel()
    wakeHeartbeat?.invalidate()
    guard level != .asleep else { return }
    wakeHeartbeat = Timer.scheduledTimer(
      withTimeInterval: Double(watchMirrorAwakeHeartbeatMs) / 1000,
      repeats: true
    ) { [weak self] _ in self?.sendWakeLevel() }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `sendLights`
  func sendLights(_ `switch`: WatchLightsSwitch, on: Bool) {
    send(.lights(`switch`, on))
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `sendMove`
  /// @platform-diff `WCSession.sendMessageData` is already latest-wins and non-blocking, so the
  func sendMove(_ direction: Int) {
    send(.move(direction))
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `sendTiltLock`
  /// @platform-diff Android coalesces lock and cancel into one latest-wins slot because its Data
  func sendTiltLock(_ value: Int) {
    if let replayTiltEcho { return replayTiltEcho(min(max(value, 0), 255)) }
    send(.tiltLock(value))
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `sendTiltCancel`
  func sendTiltCancel() {
    if let replayTiltEcho { return replayTiltEcho(nil) }
    send(.tiltCancel)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt `replayTiltEcho`
  var replayTiltEcho: ((Int?) -> Void)?

  private func sendWakeLevel() {
    send(.mirrorAwake(wakeLevel))
  }

  private func send(_ command: WatchCommand) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessageData(WatchCommandCodec.encode(command), replyHandler: nil, errorHandler: nil)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/TelemetryState.kt `refresh`
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMirrorIntake.kt `refresh`
  func refresh() {
    intake.refresh(nowMs: Self.nowMs())
    publishIntake()
  }

  private func publishIntake() {
    if mirror != intake.mirror { mirror = intake.mirror }
    if route != intake.route { route = intake.route }
    if routeStatus != intake.routeStatus { routeStatus = intake.routeStatus }
    if settings != intake.settings { settings = intake.settings }
    if weather != intake.weather || weather?.fetchedAtMs != intake.weather?.fetchedAtMs { weather = intake.weather }
    if board != intake.board { board = intake.board }
    if groupRide != intake.groupRide { groupRide = intake.groupRide }
    if rideNoticeCard != intake.rideNoticeCard { rideNoticeCard = intake.rideNoticeCard }
    if let list = intake.mapTiles, list != retainedMapTiles {
      retainedMapTiles = list
      MapTileStore.shared.retain(list)
    }
  }

  private var retainedMapTiles: WatchMapTileList?

  private static func nowMs() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000) }

  private static func wallClockMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  /// @platform-diff `WCSession.isPaired` is iOS-only; the wrist infers the same three reasons from
  private func syncCounterpart(_ session: WCSession) {
    activation = session.activationState
    reachable = session.isReachable
    companionInstalled = session.isCompanionAppInstalled
    diagnostics.recordLink(statusLabel, nowMs: Self.wallClockMs())
    acceptColdState(session.receivedApplicationContext)
    link = {
      guard session.activationState == .activated else { return .unknown }
      if !session.isCompanionAppInstalled { return .phoneOnly }
      return session.isReachable ? .appReachable : .noPhone
    }()
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMirrorReplayAdapter.kt
  @MainActor
  func acceptReplayFrame(_ frame: WatchFrame) {
    acceptTelemetry(WatchMirrorReplayAdapter.telemetry(frame), receivedAtMs: Self.nowMs(), receivedAt: Date())
  }

  @MainActor
  func acceptReplayRouteStatus(_ status: WatchRouteStatus?) {
    intake.acceptRouteStatus(status.map(WatchRouteStatusCodec.encode))
    publishIntake()
  }

  @MainActor
  func acceptReplayRoute(_ path: WatchRoute?, origin: WatchMapPosition?) {
    intake.acceptRoute(origin.flatMap { WatchMirrorReplayAdapter.route(path, origin: $0) })
    publishIntake()
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameReplay.kt `FrameReplayer.loadScene`
  @MainActor
  func acceptReplayMapTiles(_ list: WatchMapTileList, directory: URL) {
    for tile in list.tiles {
      let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      do {
        try FileManager.default.copyItem(at: directory.appendingPathComponent("\(tile.key).jpg"), to: copy)
      } catch {
        print("[replay] missing map tile fixture: \(tile.key)")
        continue
      }
      MapTileStore.shared.receive(copy, style: list.style, tile: tile, generation: list.generation)
    }
  }

  @MainActor
  func acceptReplayGroupRide(_ frame: GroupRideFrame) {
    acceptGroupRide(GroupRideFrameCodec.encode(frame), receivedAtMs: Self.nowMs())
  }

  @MainActor
  func acceptReplayWeather(_ forecast: WatchWeather) {
    intake.acceptWeather(forecast.payload)
    publishIntake()
  }

  @MainActor
  func acceptReplaySettings(_ payload: [String: Any]) {
    intake.acceptSettings(payload)
    publishIntake()
  }

  private func acceptColdState(_ context: [String: Any]) {
    refreshLastBatteryContext()
    let fresh = intake.restoreColdState(context)
    publishIntake()
    if fresh { buzzRideNotice() }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MirrorScreen.kt `hideRideNotice`
  @MainActor
  func hideRideNotice(_ notice: RideNoticeFrameItem) {
    intake.hideRideNotice(id: notice.id, rev: notice.rev)
    publishIntake()
    send(.dismissNotice(id: notice.id, rev: notice.rev))
  }

  private func acceptRideNotices(_ bytes: Data) {
    let fresh = intake.acceptRideNotices(bytes)
    publishIntake()
    if fresh { buzzRideNotice() }
  }

  private func buzzRideNotice() {
    WKInterfaceDevice.current().play(.notification)
  }

  private func acceptGroupRide(_ bytes: Data, receivedAtMs: Int64) {
    intake.acceptGroupRide(bytes, receivedAtMs: receivedAtMs)
    publishIntake()
  }

  private func acceptTelemetry(_ bytes: Data, receivedAtMs: Int64, receivedAt: Date) {
    let appliedAtMs = Self.nowMs()
    guard intake.acceptTelemetry(bytes, receivedAtMs: receivedAtMs, appliedAtMs: appliedAtMs) else {
      diagnostics.recordDecodeFailure(byteCount: bytes.count, lanes: bytes.first, nowMs: Self.wallClockMs())
      return
    }
    received.record(nowMs: receivedAtMs)
    applied.record(nowMs: appliedAtMs)
    lastFrameAt = receivedAt
    diagnostics.recordFrame(nowMs: Self.wallClockMs())
    publishIntake()
  }

  func refreshLastBatteryContext() {
    guard WatchBatteryDefaults.receiveLatestContext({ WCSession.default.receivedApplicationContext }) else { return }
    lastBattery = WatchBatteryDefaults.value
    WidgetCenter.shared.reloadTimelines(ofKind: WatchBatteryDefaults.widgetKind)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    guard userInfo[watchLastBatteryChannel] != nil else { return }
    DispatchQueue.main.async { self.refreshLastBatteryContext() }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `freshWeather`
  func freshWeather(nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> WatchWeather? {
    guard let weather, weather.isFresh(nowMs: nowMs) else { return nil }
    return weather
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async {
      self.syncCounterpart(session)
      self.onActivation?()
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.syncCounterpart(session)
      if session.isReachable, self.wakeLevel != .asleep { self.sendWakeLevel() }
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    DispatchQueue.main.async { self.acceptColdState(session.receivedApplicationContext) }
  }

  func sessionCompanionAppInstalledDidChange(_ session: WCSession) {
    DispatchQueue.main.async { self.syncCounterpart(session) }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `listener`
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    let receivedAtMs = Self.nowMs()
    if let bytes = message[watchRideNoticesChannel] as? Data {
      DispatchQueue.main.async { self.acceptRideNotices(bytes) }
      return
    }
    if let bytes = message[watchRouteStatusMessageKey] as? Data {
      DispatchQueue.main.async {
        self.intake.acceptRouteStatus(bytes)
        self.publishIntake()
      }
      return
    }
    guard let bytes = message[watchGroupRideMessageKey] as? Data else { return }
    DispatchQueue.main.async { self.acceptGroupRide(bytes, receivedAtMs: receivedAtMs) }
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    guard let sent = WatchMapTileTransfer.decode(file.metadata) else { return }
    MapTileStore.shared.receive(file.fileURL, style: sent.style, tile: sent.tile, generation: sent.generation)
  }

  func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
    let receivedAt = Date()
    let receivedAtMs = Self.nowMs()
    DispatchQueue.main.async {
      self.acceptTelemetry(messageData, receivedAtMs: receivedAtMs, receivedAt: receivedAt)
    }
  }
}
