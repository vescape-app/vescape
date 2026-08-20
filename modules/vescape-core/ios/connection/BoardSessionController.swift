import Foundation
import UIKit
import UserNotifications

/// Everything a runtime connect needs, resolved from the stored Board Link before the session
/// starts. The transport is already known (ADR 0015 / #108) — connect never discovers it.
internal struct BoardConnectConfig {
  let appBoardId: String
  let bleId: String
  let name: String
  let transport: BoardTransport
  /// Probe-confirmed smart-BMS presence on `transport`. Gates the interleaved BMS poll; `nil`/false
  /// (link saved before BMS detection, or none present) means no BMS poll.
  let linkVersion: Int?
  let hasBms: Bool?
  let vescFirmwareVersion: String?
  let refloatVersion: String?
  let refloatBaseVersion: String?
  let pollIntervalMs: Int
  /// Normalized Board `batteryConfig` used to estimate battery percent, or `nil` when the board
  /// has no battery config (the gauge then stays empty).
  let batteryConfig: [String: Any]?
  /// Live-history window (minutes) for the decimated `onLiveSeries` series.
  let liveHistoryLimitMinutes: Int
  /// Raw debug Session Recorder gate (dev setting, `setDebugRecordingEnabled`). Replay sessions
  /// always run with `false` so a replay never re-records itself.
  var recordingEnabled = false

  /// Resolve a stored board's Board Link into a runtime connect config. Returns `nil` when the
  /// board is unlinked (JS routes those to Board Probe instead). Dumb connect (ADR 0015): the
  /// transport is read straight from the link, never rediscovered.
  ///
  /// Shared by the JS connect bridge and the headless resume path (#378), which rebuilds the exact
  /// same config from the same stored link after a state-restoration relaunch.
  static func resolve(
    boardId: String,
    appData: AppDataRepository,
    recordingEnabled: Bool = false
  ) -> BoardConnectConfig? {
    guard let board = appData.getBoard(boardId) else { return nil }
    guard let link = board["link"] as? [String: Any?] else { return nil }
    guard let bleId = link["bleId"] as? String, !bleId.isEmpty else { return nil }
    let transport = BoardTransport.fromBridge(link["transport"] ?? nil) ?? .direct
    let name = board["name"] as? String ?? "VESC Board"
    let settings = appData.getSettings()
    let hz = AppDataRepository.intValue(settings["telemetryPollRateHz"] ?? nil) ?? 0
    return BoardConnectConfig(
      appBoardId: boardId,
      bleId: bleId,
      name: name,
      transport: transport,
      linkVersion: AppDataRepository.intValue(link["linkVersion"] ?? nil),
      hasBms: link["hasBms"] as? Bool,
      vescFirmwareVersion: link["vescFirmwareVersion"] as? String,
      refloatVersion: link["refloatVersion"] as? String,
      refloatBaseVersion: link["refloatBaseVersion"] as? String,
      pollIntervalMs: hz > 0 ? 1000 / hz : 0,
      batteryConfig: AppDataRepository.normalizeBatteryConfig(board["batteryConfig"] ?? nil),
      liveHistoryLimitMinutes: AppDataRepository.liveHistoryLimitMinutes(settings["liveHistoryLimit"] ?? nil) ?? 5,
      recordingEnabled: recordingEnabled
    )
  }
}

/// Owns the live Board Session: drives connect phases off GATT callbacks, seeds the stored
/// transport, polls telemetry response-paced, decodes Refloat frames, emits live events, and
/// recovers a dropped mid-ride link via CoreBluetooth persistent connect plus active rescan
/// (#58), and owns iOS Ride Recording telemetry/GPS writes.
///
/// iOS reconnect deliberately diverges from Android's exponential-backoff `ReconnectScheduler`:
/// `CBCentralManager.connect(_:options:)` is persistent (retries until success or cancel, even
/// waking the app from suspension), so there is no per-attempt backoff to replicate. The active
/// rescan below only *supplements* that passive retry to accelerate rediscovery while the app is
/// alive under the `location` background mode.
///
/// Both platforms retry indefinitely; they differ only in *how* retries are paced — see the
/// @platform-diff below.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt
/// @platform-diff iOS relies on CoreBluetooth persistent connect for retry timing instead of
/// Android's backoff scheduler (`ReconnectPolicy.nextRetry`). Both the board-ready watchdog
/// (`armBoardReadyTimeout`) and the post-connected stale-telemetry watchdog (`armStaleWatchdog` /
/// `onTelemetryStaleFired`) are ported. iOS has no distinct `Stale` phase: a stale trip routes
/// straight into the shared reconnect path (`.reconnecting`), where Android first transitions
/// through `BoardPhase.Stale`.
/// Alerts (#62) and diagnostics (#63) are ported. Ride status is surfaced natively via a Live
/// Activity (`RideLiveActivityController`) — the peer of Android's persistent foreground
/// notification — driven entirely from this coordinator so it survives screen-off / dead JS.
internal final class BoardSessionController: VescGattListener {
  /// App-level owner of the live Board Session, below Expo module lifetime (see `docs/ios.md`). A JS
  /// runtime reload tears down `VescapeCoreModule` and builds a fresh one; the session, recording, GPS
  /// and Live Activity keep running on this singleton while each module only attaches/detaches its
  /// JS event sinks. Mirrors Android's process-level `CoreForegroundService`, whose session survives
  /// module teardown.
  static let shared = BoardSessionController()

  /// Send a native event to JS. Set by the module.
  var emit: ((String, [String: Any?]) -> Void)?
  /// Called whenever board or scan phase changes so the module can recompose `onLiveState`.
  var onStateChanged: (() -> Void)?

  /// The one central carrying a CoreBluetooth restore identifier (ADR 0034), so a jetsam kill
  /// mid-ride is recoverable: the board's next notification relaunches the app and iOS replays this
  /// central's state into `onGattRestored`.
  private lazy var gatt = VescGattClient(
    listener: self,
    restoreIdentifier: VescGattClient.sessionRestoreIdentifier
  )
  /// Transport seam (ADR 0024): a replay session swaps in a `ReplayTransport` for its lifetime;
  /// everything else drives the real GATT client. Set on connect, cleared on session end. All
  /// session-facing link traffic goes through `transport`; scan stays on `gatt` (not session-bound).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `transport`
  private var replayTransport: ReplayTransport?
  private var transport: SessionTransport { replayTransport ?? gatt }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardMoveController`
  private lazy var boardMoveController = BoardMoveController(
    transport: { [weak self] in
      guard let self, self.phase == .connected, let config = self.config else { return nil }
      return config.transport ?? .direct
    },
    canMove: { [weak self] in self?.firmwareCommandsTrusted() ?? false },
    generation: { [weak self] in BoardMoveGeneration.forBaseVersion(self?.config?.refloatBaseVersion) },
    send: { [weak self] payload in self?.transport.sendPayload(payload) ?? false }
  )
  /// The clock this session stamps and compares its data against. Wall time for every real session;
  /// a replay swaps in its own for the session's lifetime so a warmed-up playback writes a timeline
  /// that agrees with itself. Never read directly — go through `nowMs()`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `sessionClock`
  private var sessionClock: SessionClock = SystemSessionClock.shared
  private let connectTimeoutSeconds = 20.0
  /// Board-ready watchdog: max time in `waitingForTelemetry` (GATT subscribed) before the board is
  /// presumed silent and we self-heal via reconnect. Mirrors Android `armBoardReadyTimeout`.
  /// @platform-diff Android scales this per reconnect attempt (base 4s → 15s cap via
  /// `ReconnectPolicy.boardReadyTimeoutMs`); iOS relies on CoreBluetooth persistent connect and has
  /// no per-attempt counter, so it uses a fixed value matching Android's base.
  private let boardReadyTimeoutSeconds = 4.0
  /// Stale-telemetry watchdog window: max gap between telemetry frames while `connected` before the
  /// board is presumed silent (GATT still up, no frames) and we self-heal via reconnect. Mirrors
  /// Android `TELEMETRY_STALE_MS` (4s) — copied, not re-derived.
  private let telemetryStaleSeconds = 4.0
  private let linkIntegrityBmsTimeoutSeconds = 12.0
  /// Idle delay after link trust before the one background config-safety read fires (lets telemetry settle).
  private let configSafetyReadDelaySeconds = 2.5

  // MARK: Board session state

  private(set) var phase: BoardPhase = .idle
  private(set) var connectedBoardId: String?
  private(set) var bleId: String?
  private(set) var boardName: String?
  private(set) var connectionSeq: Int64 = 0
  private(set) var lastTelemetryAt: Int64?
  private(set) var boardError: String?
  var linkIntegrity: LinkIntegrity { session?.linkIntegrity ?? .unknown }

  private var session: BoardSession?
  private var sessionSequence: Int64 = 0
  private var config: BoardConnectConfig?
  private let reassembler = VescPacketReassembler()
  private let batteryEstimator = BatterySocEstimator()
  /// Median window producing the Battery SoC Estimate for display + alerts (ADR-0016).
  private let socWindow = SocMedianWindow()
  private let liveSeries = LiveSeriesEmitter()
  /// Live BMS Series retention (window from `liveHistoryLimitMinutes`); push gated by `bmsSeriesFocused`.
  private let bmsSeriesRing = BmsSeriesRing()
  /// Telemetry-scoped cell-spread Board Warning detector; fed each BMS frame, reset per session.
  private let cellSpreadDetector = CellSpreadDetector()
  /// Telemetry-scoped BMS-vs-config cell-count mismatch detector; fed each BMS frame, reset per session.
  private let batteryConfigMismatchDetector = BatteryConfigMismatchDetector()
  /// True while the battery-detail view is focused (JS intent); gates the `onBmsSeries` push only.
  private var bmsSeriesFocused = false
  private let appData: AppDataRepository
  private lazy var recordingCoordinator = RecordingCoordinator(appData: appData)
  private lazy var configController = ConfigRWController()
  private lazy var gpsMonitor = GpsMonitor(
    onLocation: { [weak self] location in self?.onLocationUpdated(location) },
    onAuthorizationResolved: { [weak self] in self?.onStateChanged?() }
  )
  private lazy var alertAudioPlayer = AlertAudioPlayer()
  private lazy var alertCoordinator = AlertCoordinator(player: alertAudioPlayer)
  private let legalPolicyCatalog = LegalPolicyCatalog()
  /// Persistent Board Session status surface (Live Activity) — the iOS peer of Android's foreground
  /// notification. Native-driven so it survives screen-off and a dead JS runtime.
  private lazy var liveActivity = RideLiveActivityController()
  /// Critical local notifications are a narrow interruptive path only. Permission is explicit and
  /// never requested from the telemetry/connect path.
  private var criticalNotificationFaultCode: Int?
  /// Latest values reflected in the Live Activity; updates fire only on real change (throttle).
  private var liveBatteryPercent: Int?
  /// Battery voltage rounded to the displayed 1-decimal resolution, so `"75.1V"` only refreshes the
  /// activity when the shown value actually changes.
  private var liveBatteryVoltage: Double?
  private var liveFaultCode: Int?
  /// Rate-limit for voltage-driven Live Activity refreshes. Android updates its notification every
  /// telemetry frame; iOS must respect the ActivityKit update budget, so frequent voltage jitter is
  /// throttled while phase / percent / fault changes still refresh immediately.
  private var lastLiveTelemetryRefreshAt: Int64 = 0
  private let liveTelemetryRefreshMinMs: Int64 = 1000
  private var latestLocation: TelemetryLocationCapture?
  private var latestPreciseLocation: TelemetryLocationCapture?
  private let courseDeriver = GpsCourseDeriver()
  private var recentLocations: [[String: Any?]] = []
  /// Lives in the monitor, not mirrored here: authorization can be answered after `start()` returns,
  /// so a stored copy would go stale the moment the permission dialog resolves.
  private var gpsError: String? { gpsMonitor.error }
  private var gpsSessionStartedAt: Int64?
  private var gpsFixCount = 0
  private var gpsPreciseFixCount = 0
  private var gpsFirstFixAt: Int64?
  private var gpsFirstPreciseFixAt: Int64?
  private var gpsLastFixAt: Int64?

  private var pendingOnSuccess: (() -> Void)?
  private var pendingOnError: ((String, String) -> Void)?
  private var connectSettled = false

  // MARK: Reconnect state (#58)

  /// True from a mid-ride link drop until the GATT link is re-established or the session ends.
  /// Guards the rescan cycle timers so they stop the moment reconnect resolves or is torn down.
  private var reconnecting = false
  /// Active-scan window vs idle gap (ms) while reconnecting, tuned per app run-state: aggressive
  /// in the foreground, gentle under the `location` background mode to spare battery.
  private let rescanForegroundWindowMs = 4000
  private let rescanForegroundIdleMs = 2000
  private let rescanBackgroundWindowMs = 4000
  private let rescanBackgroundIdleMs = 12000

  // MARK: Scan state

  private(set) var scanPhase = "idle"
  private(set) var scanError: String?

  // MARK: Polling state

  private var polling = false
  /// Effective poll-interval floor (ms). Widens to `IDLE_PAUSE_POLL_INTERVAL_MS` while idle-paused.
  private var floorMs = 0
  /// Idle Pause state machine (ADR-0021): throttles polling and halts recording while stationary.
  private let idlePauseDetector = IdlePauseDetector()
  /// Cached moving threshold shared with the metric sanitizer; fed to the detector each frame.
  private var movingThresholdCentiKmh = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH
  /// Board Warnings master switch (kill switch, #219). Off ⇒ no detector evaluation, no registry
  /// writes, no session-end clean pass. Cached from settings in `beginSession` and
  /// `reloadTelemetrySettings` so the BMS path never re-reads settings.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardWarningsEnabled`
  private var boardWarningsEnabled = true
  private var lastPollAt: Int64 = 0
  private var smoothedPeriodMs = 0.0
  private var pollTick: Int64 = 0
  /// BMS values change slowly and their cell-voltage replies are large; poll them at 1/stride of the
  /// telemetry rate to spare the BLE link. Mirrors Android `PollingLoop.BMS_POLL_STRIDE`.
  private let bmsPollStride: Int64 = 8
  private var pollWorkItem: DispatchWorkItem?
  private var safetyWorkItem: DispatchWorkItem?
  private var staleWorkItem: DispatchWorkItem?

