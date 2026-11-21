import Foundation
import WatchConnectivity

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTelemetryPusher.kt
/// @platform-diff Android looks up target nodes through a blocking Play-services IPC and caches
/// them on a TTL. `WCSession` publishes `isReachable` as a property with no per-send lookup, so
/// there is nothing to cache and no node set to invalidate.
final class WatchTelemetryPusher: NSObject, WCSessionDelegate {
  private let record: (String, [String: Any?]) -> Void
  var onCommand: ((WatchCommand) -> Void)?
  private var session: WCSession?
  private var activeIssue: String?
  private var lastReachable: Bool?
  private var desiredBattery: WatchLastBattery?
  private var wakeGate = WatchBatteryWakeGate()
  private var budgetExhausted = false

  private lazy var coldState = WatchColdState(
    context: { [weak self] in self?.session?.applicationContext ?? [:] },
    write: { [weak self] merged in
      guard let session = self?.session, session.activationState == .activated else {
        throw WatchColdStateError.sessionNotActivated
      }
      try session.updateApplicationContext(merged)
    },
    record: { [weak self] name, props in self?.record(name, props) }
  )

  private(set) lazy var mapTiles = WatchMapTilePusher(
    session: { [weak self] in
      guard let session = self?.session, session.activationState == .activated else { return nil }
      return session
    },
    putList: { [weak self] in self?.pushColdState(channel: watchMapTilesChannel, payload: $0) }
  )

  init(record: @escaping (String, [String: Any?]) -> Void) {
    self.record = record
    super.init()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorPresence.kt
  var canPush: Bool {
    guard let session, session.activationState == .activated else { return false }
    return session.isPaired && session.isWatchAppInstalled && session.isReachable
  }

  func start() {
    guard WCSession.isSupported() else {
      reportIssue("watch_session_unsupported")
      return
    }
    guard session == nil else { return }
    let session = WCSession.default
    session.delegate = self
    self.session = session
    session.activate()
  }

  func pushColdState(channel: String, payload: [String: Any]) {
    coldState.put(channel: channel, payload: payload)
  }

  var onColdStateDelivered: ((String) -> Void)? {
    get { coldState.onDelivered }
    set { coldState.onDelivered = newValue }
  }

  func pushLastBattery(_ battery: WatchLastBattery?) {
    desiredBattery = battery
    pushColdState(channel: watchLastBatteryChannel, payload: battery?.payload ?? [:])
    wakeComplication()
  }

  private func wakeComplication() {
    guard let session, session.activationState == .activated,
      session.isPaired, session.isWatchAppInstalled, session.isComplicationEnabled else { return }
    let remaining = session.remainingComplicationUserInfoTransfers
    if remaining <= WatchBatteryWakeGate.reserve {
      if !budgetExhausted { record("watch_complication_budget_exhausted", ["remaining": remaining]) }
      budgetExhausted = true
      return
    }
    budgetExhausted = false
    guard wakeGate.shouldSend(desiredBattery) else { return }
    session.transferCurrentComplicationUserInfo([watchLastBatteryChannel: desiredBattery?.payload ?? [:]])
  }

  var onColdStateFailed: ((String) -> Void)? {
    get { coldState.onFailed }
    set { coldState.onFailed = newValue }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTelemetryPusher.kt `pushRouteStatus`
  func pushRouteStatus(_ status: WatchRouteStatus) {
    guard let session, canPush else { return }
    session.sendMessage([watchRouteStatusMessageKey: WatchRouteStatusCodec.encode(status)], replyHandler: nil) { [weak self] error in
      self?.reportIssue("watch_frame_send_failed", ["path": watchRouteStatusMessageKey, "error": error.localizedDescription])
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRideNoticePusher.kt `WatchRideNoticePusher`
  func pushRideNotices(_ notices: [RideNotice], sentAtMs: Int64) {
    let frame = RideNoticeFrameCodec.encode(rideNoticeFrame(notices, sentAtMs: sentAtMs))
    pushColdState(channel: watchRideNoticesChannel, payload: [watchRideNoticesFrameKey: frame])
    guard let session, canPush else { return }
    session.sendMessage([watchRideNoticesChannel: frame], replyHandler: nil) { [weak self] error in
      self?.reportIssue("watch_frame_send_failed", ["path": watchRideNoticesChannel, "error": error.localizedDescription])
    }
  }

  func pushFrame(_ frame: Data) {
    guard let session, canPush else { return }
    session.sendMessageData(
      frame,
      replyHandler: nil,
      errorHandler: { [weak self] error in
        self?.reportIssue("watch_frame_send_failed", ["error": error.localizedDescription])
      }
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTelemetryPusher.kt `pushGroupRideFrame`
  func pushGroupRideFrame(_ frame: Data) {
    guard let session, canPush else { return }
    session.sendMessage(
      [watchGroupRideMessageKey: frame],
      replyHandler: nil,
      errorHandler: { [weak self] error in
        self?.reportIssue("watch_frame_send_failed", ["path": watchGroupRideMessageKey, "error": error.localizedDescription])
      }
    )
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    record(
      "watch_session_activated",
      [
        "state": activationState.rawValue,
        "paired": session.isPaired,
        "app_installed": session.isWatchAppInstalled,
        "reachable": session.isReachable,
        "error": error?.localizedDescription,
      ]
    )
    if activationState == .activated { DispatchQueue.main.async { self.coldState.flush(); self.wakeComplication() } }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommandListenerService.kt
  func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
    guard let command = WatchCommandCodec.decode(messageData) else { return }
    onCommand?(command)
  }

  func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
    mapTiles.finished(fileTransfer, error: error)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    guard self.session != nil else { return }
    let reachable = session.isReachable
    guard reachable != lastReachable else { return }
    lastReachable = reachable
    record("watch_reachability_changed", ["reachable": reachable])
    if reachable { reportRecovered() }
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    guard self.session != nil else { return }
    record(
      "watch_state_changed",
      ["paired": session.isPaired, "app_installed": session.isWatchAppInstalled]
    )
    mapTiles.watchStateChanged()
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    mapTiles.watchStateChanged()
  }

  func sessionDidDeactivate(_ session: WCSession) {
    guard self.session != nil else { return }
    session.activate()
  }

  private func reportIssue(_ name: String, _ properties: [String: Any?] = [:]) {
    if activeIssue != name {
      record(name, properties)
    }
    activeIssue = name
  }

  private func reportRecovered() {
    guard let resolved = activeIssue else { return }
    activeIssue = nil
    record("watch_frame_send_recovered", ["after": resolved])
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRideNoticePusher.kt `toRideNoticeFrame`
func rideNoticeFrame(_ notices: [RideNotice], sentAtMs: Int64) -> RideNoticeFrame {
  RideNoticeFrame(
    sentAtMs: sentAtMs,
    notices: notices.map { notice in
      let severity: RideNoticeFrameSeverity
      switch notice.content.severity {
      case .critical: severity = .critical
      case .warning: severity = .warning
      case .info: severity = .info
      }
      return RideNoticeFrameItem(
        id: notice.id, rev: notice.rev, severity: severity,
        title: notice.content.title, details: notice.content.details,
        expiresAtMs: notice.content.expiresAt
      )
    }
  )
}