  // Batched history flush cadence (cold path); the hot `onLiveTick` fires every frame.
  private var historyBuffer: [[String: Any?]] = []
  private var lastHistoryFlushAt: Int64 = 0
  private let historyFlushIntervalMs: Int64 = 300

  // Latest Battery SoC Estimate + voltage, retained so the session-end persist writes fresh values.
  private var latestBatterySoc: Double?
  private var latestBatteryVoltage: Double?
  private var lastBatteryPersistedAt: Int64 = 0

  init(appData: AppDataRepository = .shared) {
    self.appData = appData
  }

  // MARK: - Board Presence Scan (ADR 0035)

  /// Adapter over the shared session central. Owned here because the central is shared with the
  /// Board Session, so readiness and advertisements arrive through this class's listener callbacks.
  private lazy var presenceScanPort = BlePresenceScanPort(
    central: { [weak self] in self?.gatt.centralState ?? .unknown },
    start: { [weak self] in self?.gatt.startScan() },
    stop: { [weak self] in
      // A live Add Board scan keeps the radio; only the presence flag is dropped.
      self?.gatt.stopScan()
    }
  )

  private lazy var presenceScan = BoardPresenceScan(
    port: presenceScanPort,
    scanner: .shared,
    ownership: .shared,
    onStateChanged: { [weak self] state in
      self?.onStateChanged?()
      // Terminal phase: hand the borrowed background time straight back. Holding it any longer
      // would be a keep-alive, which this is explicitly not (ADR 0034).
      if state.phase == .done { self?.presenceScanBackgroundTask.end() }
    },
    onPromote: { [weak self] target, workflow in self?.promoteToSession(target, workflow) }
  )

  /// Short background task covering the foreground→lock handoff for the Presence Scan (#405).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/ForegroundWork.kt
  private lazy var presenceScanBackgroundTask = PresenceScanBackgroundTask(
    onEvent: { [weak self] event in self?.traceBackgroundTask(event) }
  )

  /// One correlated workflow per background-task transition, so #414's audit sees the decision.
  private func traceBackgroundTask(_ event: String) {
    let workflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.foregroundEntry,
      owner: ConnectionTraceOwner.autoConnect
    )
    workflow.event(event, fields: [ConnectionTraceField.serviceState: "background_task"])
    workflow.finish(
      decision: event == ConnectionTraceEvent.backgroundTaskExpired
        ? ConnectionTraceDecision.timeout
        : ConnectionTraceDecision.completed,
      reason: event == ConnectionTraceEvent.backgroundTaskExpired
        ? ConnectionTraceReason.deadlineExpired
        : ConnectionTraceReason.matched
    )
  }

  /// Explicit rider Connect Intent (ADR 0035). Outranks Auto Start and Auto Connect, and persists
  /// indefinitely while Auto Close is disabled. #409 creates one at the end of linking.
  var connectIntent: ConnectIntent?

  /// An intent past its Auto Close deadline no longer owns anything, so it must not keep the
  /// Presence Scan skipping. Expiry is a clock comparison on read, never a timer.
  var hasActiveConnectIntent: Bool {
    guard let connectIntent else { return false }
    return !ConnectIntentPolicy.isExpired(connectIntent, nowMs: ConnectionTrace.now())
  }

  /// Observations age out thirty seconds after their last advertisement (#408). Pruning on read keeps
  /// that a clock comparison — nothing has to be scheduled to forget.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `presenceScan`
  var presenceScanState: PresenceScanState {
    AlternativeHints.prune(presenceScan.state, nowMs: ConnectionTrace.now())
  }

  /// Exclusive scanner ownership held while the Add Board scan runs (ADR 0035).
  private var addBoardScan: ScanOperation?

  /// Board Presence Scan on foreground entry (ADR 0035). Replaces the old module-create direct
  /// connect: native looks for the selected Board for five seconds after the radio is usable and
  /// promotes it into a Board Session only when policy allows. Every refusal carries a named reason
  /// through the shared connection trace.
  ///
  /// Driven by `VescapeLaunchSubscriber` (native app lifecycle), never by JS `AppState` and never by
  /// module creation.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `startPresenceScan`
  @discardableResult
  func startPresenceScan() -> PresenceScanDecision {
    let workflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.foregroundEntry,
      owner: ConnectionTraceOwner.none
    )
    let settings = appData.getSettings()
    let selectedBoardId = settings["selectedBoardId"] as? String
    let targets = presenceTargets(selectedBoardId: selectedBoardId)
    let environment = PresenceScanEnvironment(
      linkedBoardCount: targets.count,
      selectedBoardId: selectedBoardId,
      selectedBoardBleId: targets.first(where: { $0.selected })?.bleId,
      bluetoothEnabled: presenceScanPort.bluetoothEnabled(),
      scanPermissionGranted: presenceScanPort.scanPermissionGranted(),
      scannerAvailable: presenceScanPort.scannerAvailable(),
      sessionActive: connectedBoardId != nil || session != nil,
      connectIntentActive: hasActiveConnectIntent,
      activeScanPurpose: ScannerCoordinator.shared.activePurpose
    )
    let autoConnect = settings["autoConnect"] as? Bool ?? true
    // Buy the handoff window *before* the scan starts: the rider who opens the app and immediately
    // locks the screen must not lose the scan to suspension. Ended at the scan's terminal phase.
    presenceScanBackgroundTask.start()
    let decision = presenceScan.start(
      environment: environment,
      targets: targets,
      workflow: workflow,
      promotionInput: { [weak self] in
        PresencePromotionInput(
          selectedObserved: true,
          autoConnectEnabled: autoConnect,
          pausedUntilMs: self?.pausedUntilMs(boardId: selectedBoardId),
          nowMs: ConnectionTrace.now(),
          sessionActive: self?.session != nil,
          currentOwner: ConnectionOwnership.shared.current
        )
      }
    )
    // A refused scan owns no work at all, so it may not sit on borrowed background time either.
    if !decision.proceed { presenceScanBackgroundTask.end() }
    return decision
  }

  /// Automatic Connection Pause deadline for `boardId`, or `nil` when it is not paused (ADR 0035).
  private func pausedUntilMs(boardId: String?) -> Int64? {
    ConnectionPauseStore.shared.pausedUntilMs(boardId: boardId)
  }

  /// The Automatic Connection Pause the rider sees, for the selected Board.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `liveStateMap`
  func connectionPauseState(boardId: String?) -> [String: Any?]? {
    ConnectionPauseStore.shared.active(boardId: boardId)?.map
  }

  /// Arm the board-scoped Automatic Connection Pause for a rider action (ADR 0035, #406).
  ///
  /// Only the rider intents reach here — Disconnect and End ride. `ConnectionPausePolicy` refuses
  /// anything else, so a mechanical teardown that ever grew a call to this cannot silently start
  /// suppressing Auto Connect.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `armConnectionPause`
  @discardableResult
  func armConnectionPause(boardId: String?, source: String, origin: String) -> ConnectionPause? {
    let settings = appData.getSettings()
    let resolved = (boardId?.isEmpty == false ? boardId : nil)
      ?? ((settings["selectedBoardId"] ?? nil) as? String)
    guard let resolved, !resolved.isEmpty else { return nil }
    // A rider stop ends the explicit Connect too; nothing may keep searching past it.
    clearConnectIntent(ConnectIntentEnd.from(pauseSource: source))
    let minutes =
      AppDataRepository.automaticConnectionPauseMinutes(settings["automaticConnectionPauseMinutes"] ?? nil) ?? 60
    let workflow = ConnectionTrace.start(
      origin: origin,
      owner: ConnectionTraceOwner.none,
      fields: [ConnectionTraceField.boardId: resolved]
    )
    let pause = ConnectionPauseStore.shared.arm(
      boardId: resolved,
      source: source,
      minutes: minutes,
      workflow: workflow
    )
    workflow.finish(
      decision: pause != nil ? ConnectionTraceDecision.completed : ConnectionTraceDecision.skipped,
      reason: source
    )
    return pause
  }

  /// **The** application-level explicit-Connect entry point (ADR 0035). Every rider-initiated
  /// Connect goes through here — the Connect pill, Connect now, and Switch & Connect — so explicit
  /// semantics exist in one place: clear that Board's Automatic Connection Pause, take durable
  /// Connect Intent ownership, and record the selection. Starting the actual session stays with the
  /// caller, which owns the platform's session plumbing.
  ///
  /// `origin` distinguishes the callers in the trace; `alternativeHintSwitch` additionally records
  /// that a hint was accepted. #409 reuses this for connect-after-linking.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `beginExplicitConnect`
  func beginExplicitConnect(boardId: String, origin: String = ConnectionTraceOrigin.explicitConnect) {
    guard !boardId.isEmpty else { return }
    let workflow = ConnectionTrace.start(
      origin: origin,
      owner: ConnectionTraceOwner.connectIntent,
      fields: [ConnectionTraceField.boardId: boardId]
    )
    if origin == ConnectionTraceOrigin.alternativeHintSwitch {
      workflow.event(
        ConnectionTraceEvent.alternativeHintAccepted,
        fields: [ConnectionTraceField.boardId: boardId]
      )
    }
    // A rider Connect preempts automatic work: stop the Presence Scan before it can promote the
    // Board it was watching — during Switch & Connect that is the *old* selected Board. A scan
    // started after this point sees the Connect Intent and skips itself (`PresenceScanPolicy`).
    presenceScan.cancel(reason: ConnectionTraceReason.connectIntentActive)
    ConnectionPauseStore.shared.clear(boardId: boardId, workflow: workflow)
    createConnectIntent(boardId: boardId, workflow: workflow)
    workflow.event(ConnectionTraceEvent.boardSelected, fields: [ConnectionTraceField.boardId: boardId])
    workflow.finish(decision: ConnectionTraceDecision.completed, reason: ConnectionTraceReason.matched)
  }

  /// A rider Connect owns the connection until it succeeds, the rider ends it, or Auto Close expires.
  private func createConnectIntent(boardId: String, workflow: ConnectionWorkflow) {
    let settings = appData.getSettings()
    let enabled = ((settings["autoCloseEnabled"] ?? nil) as? Bool) == true
    let minutes = ((settings["autoCloseDelayMinutes"] ?? nil) as? NSNumber)?.int64Value ?? 15
    let intent = ConnectIntent(
      boardId: boardId,
      createdAtMs: ConnectionTrace.now(),
      autoCloseMs: enabled ? minutes * 60_000 : nil
    )
    connectIntent = intent
    workflow.event(
      ConnectionTraceEvent.connectIntentCreated,
      fields: [
        ConnectionTraceField.boardId: boardId,
        ConnectionTraceField.deadlineAt: intent.autoCloseAtMs,
      ]
    )
  }

  /// End the explicit Connect Intent. Reaching `connected`, a rider stop, and Auto Close all land here.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `clearConnectIntent`
  func clearConnectIntent(_ end: ConnectIntentEnd) {
    guard let intent = connectIntent else { return }
    connectIntent = nil
    let workflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.explicitConnect,
      owner: ConnectionTraceOwner.connectIntent,
      fields: [ConnectionTraceField.boardId: intent.boardId]
    )
    workflow.event(
      ConnectionTraceEvent.connectIntentCleared,
      fields: [ConnectionTraceField.boardId: intent.boardId, ConnectionTraceField.reason: end.reason]
    )
    workflow.finish(decision: ConnectionTraceDecision.completed, reason: end.reason)
  }

  /// **Stop search**, or an exclusive scanner owner taking over.
  func stopPresenceScan(reason: String = ConnectionTraceReason.stopSearch) {
    presenceScan.cancel(reason: reason)
  }

  /// Linked Boards the scan watches. A Board without a Board Link has no BLE id to watch for.
  private func presenceTargets(selectedBoardId: String?) -> [PresenceTarget] {
    appData.getBoards().compactMap { board in
      guard let boardId = board["id"] as? String else { return nil }
      let link = board["link"] as? [String: Any?]
      guard let bleId = (link?["bleId"] as? String), !bleId.isEmpty else { return nil }
      return PresenceTarget(
        boardId: boardId,
        bleId: bleId,
        name: board["name"] as? String,
        selected: boardId == selectedBoardId
      )
    }
  }

  /// Promote an observed selected Board into a Board Session (Auto Connect path).
  /// The Presence Scan hands its still-open workflow over, so every terminal branch of the
  /// promotion — session started, refused because one already exists, or an unresolvable Board Link
  /// — closes the *same* correlation instead of ending the trace at `auto_connect_promoted` (#414).
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `promoteToSession`
  private func promoteToSession(_ target: PresenceTarget, _ workflow: ConnectionWorkflow?) {
    guard session == nil else {
      workflow?.finish(
        decision: ConnectionTraceDecision.skipped,
        reason: ConnectionTraceReason.sessionAlreadyActive
      )
      return
    }
    guard
      let config = BoardConnectConfig.resolve(
        boardId: target.boardId,
        appData: appData,
        recordingEnabled: false
      )
    else {
      ConnectionOwnership.shared.release(.boardSession)
      workflow?.event(
        ConnectionTraceEvent.ownerReleased,
        fields: [
          ConnectionTraceField.boardId: target.boardId,
          ConnectionTraceField.ownerPrevious: ConnectionOwner.boardSession.wireValue,
        ]
      )
      workflow?.finish(
        decision: ConnectionTraceDecision.failed,
        reason: ConnectionTraceReason.noBoardLink
      )
      return
    }
    workflow?.finish(
      decision: ConnectionTraceDecision.completed,
      reason: ConnectionTraceReason.matched
    )
    connect(config: config, onSuccess: {}, onError: { _, _ in })
  }

  // MARK: - Scan API

  /// Rider-driven Add Board discovery. Takes exclusive scanner ownership (ADR 0035) so the
  /// foreground Presence Scan yields to it and can never preempt it.
  func scan() {
    presenceScan.cancel(reason: ConnectionTraceReason.scannerBusy)
    if case let .granted(operation) = ScannerCoordinator.shared.acquire(.addBoard) {
      addBoardScan = operation
    }
    scanError = nil
    scanPhase = "scanning"
    gatt.startScan()
    onStateChanged?()
  }

  func stopScan() {
    gatt.stopScan()
    ScannerCoordinator.shared.release(addBoardScan)
    addBoardScan = nil
    scanPhase = "idle"
    onStateChanged?()
  }

  // MARK: - Connect API

  func connect(
    config: BoardConnectConfig,
    replay: ReplayTransport? = nil,
    onSuccess: @escaping () -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    replayTransport?.disconnect()
    // Starting a replay while a live board is connected: tear the live GATT link down first, or
    // its callbacks keep feeding real frames into the replay session. A live→live connect needs
    // no such step — `gatt.connect` clears its own previous peripheral.
    if replay != nil { gatt.disconnect() }
    replayTransport = replay
    // A replay owns the session's notion of time for its lifetime. Installed here, with the
    // transport, so it cannot be undone by the teardown of the session being replaced.
    sessionClock = replay?.clock ?? SystemSessionClock.shared
    gatt.recorder = { [weak self] in self?.recordingCoordinator.currentRecorder() }
    batteryEstimator.ensureLoaded()
    liveSeries.emit = { [weak self] name, body in self?.emit?(name, body) }
    liveSeries.generation = { [weak self] in self?.connectionSeq ?? 0 }
    liveSeries.speed = { [weak self] in self?.sessionClock.speed ?? 1.0 }
    liveSeries.setWindowMinutes(config.liveHistoryLimitMinutes)
    beginSession(config: config, onSuccess: onSuccess, onError: onError)
    transport.connect(peripheralId: config.bleId)
    armConnectTimeout()
  }

  /// Start a dev-mode replay session (ADR 0024): a Debug Recording played through the real session
  /// stack via `ReplayTransport`, keyed under a synthetic `replay:` board id so durable writes stay
  /// isolated from real boards. Stop = normal disconnect; the recording running out ends the
  /// session like a disconnect.
  ///
  /// `warmupMs` / `warmupSpeed` are opt-in and default to a plain 1× replay, so the Replay UI plays
  /// a ride exactly as it happened. A caller that needs the live charts populated up front — the
  /// screenshot run, an E2E flow — asks for a warmup window and how much faster than real time to
  /// deliver it.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startDebugReplay`
  func startReplay(
    recordingName: String,
    warmupMs: Int64 = 0,
    warmupSpeed: Double = 1.0,
    onSuccess: @escaping () -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    guard
      let url = ReplayRecordings.url(name: recordingName),
      let jsonl = try? String(contentsOf: url, encoding: .utf8)
    else {
      onError("REPLAY_NOT_FOUND", "Debug recording not found: \(recordingName)")
      return
    }
    let meta = jsonl.split(separator: "\n").first
      .flatMap { $0.data(using: .utf8) }
      .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
    let baseName = recordingName.hasSuffix(".jsonl") ? String(recordingName.dropLast(6)) : recordingName
    let replayBoardId = "replay:" + baseName
    let settings = appData.getSettings()
    // The synthetic `replay:` board id has no board row and therefore no pack config, so the SoC
    // estimate would stay nil for the whole playback and the battery bar would read nothing. The
    // recording is a ride of a real board: borrow the selected board's pack to size it.
    let replayBatteryConfig = (settings["selectedBoardId"] as? String)
      .flatMap { appData.getBoard($0) }
      .flatMap { AppDataRepository.normalizeBatteryConfig($0["batteryConfig"] ?? nil) }
    let config = BoardConnectConfig(
      appBoardId: replayBoardId,
      bleId: replayBoardId,
      name: (meta?["deviceName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? recordingName,
      transport: .direct,
      linkVersion: nil,
      hasBms: nil,
      vescFirmwareVersion: nil,
      refloatVersion: nil,
      refloatBaseVersion: nil,
      pollIntervalMs: (meta?["pollIntervalMs"] as? NSNumber)?.intValue ?? 0,
      batteryConfig: replayBatteryConfig,
      liveHistoryLimitMinutes: AppDataRepository.liveHistoryLimitMinutes(settings["liveHistoryLimit"] ?? nil) ?? 5
    )
    connect(
      config: config,
      replay: ReplayTransport(
        recordingName: recordingName,
        listener: self,
        onLocation: { [weak self] fix in self?.onReplayLocation(fix) },
        onHeading: { [weak self] heading in self?.onReplayHeading(heading) },
        clock: ReplayClock(warmupMs: warmupMs, warmupSpeed: warmupSpeed)
      ),
      onSuccess: onSuccess,
      onError: onError
    )
  }

  @discardableResult
  func stopBoard() -> Bool {
    guard session != nil else { return false }
    endSession(phase: .idle, error: nil)
    return true
  }

  /// Read Refloat config from the connected Board and seed the first Tune Profile. Mirrors Android
  /// `getRefloatConfigSnapshot` read path.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWController.kt `consumeRead`
  func getRefloatConfigSnapshot(
    onSuccess: @escaping ([String: Any?]) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    guard let config else {
      onError(
        RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue,
        "Board must be connected before reading Refloat config"
      )
      return
    }
    configController.consumeRead(
      connection: configConnection(config),
      onSuccess: onSuccess,
      onError: onError
    )
  }

  /// Encode a saved Tune Profile onto the live Refloat config and write it back to the Board via
  /// `COMM_SET_CUSTOM_CONFIG`, verifying the readback. Mirrors Android `pushProfileToBoard`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWController.kt `consumeWrite`
  func pushProfileToBoard(
    profileId: String,
    onSuccess: @escaping ([String: Any?]) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    guard let config else {
      onError(
        RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue,
        "Board must be connected before pushing config"
      )
      return
    }
    configController.consumeWrite(
      profileId: profileId,
      connection: configConnection(config),
      onSuccess: onSuccess,
      onError: onError
    )
  }

  // MARK: - Live-state snapshot

  func remoteTiltState() -> [String: Any?]? { nil }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `startBoardMove`
  func startBoardMove(input: Int) -> Bool {
    boardMoveController.hold(input)
  }

  /// Deliberately ungated: a stop must reach the board even if the link lost trust mid-hold,
  /// otherwise the rider's release does nothing and the board coasts to the firmware timeout.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `stopBoardMove`
  func stopBoardMove() -> Bool {
    boardMoveController.stop()
  }

  private func firmwareCommandsTrusted() -> Bool {
    phase == .connected && linkIntegrity == .trusted
  }
  func gpsActive() -> Bool { gpsMonitor.active }
  func gpsLatestLocation() -> [String: Any?]? { latestLocation?.map }
  func gpsLatestPreciseLocation() -> [String: Any?]? { latestPreciseLocation?.map }
  /// Where the rider is, for callers that need a position rather than a *good* position —
  /// Navigation being the one that matters. Freshness beats accuracy here: a weak indoor fix from a
  /// second ago is the right place to start a path from, while the last precise fix can be
  /// yesterday's and kilometres away. Precise only stands in when nothing newer exists at all.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `riderPosition`
  func riderPosition() -> (latitude: Double, longitude: Double)? {
    guard let location = latestLocation ?? latestPreciseLocation else { return nil }
    return (location.latitude, location.longitude)
  }
  func gpsRecentLocations() -> [[String: Any?]] { recentLocations }
  /// Recent raw-tick window for JS live-chart rehydrate. Backed by the live-series buffer.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `recentSnapshot`
  func recentTelemetry() -> [[String: Any?]] { liveSeries.recentSnapshot() }
  func gpsLastError() -> String? { gpsError }
  func telemetryRecordingEnabled() -> Bool { recordingCoordinator.telemetryRecordingEnabled }
  func recordingPaused() -> Bool { idlePauseDetector.isPaused }
  func recordingActiveBoardId() -> String? { recordingCoordinator.activeBoardId }

  /// The one place the phone's GPS is armed. A replay owns position for its whole session, so the
  /// guard lives here rather than at the call sites: the map, the settings toggle and the session
  /// start all ask for location updates independently, and a single live fix slipping through is
  /// enough to make the marker jump off the recorded track.
  func startLocationUpdates() {
    guard replayTransport == nil else { return }
    _ = gpsMonitor.start()
    onStateChanged?()
  }

  func stopLocationUpdates() {
    gpsMonitor.stop()
    onStateChanged?()
  }

  func setTelemetryRecordingEnabled(_ enabled: Bool) -> Bool {
    let ok = recordingCoordinator.setTelemetryRecordingEnabled(enabled)
    if enabled && ok { startLocationUpdates() }
    syncResumeMarkerRecording()
    onStateChanged?()
    return ok
  }

  // MARK: - Alerts

  /// Re-read enabled alert rules from GRDB and feed them to the alert engine. Mirrors Android
  /// `BoardSessionController.loadAlertRules`. Called whenever JS changes rules.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadAlertRules`
  func reloadAlertRules() {
    guard let boardId = config?.appBoardId else {
      alertCoordinator.replaceRules([])
      return
    }
    let board = appData.getBoard(boardId)
    let enabled = ((board?["legalMode"] ?? nil) as? [String: Any])?["enabled"] as? Bool ?? false
    let jurisdictionCode =
      ((appData.getSettings()["legalPolicy"] ?? nil) as? [String: Any])?["jurisdictionCode"] as? String
    let speeds = jurisdictionCode.flatMap(legalPolicyCatalog.speeds)
    alertCoordinator.replaceRules(withLegalModeOverlay(
      appData.getEnabledAlertRules(boardId),
      boardId: boardId,
      enabled: enabled,
      warningSpeedKmh: speeds?.warningSpeedKmh,
      limitSpeedKmh: speeds?.limitSpeedKmh
    ))
  }

  func legalModeEnableError(boardId: String) -> (String, String)? {
    VescapeCore.legalModeEnableError(
      phase: phase,
      activeBoardId: connectedBoardId,
      linkIntegrity: linkIntegrity,
      requestedBoardId: boardId
    )
  }

  /// Re-read mutable board-scoped session data after JS edits the active board. The BLE endpoint
  /// and transport stay fixed for the running session (ADR 0015); rider-facing name and battery
  /// config are live like Android's foreground notification and alert/battery pipeline.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `reloadBoardDataForActiveBoard`
  func reloadBoardDataForActiveBoard() {
    guard let current = config else { return }
    guard let board = appData.getBoard(current.appBoardId) else { return }
    let name = (board["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? current.name
    let updated = BoardConnectConfig(
      appBoardId: current.appBoardId,
      bleId: current.bleId,
      name: name,
      transport: current.transport,
      linkVersion: current.linkVersion,
      hasBms: current.hasBms,
      vescFirmwareVersion: current.vescFirmwareVersion,
      refloatVersion: current.refloatVersion,
      refloatBaseVersion: current.refloatBaseVersion,
      pollIntervalMs: current.pollIntervalMs,
      batteryConfig: AppDataRepository.normalizeBatteryConfig(board["batteryConfig"] ?? nil),
      liveHistoryLimitMinutes: current.liveHistoryLimitMinutes,
      recordingEnabled: current.recordingEnabled
    )
    config = updated
    recordingCoordinator.updateBoardSessionConfig(updated)
    boardName = name
    refreshLiveActivity()
    onStateChanged?()
  }

  /// Re-read mutable app settings that affect live native work while a session is already running.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadTelemetrySettings`
  func reloadTelemetrySettings() {
    guard let current = config else { return }
    let settings = appData.getSettings()
    let hz = AppDataRepository.intValue(settings["telemetryPollRateHz"] ?? nil) ?? 0
    let liveHistoryLimit = AppDataRepository.liveHistoryLimitMinutes(settings["liveHistoryLimit"] ?? nil)
      ?? current.liveHistoryLimitMinutes
    config = BoardConnectConfig(
      appBoardId: current.appBoardId,
      bleId: current.bleId,
      name: current.name,
      transport: current.transport,
      linkVersion: current.linkVersion,
      hasBms: current.hasBms,
      vescFirmwareVersion: current.vescFirmwareVersion,
      refloatVersion: current.refloatVersion,
      refloatBaseVersion: current.refloatBaseVersion,
      pollIntervalMs: hz > 0 ? 1000 / hz : 0,
      batteryConfig: current.batteryConfig,
      liveHistoryLimitMinutes: liveHistoryLimit,
      recordingEnabled: current.recordingEnabled
    )
    movingThresholdCentiKmh = MetricSanitizerConfig.from(settings: settings).movingSpeedThresholdCentiKmh
    let warningsWereEnabled = boardWarningsEnabled
    boardWarningsEnabled = settings["boardWarningsEnabled"] as? Bool ?? true
    // Disabled→enabled with an already-trusted link: link integrity won't transition again, so
    // schedule the config-safety read here.
    if !warningsWereEnabled, boardWarningsEnabled, lastEmittedLinkIntegrity == .trusted {
      scheduleConfigSafetyRead()
    }
    floorMs = effectivePollIntervalMs()
    liveSeries.setWindowMinutes(liveHistoryLimit)
    socWindow.windowMs = Int64(AppDataRepository.intValue(settings["socEstimateWindowSeconds"] ?? nil) ?? 20) * 1000
    recordingCoordinator.applySettings(settings)
    pruneRecentLocations(now: nowMs())
  }

  /// Play a preset once for UI preview, or speak a `tts:` template. Mirrors Android
  /// `previewAlertSound`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `previewAlertSound`
  func previewAlertSound(_ soundType: String) {
    alertAudioPlayer.preview(soundType: soundType)
  }

  /// Drive a geiger preview loop without a connected board — UI slider over `rangeDepth`.
  func startGeigerSimulation(soundType: String, rangeDepth: Double) {
    alertAudioPlayer.updateGeiger(ruleId: geigerSimulationId, soundType: soundType, rangeDepth: rangeDepth)
  }

  func stopGeigerSimulation() {
    alertAudioPlayer.stopGeiger(ruleId: geigerSimulationId)
  }

  private let geigerSimulationId = "vescape.preview.geiger"

  // MARK: - Headless resume (#378, ADR 0034)

  /// Marker of the session this launch may have to resume, held from launch until restoration is
  /// adopted (or the wait expires). While set, the Live Activity counts as claimed so the launch
  /// reap does not kill the surface the resume is about to reuse.
  private var pendingResume: SessionResumeMarker?
  private var pendingResumeExpiry: DispatchWorkItem?
  /// Correlated workflow for the CoreBluetooth-restoration resume (#414). The restoration crosses a
  /// process death, so no earlier correlation survives to inherit — this is a fresh `reconnect`
  /// workflow whose terminal branch is adoption, an unresolvable Board Link, or the expiry window.
  ///
  /// @platform-diff Android has no CoreBluetooth state restoration: its foreground service outlives
  /// the JS runtime, so a Board Session is never rebuilt from a preserved central.
  private var restoreWorkflow: ConnectionWorkflow?

  /// Terminal branch of the restoration workflow. Every exit from the resume path lands here.
  private func finishRestoreWorkflow(decision: String, reason: String) {
    guard let workflow = restoreWorkflow else { return }
    restoreWorkflow = nil
    workflow.finish(decision: decision, reason: reason)
  }
  /// How long a launch waits for `willRestoreState` before deciding no restoration is coming.
  /// CoreBluetooth delivers it inside the launch sequence, so this only guards the case where it
  /// never arrives at all (marker outlived the connection).
  private let pendingResumeWindowSeconds = 15.0

  /// Called from the app-delegate subscriber inside `didFinishLaunching` (ADR 0034). CoreBluetooth
  /// only replays preserved state to a central re-created with the same restore identifier during
  /// launch — the session central is `lazy` and JS-triggered, which is far too late — so this
  /// constructs it eagerly. Gated on the resume marker: a normal cold start spins up no BLE.
  func prepareForLaunch() {
    guard session == nil, pendingResume == nil else { return }
    guard let marker = SessionResumeStore.shared.pending else { return }
    pendingResume = marker
    restoreWorkflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.reconnect,
      owner: ConnectionTraceOwner.boardSession,
      fields: [
        ConnectionTraceField.boardId: marker.appBoardId,
        ConnectionTraceField.deadlineMs: Int64(pendingResumeWindowSeconds * 1000),
      ]
    )
    let expiry = DispatchWorkItem { [weak self] in self?.expirePendingResume() }
    pendingResumeExpiry = expiry
    DispatchQueue.main.asyncAfter(deadline: .now() + pendingResumeWindowSeconds, execute: expiry)
    // Touching the lazy client is the whole point: its init builds the restore-identified central.
    _ = gatt
  }

  /// No restoration arrived. Release the Live Activity claim so the launch reap can do its job on
  /// what is, after all, a ghost. The marker itself is left alone: it is the trapdoor for the next
  /// board notification, and a live session re-writes it anyway.
  private func expirePendingResume() {
    pendingResumeExpiry = nil
    guard pendingResume != nil, session == nil else {
      pendingResume = nil
      finishRestoreWorkflow(
        decision: ConnectionTraceDecision.completed,
        reason: ConnectionTraceReason.matched
      )
      return
    }
    pendingResume = nil
    finishRestoreWorkflow(
      decision: ConnectionTraceDecision.timeout,
      reason: ConnectionTraceReason.deadlineExpired
    )
    reapOrphanLiveActivities()
  }

  private func clearPendingResume() {
    pendingResumeExpiry?.cancel()
    pendingResumeExpiry = nil
    pendingResume = nil
  }

  /// Rebuild the Board Session that was live when the process died. Reuses the ordinary session
  /// wiring (`beginSession`) rather than duplicating it, so recording, GPS, alerts and the Live
  /// Activity resume exactly as a foreground connect starts them — the only differences are where
  /// the link comes from (a restored peripheral instead of a fresh connect) and that the recording
  /// keeps appending to the open recording.
  private func resumeSession(marker: SessionResumeMarker, restoredPeripheralIds: [String]) {
    guard session == nil else {
      finishRestoreWorkflow(
        decision: ConnectionTraceDecision.skipped,
        reason: ConnectionTraceReason.sessionAlreadyActive
      )
      return
    }
    guard let config = BoardConnectConfig.resolve(boardId: marker.appBoardId, appData: appData) else {
      // Board unlinked or deleted while the app was dead — nothing to resume.
      SessionResumeStore.shared.clear()
      clearPendingResume()
      reapOrphanLiveActivities()
      finishRestoreWorkflow(
        decision: ConnectionTraceDecision.skipped,
        reason: ConnectionTraceReason.noBoardLink
      )
      return
    }
    restoreWorkflow?.event(
      ConnectionTraceEvent.presenceScanMatched,
      fields: [
        ConnectionTraceField.scanPurpose: ScanPurpose.reconnect.wireValue,
        ConnectionTraceField.boardId: marker.appBoardId,
        ConnectionTraceField.bleId: config.bleId,
      ]
    )
    gatt.recorder = { [weak self] in self?.recordingCoordinator.currentRecorder() }
    batteryEstimator.ensureLoaded()
    liveSeries.emit = { [weak self] name, body in self?.emit?(name, body) }
    liveSeries.generation = { [weak self] in self?.connectionSeq ?? 0 }
    liveSeries.speed = { [weak self] in self?.sessionClock.speed ?? 1.0 }
    liveSeries.setWindowMinutes(config.liveHistoryLimitMinutes)
    // Re-arm the recording request *before* the session begins so `beginBoardSession` enables the
    // telemetry store on its normal path. Nothing resets the store's tables: frames land in the
    // same open recording and the existing gap-splitter explains the dead interval.
    if marker.recordingActive {
      _ = recordingCoordinator.setTelemetryRecordingEnabled(true)
    }
    beginSession(config: config, resume: true, onSuccess: {}, onError: { _, _ in })
    let restoredId = restoredPeripheralIds.first {
      $0.caseInsensitiveCompare(config.bleId) == .orderedSame
    }
    if let restoredId, gatt.adoptRestored(peripheralId: restoredId) {
      recordConnectionDiagnostic(
        "session_restored",
        operation: "connect",
        message: "Board Session resumed from CoreBluetooth state restoration",
        extra: ["recording_active": marker.recordingActive]
      )
    } else {
      // Restored with no usable peripheral: the link died while the process was dead. Persistent
      // connect keeps retrying until the board comes back — the same path a mid-ride drop takes.
      recordConnectionDiagnostic(
        "session_restored",
        operation: "connect",
        message: "Board Session resumed without a restored peripheral",
        extra: ["recording_active": marker.recordingActive]
      )
      transport.connect(peripheralId: config.bleId)
    }
    armConnectTimeout()
    clearPendingResume()
    finishRestoreWorkflow(
      decision: ConnectionTraceDecision.completed,
      reason: restoredId != nil
        ? ConnectionTraceReason.matched
        : ConnectionTraceReason.boardNotPresent
    )
  }

  /// Refresh the durable resume marker's recording flag; recording is toggled mid-session by
  /// auto-recording at board-ready and by the JS switch.
  private func syncResumeMarkerRecording() {
    guard session != nil, replayTransport == nil else { return }
    SessionResumeStore.shared.setRecordingActive(recordingCoordinator.telemetryRecordingEnabled)
  }

  // MARK: - Session lifecycle

  private func beginSession(
    config: BoardConnectConfig,
    resume: Bool = false,
    onSuccess: @escaping () -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    session?.invalidate()
    stopPolling()
    stopReconnect()
    reassembler.reset()

    sessionSequence += 1
    session = BoardSession(id: sessionSequence)
    // A live Board Session is the top of the precedence chain (ADR 0035). Claim it here, once, so
    // every arbiter resolves against explicit ownership rather than sniffing Board phases; the
    // terminal teardowns (`endSession`, `fail`) release it again.
    ConnectionOwnership.shared.request(.boardSession)
    socWindow.reset()
    bmsSeriesRing.clear()
    // Finalize the previous session's cell-spread evaluation before the detector resets, so
    // replacing/reselecting a Board still auto-clears a clean prior session. Android funnels this
    // through `stopCurrentBoardSession` (called at the top of its `beginSession`); iOS `beginSession`
    // reaches here directly, so finalize here to keep parity.
    if boardWarningsEnabled, let previousBoardId = self.config?.appBoardId {
      if cellSpreadDetector.sessionEndClean() {
        BoardWarningRegistry.shared.reportCleanEvaluation(boardId: previousBoardId, kind: BoardWarningKind.cellSpread)
      }
      if batteryConfigMismatchDetector.sessionEndClean() {
        BoardWarningRegistry.shared.reportCleanEvaluation(boardId: previousBoardId, kind: BoardWarningKind.batteryConfigMismatch)
      }
    }
    cellSpreadDetector.reset()
    batteryConfigMismatchDetector.reset()
    configSafetyReadScheduled = false
    vescLiveFirmware = nil
    self.config = config
    if let session {
      lastEmittedLinkIntegrity = session.startLinkIntegrityCheck(expected: config.linkIdentity())
    }
    let sessionSettings = appData.getSettings()
    movingThresholdCentiKmh = MetricSanitizerConfig.from(settings: sessionSettings).movingSpeedThresholdCentiKmh
    boardWarningsEnabled = sessionSettings["boardWarningsEnabled"] as? Bool ?? true
    recordingCoordinator.beginBoardSession(config: config)
    beginGpsSessionDiagnostics()
    // Reset per-session Board Warning breadcrumb bookkeeping (one Diagnostic Event per kind per
    // Board Session). Detectors that fire warnings this session land in later slices.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt
    BoardWarningRegistry.shared.beginSession(config.appBoardId)
    BoardWarningRegistry.shared.onManualClear = { [weak self] boardId, kind in
      DispatchQueue.main.async { self?.onWarningManuallyCleared(boardId: boardId, kind: kind) }
    }
    // Reset the Board Warning DB-failure throttle so each Board Session gets one breadcrumb per
    // failing store site (mirrors Android clearing `warningFailuresReported`). Keeps warning-path
    // failures non-fatal and reported without per-frame spam.
    BoardWarningFailureReporter.shared.beginSession()
    // Guarding `startLocationUpdates` is not enough: the map, the recording toggle or a prior live
    // session may already have the GPS monitor running, and those live fixes would fight the
    // recorded ones. A replay owns position, so park the live monitor for its lifetime; every
    // session end stops the monitor anyway, so there is nothing to unwind here.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `gpsSuppressedByReplay`
    if replayTransport == nil {
      _ = gpsMonitor.start()
    } else if gpsMonitor.active {
      gpsMonitor.stop()
    }
    // Fresh rule set for this session's alert engine — only the connected Board's enabled rules
    // (mirrors Android loadAlertRules on connect).
    let board = appData.getBoard(config.appBoardId)
    let legalModeEnabled = ((board?["legalMode"] ?? nil) as? [String: Any])?["enabled"] as? Bool ?? false
    let jurisdictionCode =
      ((sessionSettings["legalPolicy"] ?? nil) as? [String: Any])?["jurisdictionCode"] as? String
    let legalSpeeds = jurisdictionCode.flatMap(legalPolicyCatalog.speeds)
    alertCoordinator.replaceRules(withLegalModeOverlay(
      appData.getEnabledAlertRules(config.appBoardId),
      boardId: config.appBoardId,
      enabled: legalModeEnabled,
      warningSpeedKmh: legalSpeeds?.warningSpeedKmh,
      limitSpeedKmh: legalSpeeds?.limitSpeedKmh
    ))
    connectionSeq = sessionSequence
    connectedBoardId = config.appBoardId
    bleId = config.bleId
    boardName = config.name
    boardError = nil
    lastTelemetryAt = nil
    pendingOnSuccess = onSuccess
    pendingOnError = onError
    connectSettled = false
    liveBatteryPercent = nil
    liveBatteryVoltage = nil
    liveFaultCode = nil
    criticalNotificationFaultCode = nil
    lastLiveTelemetryRefreshAt = 0
    setPhase(.connecting)
    if let session {
      updateLinkIntegrity(session.markOutdatedIfIncomplete(expected: config.linkIdentity()))
    }
    // The trapdoor for a jetsam kill (ADR 0034): with this marker on disk the next launch
    // re-creates the restore-identified central in `didFinishLaunching` and rebuilds this session.
    // A replay has no board to relaunch for, so it writes nothing.
    if replayTransport == nil {
      SessionResumeStore.shared.save(
        appBoardId: config.appBoardId,
        bleId: config.bleId,
        recordingActive: recordingCoordinator.telemetryRecordingEnabled,
        nowMs: nowMs()
      )
    }
    // Start the Live Activity while foreground (connect is user-initiated); it then updates from
    // background BLE callbacks for the rest of the session. Mirrors Android showing the chip from
    // session start.
    // A headless resume has no foreground to request one in, so it re-adopts the activity the dead
    // process left behind instead (`Activity.request` fails in the background; `update` does not).
    // Any background session start is in the same boat, restored or not: a headless relaunch that
    // auto-connects instead of restoring must not end a surviving activity it cannot replace.
    if resume || !appIsForeground {
      liveActivity.resume(state: currentLiveState())
    } else {
      liveActivity.start(state: currentLiveState())
    }
  }

  private func endSession(phase: BoardPhase, error: String?) {
    // Nothing left to resurrect: drop the trapdoor so the next cold start stays BLE-free (ADR 0034).
    SessionResumeStore.shared.clear()
    clearPendingResume()
    boardMoveController.stop()
    // Final write so the persisted last battery is fresh, not up to 30s stale (runs before config clears).
    persistLastBattery(percent: latestBatterySoc, voltage: latestBatteryVoltage, now: nowMs(), force: true)
    latestBatterySoc = nil
    latestBatteryVoltage = nil
    socWindow.reset()
    bmsSeriesRing.clear()
    // A whole session with BMS data and no sustained spread auto-clears any stored cell-spread
    // warning; a session with no BMS data reports nothing and leaves it untouched. Skipped
    // entirely when the Board Warnings kill switch is off (no evaluation, no registry writes).
    if boardWarningsEnabled, let boardId = config?.appBoardId {
      if cellSpreadDetector.sessionEndClean() {
        BoardWarningRegistry.shared.reportCleanEvaluation(boardId: boardId, kind: BoardWarningKind.cellSpread)
      }
      if batteryConfigMismatchDetector.sessionEndClean() {
        BoardWarningRegistry.shared.reportCleanEvaluation(boardId: boardId, kind: BoardWarningKind.batteryConfigMismatch)
      }
    }
    recordGpsSessionSummary()
    session?.invalidate()
    session = nil
    config = nil
    // Release the connection owner with the session, or the first Presence Scan after a ride would
    // be denied forever by an owner that no longer exists.
    ConnectionOwnership.shared.release(.boardSession)
    recordingCoordinator.finishBoardSession(
      status: error == nil ? "stopped" : "disconnected",
      markerType: error == nil ? "disconnect" : "error"
    )
    gpsMonitor.stop()
    stopPolling()
    stopReconnect()
    configController.onSessionTerminated(error ?? "Board session ended", connection: fallbackConfigRWConnection())
    alertCoordinator.stopAllGeiger()
    transport.disconnect()
    replayTransport = nil
    // The shifted clock belongs to the replay that installed it; anything running between here and
    // the next session must not still be reading time from the past.
    sessionClock = SystemSessionClock.shared
    reassembler.reset()
    connectedBoardId = nil
    bleId = nil
    boardName = nil
    boardError = error
    lastTelemetryAt = nil
    latestLocation = nil
    latestPreciseLocation = nil
    courseDeriver.reset()
    recentLocations.removeAll(keepingCapacity: true)
    endLiveActivity()
    settleConnect(success: false, code: error == nil ? nil : "DISCONNECTED", message: error)
    setPhase(phase)
  }

  private func settleConnect(success: Bool, code: String?, message: String?) {
    guard !connectSettled else { return }
    connectSettled = true
    if success {
      pendingOnSuccess?()
    } else if let onError = pendingOnError {
      onError(code ?? "ERROR", message ?? "Board session ended")
    }
    pendingOnSuccess = nil
    pendingOnError = nil
  }

  private func armConnectTimeout() {
    let token = session
    DispatchQueue.main.asyncAfter(deadline: .now() + connectTimeoutSeconds) { [weak self] in
      guard let self, let token, token === self.session, token.isActive else { return }
      let stuckPhase = self.phase
      if stuckPhase == .connecting || stuckPhase == .discovering || stuckPhase == .subscribing {
        self.recordConnectionDiagnostic(
          "connect_phase_timeout",
          operation: "connect",
          message: "BLE connect phase timed out",
          extra: [
            "connect_phase": stuckPhase.rawValue,
            "timeout_ms": Int(self.connectTimeoutSeconds * 1000),
          ]
        )
        // The board never became ready — most often it is simply powered off. Rather than
        // surfacing "connection failed", hand off to the persistent reconnect loop so we keep
        // retrying until it appears. Mirrors Android, whose connect-phase timeout routes through
        // `failStart` → `scheduleAutoReconnect` (session `autoReconnect` is always on).
        self.beginReconnect()
      }
    }
  }

  /// Board-ready watchdog: armed when telemetry polling starts (entering `waitingForTelemetry`).
  /// If the board stays subscribed but never streams a telemetry frame, presume it silent and
  /// self-heal via `beginReconnect` instead of hanging on a spinner forever. Mirrors Android
  /// `armBoardReadyTimeout` (`BoardSessionController.kt`). Like `armConnectTimeout`, it needs no
  /// explicit cancel handle: the session-token guard is invalidated on endSession/fail/reconnect,
  /// and `markBoardReady` flips the phase off `waitingForTelemetry` so the fire guard falls through.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `armBoardReadyTimeout`
  private func armBoardReadyTimeout(session: BoardSession) {
    let token = session
    DispatchQueue.main.asyncAfter(deadline: .now() + boardReadyTimeoutSeconds) { [weak self] in
      guard let self, token === self.session, token.isActive else { return }
      guard self.phase == .waitingForTelemetry, self.lastTelemetryAt == nil else { return }
      self.recordConnectionDiagnostic(
        "board_ready_timeout",
        operation: "connect",
        message: "Board telemetry unavailable before ready timeout",
        extra: ["timeout_ms": Int(self.boardReadyTimeoutSeconds * 1000)]
      )
      self.beginReconnect()
    }
  }

  /// Stale-telemetry watchdog: re-armed on every telemetry frame while polling. If no frame lands
  /// within `telemetryStaleSeconds` the link is presumed dead-but-open (GATT still up, board silent)
  /// and, once `connected`, we self-heal through the same reconnect path as a link drop. Unlike the
  /// connect / board-ready watchdogs it keeps an explicit cancel handle because it re-arms per frame
  /// (cancel-and-rearm), matching the safety-poll timer.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `armStaleWatchdog`
  private func armStaleWatchdog(session: BoardSession) {
    staleWorkItem?.cancel()
    let token = session
    let armedAt = lastTelemetryAt
    let work = DispatchWorkItem { [weak self] in
      guard let self, token === self.session, token.isActive else { return }
      self.staleWorkItem = nil
      self.onTelemetryStaleFired(armedAt: armedAt)
    }
    staleWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + telemetryStaleSeconds, execute: work)
  }

  private func cancelStaleWatchdog() {
    staleWorkItem?.cancel()
    staleWorkItem = nil
  }

  /// Stale window elapsed. Re-checks under the same guard as Android `onTelemetryStaleFired`: only a
  /// live `connected` session whose telemetry is genuinely stale tears down; a frame that landed in
  /// the meantime (or a phase change) makes this a no-op. Routes through `beginReconnect` so backoff /
  /// rescan behavior stays aligned with a link drop. iOS has no `Stale` phase (see class @platform-diff).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onTelemetryStaleFired`
  private func onTelemetryStaleFired(armedAt: Int64?) {
    let now = nowMs()
    let staleMs = Int64(telemetryStaleSeconds * 1000)
    let stillStale = lastTelemetryAt == armedAt || (lastTelemetryAt.map { now - $0 >= staleMs } ?? true)
    guard phase == .connected, stillStale else { return }
    recordConnectionDiagnostic(
      "telemetry_stale",
      operation: "telemetry",
      message: "telemetry stale",
      extra: [
        "reason": "telemetry stale",
        "timeout_ms": Int(staleMs),
        "last_telemetry_timestamp": lastTelemetryAt,
      ]
    )
    beginReconnect()
  }

  private func setPhase(_ phase: BoardPhase) {
    guard self.phase != phase else { return }
    self.phase = phase
    // Reaching `connected` is the reconnect workflow's success terminal: telemetry flows again.
    if phase == .connected {
      finishReconnectWorkflow(
        decision: ConnectionTraceDecision.completed,
        reason: ConnectionTraceReason.matched
      )
    }
    recordingCoordinator.recordState(phase.rawValue)
    onStateChanged?()
    refreshLiveActivity()
  }

  private func fail(code: String, message: String) {
    // Same reasoning as `endSession`: no live session means nothing to resurrect.
    SessionResumeStore.shared.clear()
    clearPendingResume()
    recordConnectionDiagnostic(
      "ble_connect_failed",
      operation: "connect",
      message: message,
      extra: ["error_code": code]
    )
    settleConnect(success: false, code: code, message: message)
    boardError = message
    recordingCoordinator.recordState("error", extra: [("message", message)])
    socWindow.reset()
    session?.invalidate()
    session = nil
    config = nil
    // Same as `endSession`: a failed attempt must hand the connection back, or every later
    // Presence Scan is denied by a Board Session that no longer exists.
    ConnectionOwnership.shared.release(.boardSession)
    recordingCoordinator.failSession()
    gpsMonitor.stop()
    stopPolling()
    stopReconnect()
    configController.onSessionTerminated(message, connection: fallbackConfigRWConnection())
    alertCoordinator.stopAllGeiger()
    transport.disconnect()
    replayTransport = nil
    // The shifted clock belongs to the replay that installed it; anything running between here and
    // the next session must not still be reading time from the past.
    sessionClock = SystemSessionClock.shared
    endLiveActivity()
    emit?("onError", ["message": message])
    setPhase(.error)
  }

  // MARK: - Reconnect (#58)

  /// One correlated `reconnect` workflow per link loss (#414). The reconnect loop spans rescan
  /// cycles and phase churn, so all of them report under the same `workflow_id`.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `reconnectWorkflow`
  private var reconnectWorkflow: ConnectionWorkflow?

  /// Open (or reuse) the reconnect workflow. Reused across rescans: one link loss, one workflow.
  @discardableResult
  private func beginReconnectWorkflow() -> ConnectionWorkflow {
    if let reconnectWorkflow { return reconnectWorkflow }
    let workflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.reconnect,
      owner: ConnectionTraceOwner.boardSession,
      fields: [
        ConnectionTraceField.boardId: config?.appBoardId,
        ConnectionTraceField.bleId: config?.bleId,
      ]
    )
    reconnectWorkflow = workflow
    return workflow
  }

  /// Terminal branch of the reconnect workflow. Recovery and teardown both land here.
  private func finishReconnectWorkflow(decision: String, reason: String) {
    guard let workflow = reconnectWorkflow else { return }
    reconnectWorkflow = nil
    workflow.finish(decision: decision, reason: reason)
  }


  /// Recover a dropped mid-ride link. Bumps the Board Session identity so any poll/safety timers
  /// still armed under the dead link are discarded (stale-callback guard), hands the persistent
  /// reconnect to CoreBluetooth, and starts the supplemental rescan cycle. The JS `generation`
  /// (`connectionSeq`) is intentionally *not* bumped — the logical session survives the drop, so
  /// the live series keeps flowing once telemetry resumes (Android parity).
  private func beginReconnect() {
    guard config != nil else { return }
    // Replay links are not recoverable: watchdogs (board-ready, stale) stay no-ops and playback
    // simply resumes when recorded frames arrive. The recording's end is handled as a terminal
    // disconnect in `onGattDisconnected`, mirroring Android's `autoReconnect = false` replay config.
    guard transport.supportsReconnect else { return }
    // Settle a still-pending initial connect before dropping into the retry loop, mirroring Android
    // `failStart`, which calls `start.onError(...)` even as it schedules the reconnect: the JS
    // `connect()` promise resolves (its catch just re-syncs state) while native keeps retrying in
    // the background. A no-op once the session already settled (mid-ride drop / board-ready timeout).
    settleConnect(success: false, code: "RECONNECTING", message: "Board unavailable — retrying")
    // Chime only on the loss of a *live* link (telemetry was flowing), matching Android's
    // `Connected || Stale` gate — a drop while still waiting for telemetry stays silent.
    let wasConnected = phase == .connected
    recordConnectionDiagnostic(
      "ble_disconnected_unexpectedly",
      operation: "connect",
      message: "Board disconnected unexpectedly"
    )
    if wasConnected && connectionSoundsEnabled { alertAudioPlayer.playDisconnect() }
    // The session survives the drop, so the Live Activity is *not* ended — setPhase(.reconnecting)
    // below refreshes it to the reconnect state, mirroring Android mutating the persistent chip.
    session?.invalidate()
    stopPolling()
    reassembler.reset()
    socWindow.reset()
    // Drop prior-connection BMS rows before reconnecting, mirroring Android's reconnect-path
    // `bmsSeriesRing.clear()` next to `telemetryPipeline.clearLiveTelemetry()`.
    bmsSeriesRing.clear()

    sessionSequence += 1
    session = BoardSession(id: sessionSequence)
    beginReconnectWorkflow()
    reconnecting = true
    boardError = nil
    lastTelemetryAt = nil
    setPhase(.reconnecting)
    transport.reconnect()
    if let session { scheduleRescanCycle(session: session) }
  }

  /// One active-scan window followed by an idle gap, re-armed until the link returns or the
  /// session ends. Persistent connect keeps retrying throughout; the scan just accelerates
  /// rediscovery while the app is alive.
  private func scheduleRescanCycle(session: BoardSession) {
    guard reconnecting, session === self.session, session.isActive else { return }
    setPhase(.rescanning)
    let windowMs = rescanWindowMs
    // The reconnect rescan is a Presence Scan with `scan_purpose = reconnect`, reported in the
    // shared connection-trace vocabulary rather than a second reconnect-only event family (#414).
    reconnectWorkflow?.event(
      ConnectionTraceEvent.presenceScanStarted,
      fields: [
        ConnectionTraceField.scanPurpose: ScanPurpose.reconnect.wireValue,
        ConnectionTraceField.boardId: config?.appBoardId,
        ConnectionTraceField.bleId: config?.bleId,
        ConnectionTraceField.deadlineMs: windowMs,
      ]
    )
    transport.startReconnectScan()
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(windowMs) / 1000.0) { [weak self] in
      guard let self, self.reconnecting, session === self.session, session.isActive else { return }
      self.transport.stopReconnectScan()
      // The window closed with the link still down: a named timeout, not a silent re-arm.
      self.reconnectWorkflow?.event(
        ConnectionTraceEvent.presenceScanTimeout,
        fields: [
          ConnectionTraceField.scanPurpose: ScanPurpose.reconnect.wireValue,
          ConnectionTraceField.reason: ConnectionTraceReason.deadlineExpired,
          ConnectionTraceField.deadlineMs: windowMs,
        ]
      )
      if self.phase == .rescanning { self.setPhase(.reconnecting) }
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(self.rescanIdleMs) / 1000.0) { [weak self] in
        self?.scheduleRescanCycle(session: session)
      }
    }
  }

  private func stopReconnect() {
    finishReconnectWorkflow(
      decision: ConnectionTraceDecision.cancelled,
      reason: ConnectionTraceReason.mechanicalTeardown
    )
    guard reconnecting else { return }
    reconnecting = false
    transport.stopReconnectScan()
  }

  private var appIsForeground: Bool {
    UIApplication.shared.applicationState == .active
  }

  private var rescanWindowMs: Int {
    appIsForeground ? rescanForegroundWindowMs : rescanBackgroundWindowMs
  }

  private var rescanIdleMs: Int {
    appIsForeground ? rescanForegroundIdleMs : rescanBackgroundIdleMs
  }

  // MARK: - VescGattListener

  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String]) {
    presenceScanPort.deliverObserved(id: id, rssi: rssi)
    emit?("onDevice", [
      "id": id,
      "name": name,
      "rssi": rssi,
      "serviceUUIDs": serviceUUIDs,
    ])
  }

  /// CoreBluetooth replayed the session central's preserved state into this launch (ADR 0034).
  /// Rebuild the Board Session natively — no JS is running, and none is needed.
  func onGattRestored(peripheralIds: [String]) {
    guard session == nil else { return }
    guard let marker = pendingResume ?? SessionResumeStore.shared.pending else { return }
    pendingResume = marker
    resumeSession(marker: marker, restoredPeripheralIds: peripheralIds)
  }

  /// The central reached `.poweredOn`: the Presence Scan window starts here.
  func onScanReady() {
    presenceScanPort.deliverReady()
  }

  func onScanFailure(_ message: String) {
    presenceScanPort.deliverFailure(message)
    scanPhase = "error"
    scanError = message
    emit?("onError", ["message": message])
    onStateChanged?()
  }

  func onGattConnected() {
    guard session != nil else { return }
    // Link re-established: the persistent connect landed, so drop the supplemental rescan and let
    // the normal discover → subscribe → telemetry phases carry the reconnect to `connected`.
    if reconnecting {
      reconnecting = false
      transport.stopReconnectScan()
      reconnectWorkflow?.event(
        ConnectionTraceEvent.presenceScanMatched,
        fields: [
          ConnectionTraceField.scanPurpose: ScanPurpose.reconnect.wireValue,
          ConnectionTraceField.boardId: config?.appBoardId,
          ConnectionTraceField.bleId: config?.bleId,
        ]
      )
    }
    recordConnectionDiagnostic("gatt_connected", operation: "connect", message: "GATT connected")
    setPhase(.discovering)
  }

  func onGattSubscribing() {
    guard session != nil else { return }
    setPhase(.subscribing)
  }

  func onGattReady() {
    guard let session else { return }
    boardError = nil
    recordConnectionDiagnostic("gatt_ready", operation: "connect", message: "GATT ready")
    setPhase(.waitingForTelemetry)
    settleConnect(success: true, code: nil, message: nil)
    startPolling(session: session)
  }

  func onGattFailure(code: String, message: String) {
    guard session != nil else { return }
    fail(code: code, message: message)
  }

  func onGattDisconnected(intentional: Bool, message: String) {
    if intentional { return }
    guard session != nil else { return }
    // A replay link cannot come back: the recording ran out. Reaching the end of a recording is
    // not a failure — tear the session down cleanly to idle (same as a user Stop) so no
    // "Connection failed" pill shows and the REPLAY badge/name clear, instead of stranding the UI
    // in the error phase with a stale session (Android parity: replay-end idle teardown).
    guard transport.supportsReconnect else {
      endSession(phase: .idle, error: nil)
      return
    }
    // Any unexpected drop — during the initial handshake or mid-ride — recovers via the persistent
    // reconnect loop. Mirrors Android's always-on session `autoReconnect`: a drop while connecting
    // schedules a reconnect (`wasConnecting.autoReconnect → scheduleAutoReconnect`) instead of
    // surfacing "connection failed", so a board that is off at launch keeps being retried.
    beginReconnect()
  }

  func onGattFrameChunk(_ chunk: [UInt8]) {
    guard session != nil else { return }
    recordingCoordinator.recordChunk(direction: "rx", bytes: chunk)
    for payload in reassembler.feed(chunk) {
      handlePayload(payload)
    }
  }

  // MARK: - Telemetry

  private func handlePayload(_ payload: [UInt8]) {
    guard let session, session.isActive else { return }
    _ = handleLinkIntegrityRefloat(payload)
    if let config, configController.onPayload(payload, connection: configConnection(config)) {
      return
    }
    guard !payload.isEmpty else { return }
    switch Int(payload[0]) {
    case COMM_CUSTOM_APP_DATA:
      handleTelemetry(payload, session: session)
    case COMM_FW_VERSION:
      handleFwVersion(payload)
    case COMM_BMS_GET_VALUES:
      // Direct smart-BMS reply.
      handleBms(payload)
    case COMM_FORWARD_CAN where payload.count >= 3 && Int(payload[2]) == COMM_BMS_GET_VALUES:
      // CAN-forwarded smart-BMS reply (telemetry stays bare, but BMS comes wrapped).
      handleBms(Array(payload[2...]))
    case COMM_FORWARD_CAN where payload.count >= 3 && Int(payload[2]) == COMM_FW_VERSION:
      handleFwVersion(Array(payload[2...]))
    default:
      break
    }
  }

  private func handleTelemetry(_ payload: [UInt8], session: BoardSession) {
    let now = nowMs()
    guard let telemetry = parseRefloatGetAllData(
      payload: payload,
      avgLatency: latency(at: now),
      packetAt: now,
      pullRateHz: measuredRateHz()
    ) else { return }

    onPollResponse(session: session)
    lastTelemetryAt = now
    armStaleWatchdog(session: session)
    markBoardReady()
    startLinkIntegrityProbe(session: session)
    emitTelemetry(telemetry)
  }

  /// Decode a smart-BMS reply and emit `onBms`. Routes through the same `emit` sink (and thus the
  /// same foreground gate) as `onLiveTick`. Mirrors Android `BoardSessionController.handleBmsPayload`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `handleBmsPayload`
  private func handleBms(_ payload: [UInt8]) {
    guard let bms = parseBmsValues(payload, packetAt: nowMs()) else { return }
    if let session, let config {
      updateLinkIntegrity(session.observeBms(expected: config.linkIdentity()))
    }
    emit?("onBms", bms.toMap())
    evaluateCellSpread(bms)
    evaluateBatteryConfigMismatch(bms)
    // Retention is unconditional (the frame already arrived); only the push below is gated.
    let frame = bmsSeriesRing.append(
      capturedAtMs: bms.capturedAt,
      cellVoltages: bms.cellVoltages,
      balancing: bms.balancing,
      windowMs: bmsSeriesWindowMs()
    )
    if let frame, bmsSeriesFocused {
      emitBmsSeries(mode: "append", frames: [frame])
    }
  }

  /// Feed one smart-BMS frame to the cell-spread detector and report any finding through the Board
  /// Warning registry (telemetry-scoped detector; continuous evaluation during the Board Session).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateCellSpread`
  private func evaluateCellSpread(_ bms: BmsTelemetry) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    guard let finding = cellSpreadDetector.onFrame(
      cellVoltages: bms.cellVoltages,
      balancing: bms.balancing,
      vCharge: bms.vCharge,
      atMs: bms.capturedAt
    ) else { return }
    BoardWarningRegistry.shared.reportFinding(
      boardId: boardId,
      kind: BoardWarningKind.cellSpread,
      severity: finding.severity,
      payloadJson: finding.payloadJson
    )
  }

  /// Feed one smart-BMS frame's cell count to the battery-config-mismatch detector and report any
  /// finding through the Board Warning registry. Compares against the same configured series count
  /// the SoC estimator and per-cell pushback bounds read; absent config is not evaluated.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateBatteryConfigMismatch`
  private func evaluateBatteryConfigMismatch(_ bms: BmsTelemetry) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    let seriesCount = config?.batteryConfig?["seriesCount"] as? Int
    guard let payloadJson = batteryConfigMismatchDetector.onFrame(
      bmsCellCount: bms.cellVoltages.count,
      configuredSeries: seriesCount
    ) else { return }
    BoardWarningRegistry.shared.reportFinding(
      boardId: boardId,
      kind: BoardWarningKind.batteryConfigMismatch,
      severity: .warn,
      payloadJson: payloadJson
    )
  }

  /// Evaluate the config-safety rules against a freshly decoded config (background read after link
  /// trust, or the in-hand bytes from a tune write) and report findings / clean evaluations through
  /// the Board Warning registry. Per-cell rules use the configured battery series count and are
  /// skipped when it is absent; skipped kinds report nothing so stored warnings stay untouched.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateConfigSafety`
  private func evaluateConfigSafety(_ values: ConfigSafetyValues) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    let seriesCount = config?.batteryConfig?["seriesCount"] as? Int
    let perCell = ConfigSafetyDetector.usesPerCellVoltage(vescLiveFirmware)
    let report = ConfigSafetyDetector.evaluate(values, seriesCount: seriesCount, perCell: perCell)
    for finding in report.findings {
      BoardWarningRegistry.shared.reportFinding(
        boardId: boardId,
        kind: finding.kind,
        severity: finding.severity,
        payloadJson: finding.payloadJson
      )
    }
    for kind in report.cleanKinds {
      BoardWarningRegistry.shared.reportCleanEvaluation(boardId: boardId, kind: kind)
    }
  }

  /// Manual clear from JS: reset the matching telemetry detector's dedupe so a still-true condition
  /// re-fires within this Board Session (`kind == nil` means all kinds). Runs on main, where the
  /// detectors live.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onWarningManuallyCleared`
  private func onWarningManuallyCleared(boardId: String, kind: String?) {
    guard config?.appBoardId == boardId else { return }
    if kind == nil || kind == BoardWarningKind.cellSpread.rawValue { cellSpreadDetector.reset() }
    if kind == nil || kind == BoardWarningKind.batteryConfigMismatch.rawValue {
      batteryConfigMismatchDetector.reset()
    }
  }

  /// Once per Board Session, after the link is trusted, kick off one background Refloat config read so
  /// the config-safety detectors can evaluate the decoded config. Read-only; reuses the normal config
  /// read path (pauses/resumes polling) and is skipped if a config op is already in flight.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `triggerConfigSafetyRead`
  private func triggerConfigSafetyRead(_ session: BoardSession) {
    guard boardWarningsEnabled else {
      // Re-arm so re-enabling Board Warnings mid-session can schedule the read again.
      configSafetyReadScheduled = false
      return
    }
    guard session === self.session, session.isActive, let config else { return }
    configController.consumeRead(connection: configConnection(config), onSuccess: { _ in }, onError: { _, _ in })
  }

  /// Battery-detail focus/blur intent from JS. Focus flips the gate open and immediately pushes
  /// the whole windowed Live BMS Series as one columnar buffer; while focused each new BMS frame
  /// follows as a single-row `append`. Blur just closes the gate — retention keeps running.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setBmsSeriesFocused`
  func setBmsSeriesFocused(_ focused: Bool) {
    bmsSeriesFocused = focused
    guard focused else { return }
    emitBmsSeries(
      mode: "snapshot",
      frames: bmsSeriesRing.snapshot(windowMs: bmsSeriesWindowMs(), nowMs: nowMs())
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setFocusedSeriesMetrics`
  func setFocusedSeriesMetrics(_ metrics: [String]) {
    liveSeries.setFocusedMetrics(metrics)
  }

  private func bmsSeriesWindowMs() -> Int64 {
    Int64(max(1, config?.liveHistoryLimitMinutes ?? 5)) * 60_000
  }

  private func emitBmsSeries(mode: String, frames: [BmsSeriesFrame]) {
    let cellCount = bmsSeriesRing.cellCount()
    emit?(
      "onBmsSeries",
      [
        "mode": mode,
        "generation": connectionSeq,
        "windowMs": bmsSeriesWindowMs(),
        "cellCount": cellCount,
        "count": frames.count,
        "columns": encodeBmsSeriesColumns(frames, cellCount: cellCount),
      ]
    )
  }

  private func handleFwVersion(_ payload: [UInt8]) {
    guard let firmware = parseFwVersion(payload: payload), let session, let config else { return }
    vescLiveFirmware = firmware
    updateLinkIntegrity(session.observeFirmware(expected: config.linkIdentity(), firmware: firmware))
  }

  @discardableResult
  private func handleLinkIntegrityRefloat(_ payload: [UInt8]) -> Bool {
    guard let session, let config else { return false }
    let version: String
    switch RefloatConfigProtocol.parseGetInfoResponse(payload) {
    case .success(let info): version = info.version
    case .failure: return false
    }
    updateLinkIntegrity(session.observeRefloat(expected: config.linkIdentity(), refloatVersion: version))
    return true
  }

  private func startLinkIntegrityProbe(session: BoardSession) {
    guard session === self.session, session.isActive, session.linkIntegrity == .checking, let config else { return }
    guard session.claimLinkIntegrityProbe() else { return }
    _ = transport.sendPayload(config.transport.frame([UInt8(COMM_FW_VERSION)]))
    _ = transport.sendPayload(RefloatConfigProtocol.buildGetInfo(transport: config.transport))
    if config.hasBms == true {
      DispatchQueue.main.asyncAfter(deadline: .now() + linkIntegrityBmsTimeoutSeconds) { [weak self, weak session] in
        guard let self, let session, session === self.session, session.isActive, let config = self.config else { return }
        self.updateLinkIntegrity(session.markBmsMissing(expected: config.linkIdentity()))
      }
    }
  }

  private var lastEmittedLinkIntegrity: LinkIntegrity = .unknown
  private var configSafetyReadScheduled = false
  /// Live-parsed firmware string ("FW 6.05 · …"), used to resolve per-cell vs pack pushback units.
  /// Mirrors Android `fwVersionString`.
  private var vescLiveFirmware: String?

  private func updateLinkIntegrity(_ next: LinkIntegrity) {
    guard next != lastEmittedLinkIntegrity else { return }
    lastEmittedLinkIntegrity = next
    onStateChanged?()
    // Link just became trusted — schedule the one background config-safety read for this session.
    if next == .trusted { scheduleConfigSafetyRead() }
  }

  private func scheduleConfigSafetyRead() {
    guard !configSafetyReadScheduled, let session else { return }
    configSafetyReadScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + configSafetyReadDelaySeconds) { [weak self, weak session] in
      guard let self, let session else { return }
      self.triggerConfigSafetyRead(session)
    }
  }

  private func markBoardReady() {
    guard phase == .waitingForTelemetry else { return }
    boardError = nil
    recordConnectionDiagnostic("board_ready", operation: "connect", message: "Board telemetry received")
    if let config {
      recordingCoordinator.markBoardReady(config: config)
      // Auto-recording may have just started the recording; the resume marker must agree.
      syncResumeMarkerRecording()
    }
    if connectionSoundsEnabled { alertAudioPlayer.playConnect() }
    // The explicit Connect got what it asked for; the Board Session owns the connection from here.
    clearConnectIntent(.connected)
    // The Live Activity flips to "connected" via setPhase → refreshLiveActivity below.
    setPhase(.connected)
  }

  private func emitTelemetry(_ telemetry: RefloatTelemetry) {
    // Hot path: a scalar tick every frame drives the live gauges.
    var tick = telemetry.toMap()
    let batteryPercent = batteryEstimator.estimateBatteryPercent(
      voltageV: telemetry.batteryVoltage,
      config: config?.batteryConfig,
      batteryCurrentA: telemetry.batteryCurrent
    )
    // Smooth the IR-compensated % into the Battery SoC Estimate; display + alerts share it.
    let batteryEstimate = batteryPercent.map { socWindow.median(percent: $0, nowMs: telemetry.lastPacketAt) }
    tick["batteryPercent"] = batteryEstimate
    latestBatterySoc = batteryEstimate
    latestBatteryVoltage = telemetry.batteryVoltage
    persistLastBattery(percent: batteryEstimate, voltage: telemetry.batteryVoltage, now: telemetry.lastPacketAt)
    tick["generation"] = connectionSeq
    tick["remoteTilt"] = nil
    if let latestPreciseLocation {
      tick["location"] = latestPreciseLocation.map
    }

    // Alert evaluation against live telemetry. Mirrors Android's per-frame evaluateAlerts path:
    // fired alerts drive geiger loops + single/TTS playback and are attached to the event payload.
    let firedAlerts = alertCoordinator.evaluate(
      telemetry: telemetry,
      batteryPercent: batteryEstimate,
      onDiagnostic: { [weak self] name, props in self?.recordAlertDiagnostic(name, props) }
    )
    if !firedAlerts.isEmpty {
      tick["firedAlerts"] = firedAlerts
    }
    updateLiveBattery(percent: batteryEstimate, voltage: telemetry.batteryVoltage, now: telemetry.lastPacketAt)
    updateLiveFault(telemetry)
    emit?("onLiveTick", tick)

    if let capture = telemetryCapture(telemetry) {
      updateIdlePause(capture)
      // Skip persistence while idle-paused; the live tick, series, and Live Activity above keep
      // running off the ~1 Hz keepalive. When recording is off, recordTelemetry is already a no-op.
      if !idlePauseDetector.isPaused {
        recordingCoordinator.recordTelemetry(capture)
      }
    }

    // Decimated ~1Hz series for sparklines + battery gauge (native downsamples the live window).
    liveSeries.add(tick)

    // Cold path: full samples batched a few times a second for history + charts. Fired alerts ride
    // the buffered sample so `onTelemetryHistory` carries them too.
    historyBuffer.append(tick)
    // Gated on session time, not wall time, so this needs no speed divisor of its own: a warming
    // replay advances `lastPacketAt` fast, which fires the flush proportionally more often in real
    // terms and keeps each batch the size it would be live.
    // @platform-diff Android drives the same flush from a scheduler timer, so it scales explicitly.
    let now = telemetry.lastPacketAt
    if lastHistoryFlushAt == 0 || now - lastHistoryFlushAt >= historyFlushIntervalMs {
      flushHistory()
    }
  }

  /// Persist the last Battery SoC Estimate per board so it survives full app kill (#152). Throttled
  /// to 30s; `force` skips the gate on session end so the stored value is fresh, not up to 30s stale.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `persistLastBattery`
  private func persistLastBattery(percent: Double?, voltage: Double?, now: Int64, force: Bool = false) {
    guard let percent else { return }
    guard let boardId = config?.appBoardId else { return }
    if !force && now - lastBatteryPersistedAt < 30_000 { return }
    lastBatteryPersistedAt = now
    appData.updateLastBattery(boardId: boardId, percent: percent, voltage: voltage, atMs: now)
  }

  private func recordAlertDiagnostic(_ name: String, _ props: [String: Any?]) {
    DiagnosticsRecorder.shared.record(eventName: name, properties: props)
  }

  /// Whether connect/disconnect chimes are enabled. Read live from settings — connect/disconnect
  /// are rare, so the read is always current without any settings-apply plumbing. Defaults to
  /// `true` to match the JS + Android default when the key is unset.
  private var connectionSoundsEnabled: Bool {
    (appData.getSettings()["connectionSoundsEnabled"] as? Bool) ?? true
  }

  /// Persist a connection-lifecycle Local Diagnostic Event with the base session context (device,
  /// phase, connection seq) so the iOS event log carries the same columns Android does. The store
  /// keys `ble_id`/`board_nickname` into the `device_id`/`device_name` columns JS reads.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/DiagnosticsRecorder.kt `recordLocalDiagnostic`
  private func recordConnectionDiagnostic(
    _ eventName: String,
    operation: String,
    message: String,
    extra: [String: Any?] = [:]
  ) {
    var props: [String: Any?] = [
      "board_id": connectedBoardId ?? config?.appBoardId,
      "ble_id": bleId ?? config?.bleId,
      "board_nickname": boardName ?? config?.name,
      "operation": operation,
      "phase": phase.rawValue,
      "connection_seq": connectionSeq,
      "message": message,
    ]
    for (key, value) in extra { props[key] = value }
    DiagnosticsRecorder.shared.record(eventName: eventName, properties: props)
  }

  // MARK: - Live Activity (Board Session status surface)

  /// Current session snapshot as Live Activity content. Single source for start + update.
  private func currentLiveState() -> RideActivityAttributes.ContentState {
    RideActivityContent.state(
      deviceName: boardName ?? config?.name,
      phase: phase,
      batteryPercent: liveBatteryPercent,
      batteryVoltage: liveBatteryVoltage,
      faultCode: liveFaultCode
    )
  }

  private func refreshLiveActivity() {
    liveActivity.update(currentLiveState())
  }

  /// Reap Live Activities left behind by a process that died mid-ride (ADR 0034). Called at app
  /// launch: an activity is an orphan only when nothing in this process wants it.
  func reapOrphanLiveActivities() {
    guard !liveActivityIsClaimed else { return }
    liveActivity.reapOrphans()
  }

  /// Whether a running or resuming session owns the on-screen activity. The pending-resume arm
  /// covers the window between a restoration launch and the rebuilt session adopting the activity:
  /// reaping there would destroy the very surface the resume is about to reuse, and the background
  /// launch could not mint a replacement (#378).
  private var liveActivityIsClaimed: Bool {
    session?.isActive == true || pendingResume != nil
  }

  /// End the activity for a stop that no session accepted — the widget's Stop on a ghost. Ending is
  /// background-safe and needs no session, which is what makes a ghost killable at all.
  func endOrphanLiveActivity() {
    guard !liveActivityIsClaimed else { return }
    liveActivity.end()
  }

  private func endLiveActivity() {
    liveActivity.end()
    liveBatteryPercent = nil
    liveBatteryVoltage = nil
    liveFaultCode = nil
    lastLiveTelemetryRefreshAt = 0
  }

  /// Update the Live Activity battery segment (`"45% (75.1V)"`). A stepped integer percent refreshes
  /// immediately (rare, meaningful); voltage-only changes are rate-limited to `liveTelemetryRefreshMinMs`
  /// so per-frame voltage jitter does not exhaust the ActivityKit update budget.
  /// @platform-diff Android refreshes its notification every telemetry frame; iOS throttles voltage.
  private func updateLiveBattery(percent: Double?, voltage: Double?, now: Int64) {
    let steppedPercent = percent.map { Int($0.rounded()) }
    let steppedVoltage = voltage.map { ($0 * 10).rounded() / 10 }
    let percentChanged = steppedPercent != liveBatteryPercent
    let voltageChanged = steppedVoltage != liveBatteryVoltage
    guard percentChanged || voltageChanged else { return }
    liveBatteryPercent = steppedPercent
    liveBatteryVoltage = steppedVoltage
    if percentChanged || now - lastLiveTelemetryRefreshAt >= liveTelemetryRefreshMinMs {
      lastLiveTelemetryRefreshAt = now
      refreshLiveActivity()
    }
  }

  /// Reflect fault state in the Live Activity on the rising/falling edge of a sustained fault.
  /// Mirrors Android surfacing faults through the persistent notification (edge-triggered, one
  /// update per state change rather than one per frame).
  private func updateLiveFault(_ telemetry: RefloatTelemetry) {
    if telemetry.hasFault {
      guard liveFaultCode != telemetry.faultCode else { return }
      liveFaultCode = telemetry.faultCode
      presentCriticalFaultNotificationIfAllowed(faultCode: telemetry.faultCode)
    } else {
      guard liveFaultCode != nil else { return }
      liveFaultCode = nil
      criticalNotificationFaultCode = nil
    }
    refreshLiveActivity()
  }

  private func presentCriticalFaultNotificationIfAllowed(faultCode: Int) {
    guard !appIsForeground else {
      criticalNotificationFaultCode = faultCode
      return
    }
    guard criticalNotificationFaultCode != faultCode else { return }
    criticalNotificationFaultCode = faultCode

    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { [weak self] settings in
      guard Self.allowsCriticalNotificationDelivery(settings.authorizationStatus) else { return }
      let displayName = self?.criticalNotificationBoardName() ?? "VESC"
      let notification = UNMutableNotificationContent()
      notification.title = "Ride fault detected"
      notification.body = faultCode > 0
        ? "\(displayName) reported fault code \(faultCode)."
        : "\(displayName) reported a fault."
      notification.sound = .default
      notification.interruptionLevel = .timeSensitive
      center.add(UNNotificationRequest(
        identifier: "vescape.criticalRideFault.\(self?.connectionSeq ?? 0).\(faultCode)",
        content: notification,
        trigger: nil
      ))
    }
  }

  private func criticalNotificationBoardName() -> String {
    let rawName = boardName ?? config?.name
    let trimmed = rawName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? "VESC" : trimmed
  }

  private static func allowsCriticalNotificationDelivery(_ status: UNAuthorizationStatus) -> Bool {
    switch status {
    case .authorized, .provisional, .ephemeral:
      return true
    case .notDetermined, .denied:
      return false
    @unknown default:
      return false
    }
  }

  private func flushHistory() {
    guard !historyBuffer.isEmpty else { return }
    emit?("onTelemetryHistory", ["samples": historyBuffer])
    historyBuffer.removeAll(keepingCapacity: true)
    lastHistoryFlushAt = nowMs()
  }

  private func telemetryCapture(_ telemetry: RefloatTelemetry) -> TelemetryCapture? {
    guard let config else { return nil }
    let canId: Int?
    if case let .can(id) = config.transport {
      canId = id
    } else {
      canId = nil
    }
    return TelemetryCapture(
      capturedAtMs: telemetry.lastPacketAt,
      elapsedRealtimeMs: elapsedMs(),
      deviceId: config.bleId,
      deviceName: config.name,
      canId: canId,
      telemetry: telemetry,
      // Recorded frames refuse a stale fix (ADR 0034); live display keeps the last known one.
      location: telemetryLocationFreshEnoughToRecord(
        latestPreciseLocation,
        capturedAtMs: telemetry.lastPacketAt
      )
    )
  }

  /// Feed a recorded fix into the same path a live one takes, so everything downstream — map,
  /// trail, ride stats, Group Ride presence — sees the ride exactly as it happened.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onReplayLocation`
  private func onReplayLocation(_ fix: ReplayLocation) {
    onLocationUpdated(
      TelemetryLocationCapture(
        latitude: fix.latitude,
        longitude: fix.longitude,
        speedMps: fix.speedMps,
        bearingDeg: fix.bearingDeg,
        accuracyM: fix.accuracyM,
        altitudeM: fix.altitudeM,
        timestamp: nowMs(),
        precise: isPreciseGpsFix(accuracyM: fix.accuracyM)
      )
    )
  }

  /// Hand a recorded compass reading back to JS, which owns the magnetometer and therefore has to be
  /// the one to feed it into the map. Emitted rather than applied natively for the same reason it was
  /// recorded from JS: the sensor lives there.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onReplayHeading`
  private func onReplayHeading(_ heading: ReplayHeading) {
    emit?("onReplayPhoneHeading", ["headingDeg": heading.headingDeg])
  }

  /// Offer a compass reading to whatever Debug Recording is running; dropped when nothing is
  /// recording. JS pushes these unconditionally while the map's heading layer is live, and native is
  /// the one that knows whether a recorder exists.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `recordPhoneHeading`
  func recordPhoneHeading(_ headingDeg: Double) {
    recordingCoordinator.currentRecorder()?.recordPhoneHeading(headingDeg)
  }

  private func onLocationUpdated(_ incoming: TelemetryLocationCapture) {
    var location = incoming
    recordGpsFix(location)
    // Approximate fixes never feed the course: they are metres of noise apart and would spin a
    // derived bearing, and they are not what the map's GPS heading mode follows either.
    if location.precise {
      let course = courseDeriver.derive(
        latitude: location.latitude,
        longitude: location.longitude,
        speedMps: location.speedMps,
        bearingDeg: location.bearingDeg,
        timestamp: location.timestamp
      )
      location.courseDeg = course?.bearingDeg
      location.courseSourceTimestamp = course?.sourceTimestamp
    }
    recordingCoordinator.recordLocation(location)
    latestLocation = location
    // Every fix moves Route Progress, approximate ones included: the same rule as `riderPosition`,
    // where freshness beats accuracy. The bearing comes off the path rather than off the fix, so a
    // noisy position cannot spin it.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `onLocationUpdated`
    NavigationController.shared.onFix(
      latitude: location.latitude,
      longitude: location.longitude,
      speedMps: location.speedMps
    )
    if location.precise {
      latestPreciseLocation = location
      recentLocations.append(location.map)
      pruneRecentLocations(now: location.timestamp)
    }
    // Offered on every Fix; the coordinator owns the freshness and distance gates.
    WeatherCoordinator.shared.onPosition(latitude: location.latitude, longitude: location.longitude)
    emit?("onLocation", location.map)
  }

  private func pruneRecentLocations(now: Int64) {
    let windowMs = Int64(max(1, config?.liveHistoryLimitMinutes ?? 5)) * 60_000
    let oldest = now - windowMs
    recentLocations.removeAll { row in
      guard let timestamp = (row["timestamp"] ?? nil) as? NSNumber else { return false }
      return timestamp.int64Value < oldest
    }
  }

  /// One low-volume Local Diagnostic Event per Board Session. No coordinates leave the GPS path.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `recordGpsSessionSummary`
  private func beginGpsSessionDiagnostics() {
    gpsSessionStartedAt = nowMs()
    gpsFixCount = 0
    gpsPreciseFixCount = 0
    gpsFirstFixAt = nil
    gpsFirstPreciseFixAt = nil
    gpsLastFixAt = nil
  }

  private func recordGpsFix(_ location: TelemetryLocationCapture) {
    guard gpsSessionStartedAt != nil else { return }
    gpsFixCount += 1
    gpsFirstFixAt = gpsFirstFixAt ?? nowMs()
    gpsLastFixAt = nowMs()
    if location.precise {
      gpsPreciseFixCount += 1
      gpsFirstPreciseFixAt = gpsFirstPreciseFixAt ?? nowMs()
    }
  }

  private func recordGpsSessionSummary() {
    guard let startedAt = gpsSessionStartedAt else { return }
    let endedAt = nowMs()
    recordConnectionDiagnostic(
      "gps_session_summary",
      operation: "gps",
      message: "GPS Board Session summary",
      extra: [
        "recording_enabled": recordingCoordinator.telemetryRecordingEnabled,
        "updates_started": gpsMonitor.updatesStarted,
        "fix_count": gpsFixCount,
        "precise_fix_count": gpsPreciseFixCount,
        "first_fix_delay_ms": gpsFirstFixAt.map { $0 - startedAt },
        "first_precise_fix_delay_ms": gpsFirstPreciseFixAt.map { $0 - startedAt },
        "last_fix_age_ms": gpsLastFixAt.map { endedAt - $0 },
        "duration_ms": endedAt - startedAt,
        "authorization": gpsMonitor.authorization,
        "accuracy_authorization": gpsMonitor.accuracyAuthorization,
        "last_error": gpsError,
      ]
    )
    gpsSessionStartedAt = nil
  }

  // MARK: - Polling (response-paced; ADR 0015 dumb connect)

  /// The session's transport is read from the Board Link it was started with and never mutated
  /// mid-session — detection belongs to the Board Probe alone, so a reconnect reuses the same
  /// transport rather than re-deriving one.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `currentBoardTransport`
  private func startPolling(session: BoardSession) {
    stopScheduledPolls()
    idlePauseDetector.reset()
    floorMs = effectivePollIntervalMs()
    lastPollAt = 0
    smoothedPeriodMs = 0
    pollTick = 0
    lastHistoryFlushAt = 0
    historyBuffer.removeAll(keepingCapacity: true)
    polling = true
    // Arm the board-ready watchdog only once polling begins in `waitingForTelemetry`; a stale
    // stored transport still reaches here and times out into reconnect (Android parity).
    if phase == .waitingForTelemetry {
      armBoardReadyTimeout(session: session)
    }
    // Arm the stale-telemetry watchdog alongside polling; it re-arms on every frame and only trips
    // (into reconnect) once `connected`, so arming here while still waiting is a harmless no-op
    // guarded by phase. Mirrors Android `startPolling` → `telemetryPipeline.armStaleWatchdog()`.
    armStaleWatchdog(session: session)
    let transport = config?.transport ?? .direct
    let pollingMode: String
    switch transport {
    case .can: pollingMode = "can"
    case .direct: pollingMode = "direct"
    }
    recordConnectionDiagnostic(
      "telemetry_polling_started",
      operation: "telemetry",
      message: "Telemetry polling started",
      extra: ["polling_mode": pollingMode, "poll_interval_ms": config?.pollIntervalMs]
    )
    liveSeries.start()
    sendPoll(session: session)
  }

  private func stopPolling() {
    polling = false
    stopScheduledPolls()
    cancelStaleWatchdog()
    idlePauseDetector.reset()
    liveSeries.stop()
    flushHistory()
  }

  /// Poll spacing honoring an active Idle Pause: never faster than the configured rate.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `effectivePollIntervalMs`
  private func effectivePollIntervalMs() -> Int {
    let configured = max(0, config?.pollIntervalMs ?? 0)
    return idlePauseDetector.isPaused ? max(IDLE_PAUSE_POLL_INTERVAL_MS, configured) : configured
  }

  /// Feeds each sample's speed to the Idle Pause detector and applies its transitions: writes the
  /// `auto_pause` marker on pause, retunes the poll floor, and republishes live state (ADR-0021).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `updateIdlePause`
  private func updateIdlePause(_ capture: TelemetryCapture) {
    guard recordingCoordinator.telemetryRecordingEnabled else {
      // Recording turned off mid-pause: drop the pause and restore the configured poll rate.
      if idlePauseDetector.isPaused {
        resetIdlePause()
        onStateChanged?()
      }
      return
    }
    let transition = idlePauseDetector.onSample(
      speedCentiKmh: Int((capture.telemetry.speed * 100.0).rounded()),
      movingThresholdCentiKmh: movingThresholdCentiKmh,
      atMs: capture.capturedAtMs
    )
    guard let transition else { return }
    if transition == .paused, let config {
      recordingCoordinator.recordIdlePauseMarker(config: config)
    }
    floorMs = effectivePollIntervalMs()
    onStateChanged?()
  }

  private func resetIdlePause() {
    idlePauseDetector.reset()
    floorMs = effectivePollIntervalMs()
  }

  private func restartPollingForConfigRead() {
    guard let session, session.isActive else { return }
    startPolling(session: session)
  }

  private func configConnection(_ config: BoardConnectConfig) -> ConfigRWConnection {
    ConfigRWConnection(
      phase: phase,
      appBoardId: config.appBoardId,
      transport: config.transport,
      fwVersion: nil,
      refloatBaseVersion: config.refloatBaseVersion,
      linkIntegrity: linkIntegrity,
      isPollingActive: { [weak self] in self?.polling ?? false },
      stopPolling: { [weak self] in self?.stopPolling() },
      startPolling: { [weak self] in self?.restartPollingForConfigRead() },
      sendPayload: { [weak self] payload in self?.transport.sendPayload(payload) ?? false },
      captureDiagnostic: { [weak self] name, properties in
        self?.recordConnectionDiagnostic(name, operation: "config_rw", message: properties["message"] as? String ?? name, extra: properties)
      },
      loadProfile: { profileId in TuneProfileStore.shared.getTuneProfile(profileId) },
      evaluateConfigSafety: { [weak self] values in self?.evaluateConfigSafety(values) }
    )
  }

  private func fallbackConfigRWConnection() -> ConfigRWConnection {
    ConfigRWConnection(
      phase: phase,
      appBoardId: config?.appBoardId,
      transport: config?.transport ?? .direct,
      fwVersion: nil,
      refloatBaseVersion: config?.refloatBaseVersion,
      linkIntegrity: linkIntegrity,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { _ in false },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in nil },
      evaluateConfigSafety: { _ in }
    )
  }

  private func pollPayload() -> [UInt8] {
    let transport = config?.transport ?? .direct
    return transport.frame([
      UInt8(COMM_CUSTOM_APP_DATA),
      UInt8(REFLOAT_MAGIC),
      UInt8(REFLOAT_GET_ALLDATA),
      2,
    ])
  }

  private func bmsPayload() -> [UInt8] {
    let transport = config?.transport ?? .direct
    return transport.frame([UInt8(COMM_BMS_GET_VALUES)])
  }

  private func sendPoll(session: BoardSession) {
    guard polling, session === self.session, session.isActive else { return }
    pollWorkItem = nil
    let now = nowMs()
    if lastPollAt > 0 {
      let delta = Double(now - lastPollAt)
      smoothedPeriodMs = smoothedPeriodMs <= 0 ? delta : smoothedPeriodMs + 0.2 * (delta - smoothedPeriodMs)
    }
    lastPollAt = now
    _ = transport.sendPayload(pollPayload())
    // Interleave a BMS request every `bmsPollStride` ticks, only when the probe proved one present.
    // Checked before the tick advances, matching Android.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PollingLoop.kt (sendNow BMS interleave)
    if config?.hasBms == true, pollTick % bmsPollStride == 0 {
      _ = transport.sendPayload(bmsPayload())
    }
    pollTick += 1
    armSafety(session: session, tick: pollTick)
  }

  private func onPollResponse(session: BoardSession) {
    guard polling, session === self.session, session.isActive else { return }
    cancelSafetyPoll()
    let elapsed = nowMs() - lastPollAt
    let delayMs = max(0, Int64(floorMs) - elapsed)
    pollWorkItem?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.pollWorkItem = nil
      self.sendPoll(session: session)
    }
    pollWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(delayMs) / 1000.0, execute: work)
  }

  /// Safety re-poll: if no reply lands within the window, assume a dropped request/reply and
  /// re-poll so the loop self-heals instead of stalling.
  private func armSafety(session: BoardSession, tick: Int64) {
    cancelSafetyPoll()
    let timeoutMs = max(Int64(floorMs) * 4, 1000)
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.polling, session === self.session, session.isActive, self.pollTick == tick else { return }
      self.safetyWorkItem = nil
      self.sendPoll(session: session)
    }
    safetyWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(timeoutMs) / 1000.0, execute: work)
  }

  private func stopScheduledPolls() {
    pollWorkItem?.cancel()
    pollWorkItem = nil
    cancelSafetyPoll()
  }

  private func cancelSafetyPoll() {
    safetyWorkItem?.cancel()
    safetyWorkItem = nil
  }

  private func measuredRateHz() -> Double? {
    smoothedPeriodMs > 0 ? 1000.0 / smoothedPeriodMs : nil
  }

  private func latency(at now: Int64) -> Int? {
    lastPollAt > 0 ? Int(max(0, now - lastPollAt)) : nil
  }

  /// - SeeAlso: `SessionClock`
  private func nowMs() -> Int64 { sessionClock.nowMs() }
  private func elapsedMs() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000.0) }
}

/// App-process command facade used by both Expo module calls and `StopRideIntent`. Keeping the
/// command below module lifetime lets iOS launch the app process for the intent without requiring
/// a live JS runtime or a `VescapeCoreModule` instance.
@MainActor
enum BoardSessionCommands {
  /// `source`/`origin` name the rider action: the Live Activity and App Intent Stop are End ride,
  /// while the JS Disconnect button is a Manual Disconnect. Both arm an Automatic Connection Pause.
  @discardableResult
  static func stopRide(
    source: String = ConnectionTraceReason.endRide,
    origin: String = ConnectionTraceOrigin.endRide
  ) -> Bool {
    let controller = BoardSessionController.shared
    let accepted = ManualBoardStop(
      activeBoardId: { controller.connectedBoardId },
      stop: { controller.stopBoard() },
      armPause: { controller.armConnectionPause(boardId: $0, source: source, origin: origin) != nil }
    ).perform()
    // A stop no session accepted means the surface is a ghost from a killed process (ADR 0034).
    // The session stays a no-op, but the Live Activity must still die — otherwise Stop on a ghost
    // does nothing and the activity is unkillable from the widget.
    if !accepted { controller.endOrphanLiveActivity() }
    return accepted
  }
}

private extension BoardConnectConfig {
  func linkIdentity() -> LinkIdentity {
    LinkIdentity(
      linkVersion: linkVersion,
      hasBms: hasBms,
      firmware: vescFirmwareVersion,
      refloatVersion: refloatVersion,
      refloatBaseVersion: refloatBaseVersion
    )
  }
}
