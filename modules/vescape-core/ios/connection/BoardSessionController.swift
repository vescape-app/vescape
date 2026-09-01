import Foundation
import UIKit
import UserNotifications

/// Sentinel active fault code meaning "state not yet established this Board Session".
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `FAULT_CODE_UNKNOWN`
private let faultCodeUnknown = -1
private let manualFaultLogMaxSpeedKmh = 1.0

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
    // Reads resolve tombstones so history can name them (ADR 0027); connecting to one is refused.
    guard board["deletedAt"] as? Int64 == nil else { return nil }
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
  /// Deadline for proving the link either way. Longer than the BMS timeout so that verdict lands
  /// first when a BMS is expected.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `LINK_INTEGRITY_CHECK_TIMEOUT_MS`
  private let linkIntegrityCheckTimeoutSeconds = 20.0
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `sendPayloadWithRetry`
  private let sendRetryDelaySeconds = 0.12
  /// Idle delay after link trust before the one background config-safety read fires. Only long
  /// enough to let the connect burst clear: the read plus its multi-packet schema transfer is what
  /// the rider waits on, and a config-change notice has to reach them before they ride off.
  private let configSafetyReadDelaySeconds = 0.4

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
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `groupRideObserver`
  private lazy var groupRideObserver = GroupRideObserver(
    emit: { [weak self] event, payload in self?.emit?(event, payload) },
    online: AppStatusCoordinator.shared
  )

  /// Enabled Privacy Zones cached for the Group Ride presence egress gate (issue #144). Refreshed
  /// when observing starts and on zone CRUD; reuses the same geometry as Ride Recording
  /// suppression (ADR-0009 / ADR-0020).
  private var groupRidePrivacyZones: [PrivacyZoneEntity] = []

  /// The Rider's shared map target (their direction Map Point), cached for presence egress.
  /// Refreshed when observing starts and on direction-point CRUD.
  private var groupRideTarget: TargetPoint?

  /// Latest decoded telemetry frame, kept for Group Ride presence egress (speed/temps/SoC).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `telemetry`
  private var latestTelemetry: RefloatTelemetry?

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
  /// Last active Refloat fault code dispatched to the fault coordinator this Board Session.
  /// `faultCodeUnknown` means "not yet established", which forces one dispatch either way.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `liveFaultCode`
  private var lastDispatchedFaultCode: Int? = faultCodeUnknown
  private var lastFaultDispatchAtMs: Int64 = 0
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

  // MARK: - Scan API

  func scan() {
    scanError = nil
    scanPhase = "scanning"
    gatt.startScan()
    onStateChanged?()
  }

  func stopScan() {
    gatt.stopScan()
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

  /// The board's lights as its last echo reported them, or `nil` while this session has never heard
  /// one — the board is not saying, so JS shows nothing rather than a guess.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardLights`
  private var boardLights: BoardLightsState?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `lightsEventBody`
  func lightsEventBody() -> [String: Any?] {
    ["enabled": boardLights?.enabled, "headlightsEnabled": boardLights?.headlightsEnabled]
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `lightsGeneration`
  private func lightsGeneration() -> BoardLightsGeneration {
    BoardLightsGeneration.forBaseVersion(config?.refloatBaseVersion)
  }

  /// Take the board's lights echo as this session's truth, and on `.legacy` teach the config-change
  /// baseline about it.
  ///
  /// Refloat 1.1 and older have no runtime layer: the switch assigns the stored config, so the next
  /// fresh read legitimately differs from the cached baseline. Without this the rider's own tap comes
  /// back at them as "changed outside Vescape". Only the diff baseline is updated — never
  /// `boardConfigValues`, whose raw bytes still describe what the board actually sent and must stay a
  /// faithful write base (ADR 0035).
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onBoardLightsEcho`
  private func onBoardLightsEcho(_ lights: BoardLightsState) {
    boardLights = lights
    emit?("onBoardLights", lightsEventBody())
    guard lightsGeneration() == .legacy, let values = boardConfigValues else { return }
    guard
      let boardId = values.boardId, let baseVersion = values.refloatBaseVersion,
      let rebased = values.withFlag(.ledsOn, lights.enabled)?
        .withFlag(.headlightsOn, lights.headlightsEnabled)
    else { return }
    // Only the two light fields are patched into the stored row. Writing the whole snapshot back
    // would race a fresh read that landed since it was taken and reinstate its stale values as the
    // comparison base.
    let patch = rebased.values.filter {
      $0.key == BoardConfigFlagField.ledsOn.id || $0.key == BoardConfigFlagField.headlightsOn.id
    }
    BoardConfigStore.shared.patch(
      boardId: boardId,
      refloatBaseVersion: baseVersion,
      values: patch
    )
  }

  /// Seed the lights from config, which is what firmware applies until something overrides it. On
  /// `.legacy` config stays the truth for the whole session, because the switch writes it directly.
  /// On 1.2+ a runtime override detaches the two for the rest of the power cycle, so config only
  /// speaks until this session's first echo.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `syncBoardLightsFromConfig`
  private func syncBoardLightsFromConfig(_ values: BoardConfigValues) {
    if lightsGeneration() == .current, boardLights != nil { return }
    guard let enabled = values.flag(.ledsOn) else { return }
    let lights = BoardLightsState(
      enabled: enabled,
      headlightsEnabled: values.flag(.headlightsOn) ?? false
    )
    guard lights != boardLights else { return }
    boardLights = lights
    emit?("onBoardLights", lightsEventBody())
  }

  /// State the board's lights: the LEDs and the headlights, each on or off. Both switches are always
  /// written, so a caller changing one must pass the other's current value. Runtime only: firmware
  /// applies it live and writes no config, so the board's own setting returns on the next power
  /// cycle.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setBoardLights`
  func setBoardLights(enabled: Bool, headlightsEnabled: Bool) -> Bool {
    guard firmwareCommandsTrusted(), let config else { return false }
    let transport = config.transport ?? .direct
    let generation = BoardLightsGeneration.forBaseVersion(config.refloatBaseVersion)
    return sendPayloadWithRetry(
      buildLightsControlCommand(
        transport: transport,
        generation: generation,
        enabled: enabled,
        headlightsEnabled: headlightsEnabled
      ),
      session: session
    )
  }

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

  // MARK: - Group Ride

  /// Open the observe socket and refresh the presence egress caches it reads on every fix.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `consumePendingGroupRideObserve`
  func startGroupRideObserve(_ url: String) {
    loadPrivacyZones()
    loadGroupRideTarget()
    groupRideObserver.start(url)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `stopGroupRideObserve`
  func stopGroupRideObserve() {
    groupRideObserver.stop()
  }

  func createGroupRide(riderId: String, riderName: String, riderColor: String?, name: String?, lat: Double, lng: Double) {
    groupRideObserver.create(riderId: riderId, riderName: riderName, riderColor: riderColor, name: name, lat: lat, lng: lng)
  }

  func joinGroupRide(riderId: String, riderName: String, riderColor: String?, rideId: String) {
    startLocationUpdates()
    groupRideObserver.join(
      riderId: riderId,
      riderName: riderName,
      riderColor: riderColor,
      rideId: rideId,
      presence: latestRiderPresence()
    )
  }

  func leaveGroupRide() {
    groupRideObserver.leave()
  }

  func updateGroupRideIdentity(riderId: String, riderName: String, riderColor: String?) {
    groupRideObserver.updateIdentity(riderId: riderId, riderName: riderName, riderColor: riderColor)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `latestRiderPresence`
  private func latestRiderPresence() -> RiderPresence? {
    guard let location = latestPreciseLocation ?? latestLocation else { return nil }
    // Privacy Zone egress gate (issue #144): freeze the group dot while inside a zone. Local GPS
    // keeps ticking; only the broadcast is suppressed, resuming automatically on exit.
    if isInsidePrivacyZone(location) { return nil }
    let telemetry = latestTelemetry
    let telemetryFresh = telemetry != nil && !isTelemetryStale()
    return RiderPresence(
      lat: location.latitude,
      lng: location.longitude,
      heading: location.bearingDeg,
      speed: telemetryFresh ? telemetry.map { abs($0.speed) / 3.6 } : nil,
      soc: telemetryFresh ? latestBatterySoc.map { min(max($0 / 100.0, 0), 1) } : nil,
      motorTemp: telemetryFresh ? telemetry?.tempMotor : nil,
      ctrlTemp: telemetryFresh ? telemetry?.tempMosfet : nil,
      phoneBattery: readPhoneBattery(),
      boardName: config.map { $0.name.isEmpty ? boardName : $0.name } ?? nil,
      target: groupRideTarget
    )
  }

  /// Device battery as a 0–1 fraction, or nil when the platform can't report it.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `readPhoneBattery`
  private func readPhoneBattery() -> Double? {
    UIDevice.current.isBatteryMonitoringEnabled = true
    let level = UIDevice.current.batteryLevel
    return level < 0 ? nil : Double(level)
  }

  private func isInsidePrivacyZone(_ location: TelemetryLocationCapture) -> Bool {
    guard !groupRidePrivacyZones.isEmpty else { return false }
    return isInsideAnyPrivacyZone(
      latitudeE7: Int((location.latitude * 10_000_000.0).rounded()),
      longitudeE7: Int((location.longitude * 10_000_000.0).rounded()),
      zones: groupRidePrivacyZones
    )
  }

  /// Refresh the Group Ride presence zone gate from native storage (observe start + zone CRUD).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadPrivacyZones`
  func loadPrivacyZones() {
    groupRidePrivacyZones = appData.getEnabledPrivacyZoneEntities()
  }

  /// Refresh the shared Group Ride target from native storage (observe start + direction-point
  /// CRUD), then push presence immediately so peers see the change without waiting for the next
  /// GPS tick.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadGroupRideTarget`
  func loadGroupRideTarget() {
    groupRideTarget = appData.getDirectionPoint().map { TargetPoint(lat: $0.latitude, lng: $0.longitude) }
    latestRiderPresence().map(groupRideObserver.pushPresence)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `isTelemetryStale`
  private func isTelemetryStale(now: Int64 = SystemSessionClock.shared.nowMs()) -> Bool {
    now - (lastTelemetryAt ?? 0) >= Int64(telemetryStaleSeconds * 1000)
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
    // `VESC Fault Collection` is its own kill switch — deliberately not gated on
    // `boardWarningsEnabled`, so turning warnings off keeps fault evidence flowing.
    let collectionWasEnabled = VescFaultCoordinator.shared.collectionEnabled
    let collectionEnabled = settings["vescFaultCollectionEnabled"] as? Bool ?? true
    VescFaultCoordinator.shared.collectionEnabled = collectionEnabled
    // The switch must stop capture persistence too, without deleting stored evidence.
    VescFaultCaptureCoordinator.shared.setCollectionEnabled(collectionEnabled)
    if !collectionWasEnabled, collectionEnabled {
      // Transitions were dropped while disabled, so the controller's edge state is a lie. Reset it
      // to unknown so the next frame — fault or normal — reconciles the coordinator with what the
      // controller is actually reporting.
      lastDispatchedFaultCode = faultCodeUnknown
      lastFaultDispatchAtMs = 0
    }
    boardWarningsEnabled = settings["boardWarningsEnabled"] as? Bool ?? true
    // Disabled→enabled with an already-trusted link: link integrity won't transition again, so
    // schedule the config-safety read here.
    if !warningsWereEnabled, boardWarningsEnabled, lastEmittedLinkIntegrity == .trusted {
      // Re-arm: evaluate the config this session already read, or retry the read if it never landed.
      if let values = boardConfigValues, values.freshness == .fresh {
        evaluateConfigSafety(values)
      } else {
        boardConfigReadScheduled = false
        scheduleBoardConfigRead()
      }
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
      return
    }
    pendingResume = nil
    reapOrphanLiveActivities()
  }

  // MARK: - Launch auto-connect (#401)

  /// Auto-connect the selected Board at **process launch**, native-driven and independent of JS.
  /// Called from `VescapeLaunchSubscriber` right after `prepareForLaunch()`, so restoration adoption
  /// decides first: while a resume is pending (or a session is already live) this stands down and
  /// lets the restored session own the launch.
  ///
  /// The trigger is the app-delegate launch hook, not the Expo module lifecycle — a JS reload
  /// creates a new module but no new process, so it cannot restart or duplicate a live session, and
  /// a launch that brings up no JS at all still auto-connects.
  ///
  /// JS never triggers this; it only toggles the `autoConnect` setting. No-ops when auto-connect is
  /// off, no Board is selected, the Board is unlinked, or the Board is gated by a manual stop.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/AutoConnectProvider.kt
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `autoConnectSelectedBoard`
  func autoConnectSelectedBoard() {
    let settings = appData.getSettings()
    let decision = AutoConnectGate.decide(
      settings: settings,
      suppressedBoardId: ManualBoardStop.suppressedBoardId(),
      hasLiveSession: session != nil,
      resumePending: pendingResume != nil
    )
    NSLog(
      "[VescAutoConnect] launch decision=%@ settingsKeys=%d autoConnect=%@ selectedBoardId=%@ tombstone=%@",
      String(describing: decision),
      settings.count,
      String(describing: settings["autoConnect"] as? Bool),
      String(describing: settings["selectedBoardId"] as? String),
      String(describing: ManualBoardStop.suppressedBoardId())
    )
    guard case let .connect(boardId) = decision else { return }
    DispatchQueue.main.async {
      // Re-check on the main queue: restoration can adopt the session between the launch hook and
      // this hop, and that session must not be replaced by a fresh connect.
      guard self.session == nil, self.pendingResume == nil else {
        NSLog("[VescAutoConnect] aborted on main queue: session adopted between launch and connect")
        return
      }
      guard let config = BoardConnectConfig.resolve(boardId: boardId, appData: self.appData) else {
        NSLog("[VescAutoConnect] no connect config for board %@ (unlinked?)", boardId)
        return
      }
      NSLog("[VescAutoConnect] connecting board=%@ bleId=%@", boardId, config.bleId)
      self.connect(config: config, onSuccess: {}, onError: { code, message in
        NSLog("[VescAutoConnect] connect failed %@: %@", code, message)
      })
    }
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
    guard session == nil else { return }
    guard let config = BoardConnectConfig.resolve(boardId: marker.appBoardId, appData: appData) else {
      // Board unlinked or deleted while the app was dead — nothing to resume.
      SessionResumeStore.shared.clear()
      clearPendingResume()
      reapOrphanLiveActivities()
      return
    }
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
    faultLogReader?.cancel()
    faultLogReader = nil
    session?.invalidate()
    stopPolling()
    stopReconnect()
    // A live→live connect does not pass through `stopSession`, so end any config op the previous
    // session left in flight here: its callbacks and payload routing belong to a session that is
    // about to be replaced, and a new reader must start its own read rather than join a dead one.
    configController.onSessionTerminated("Board session replaced", connection: fallbackConfigRWConnection())
    reassembler.reset()

    sessionSequence += 1
    session = BoardSession(id: sessionSequence)
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
    boardConfigReadScheduled = false
    motorConfigRequested = false
    motorConfigValues = nil
    vescLiveFirmware = nil
    self.config = config
    // Something to show before the fresh read lands: the cache for this Board + Refloat base
    // version, restored as `lastKnown` (never a write base — see #396).
    boardConfigValues = restoredBoardConfigValues(config)
    if let restored = boardConfigValues { syncBoardLightsFromConfig(restored) }
    // No scope key to match on: the board's MCCONF signature is unknown until it answers, so the
    // latest row is restored optimistically and replaced when this session's own read lands.
    motorConfigValues = MotorConfigStore.shared.loadLatest(boardId: config.appBoardId)
    alertCoordinator.updateBoardConfigValues(boardConfigValues?.values ?? [:])
    // A Board Session actually started, so the manual stop that gated auto-connect is spent: the
    // rider is riding again. Without this the tombstone outlives every later launch and auto-connect
    // stays dead until the Board is re-selected. Replay sessions are synthetic and leave it alone.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `connectSelectedBoard`
    if replayTransport == nil {
      ManualBoardStop.clearAutoStartSuppression()
    }
    if let session {
      lastEmittedLinkIntegrity = session.startLinkIntegrityCheck(expected: config.linkIdentity())
    }
    let sessionSettings = appData.getSettings()
    movingThresholdCentiKmh = MetricSanitizerConfig.from(settings: sessionSettings).movingSpeedThresholdCentiKmh
    VescFaultCoordinator.shared.collectionEnabled = sessionSettings["vescFaultCollectionEnabled"] as? Bool ?? true
    wireFaultCaptures()
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
    // Unknown fault state: the first frame of the session always reaches the fault coordinator, so a
    // fault that opened before a restart is closed by the first normal frame after it.
    lastDispatchedFaultCode = faultCodeUnknown
    lastFaultDispatchAtMs = 0
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
    latestTelemetry = nil
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
    faultLogReader?.cancel()
    faultLogReader = nil
    session?.invalidate()
    session = nil
    config = nil
    // Board Config Values are per Board Session; the cache row survives, the held object does not.
    boardConfigValues = nil
    motorConfigValues = nil
    motorConfigRequested = false
    // Lights are per Board Session: what the last board's echo said means nothing for the next.
    boardLights = nil
    emit?("onBoardLights", lightsEventBody())
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
    // The Board Session survives the drop, but exclusive ownership of the config does not: while we
    // were off the link another central could have written. The values stay displayable, they just
    // stop backing a write until the post-trust read makes them fresh again (ADR 0035).
    boardConfigValues = boardConfigValues?.demotedToProvisional()
    // Lights stop being known across the drop: the board may reboot while off the link, which clears
    // its runtime override and hands authority back to config. Keeping the old echo would leave the
    // switch showing pre-reboot state that nothing ever corrects.
    boardLights = nil
    emit?("onBoardLights", lightsEventBody())
    // Re-arm the post-trust read so the relinked session gets fresh values back.
    boardConfigReadScheduled = false
    // Same reasoning as the Refloat demote above.
    motorConfigValues = motorConfigValues?.demotedToLastKnown()
    motorConfigRequested = false

    sessionSequence += 1
    session = BoardSession(id: sessionSequence)
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
    transport.startReconnectScan()
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(rescanWindowMs) / 1000.0) { [weak self] in
      guard let self, self.reconnecting, session === self.session, session.isActive else { return }
      self.transport.stopReconnectScan()
      if self.phase == .rescanning { self.setPhase(.reconnecting) }
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(self.rescanIdleMs) / 1000.0) { [weak self] in
        self?.scheduleRescanCycle(session: session)
      }
    }
  }

  private func stopReconnect() {
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

  func onScanFailure(_ message: String) {
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
      // The lights echo shares the telemetry command byte but carries no metrics.
      // It is also the only truth about the board's lights, so it is what JS renders.
      if let lights = parseLightsControlResponse(payload) {
        onBoardLightsEcho(lights)
        return
      }
      handleTelemetry(payload, session: session)
    case COMM_FW_VERSION:
      handleFwVersion(payload)
    case COMM_BMS_GET_VALUES:
      // Direct smart-BMS reply.
      handleBms(payload)
    case COMM_FORWARD_CAN where payload.count >= 5 && Int(payload[2]) == COMM_CUSTOM_APP_DATA:
      // Telemetry answers come back unwrapped, but the lights echo can arrive CAN-wrapped, so the
      // switch would look ignored on a CAN-forwarded board without this.
      if let lights = parseLightsControlResponse(payload) {
        onBoardLightsEcho(lights)
      }
    case COMM_FORWARD_CAN where payload.count >= 3 && Int(payload[2]) == COMM_BMS_GET_VALUES:
      // CAN-forwarded smart-BMS reply (telemetry stays bare, but BMS comes wrapped).
      handleBms(Array(payload[2...]))
    case COMM_FORWARD_CAN where payload.count >= 3 && Int(payload[2]) == COMM_FW_VERSION:
      handleFwVersion(Array(payload[2...]))
    case COMM_GET_MCCONF:
      handleMcconfPayload(Array(payload[1...]))
    case COMM_FORWARD_CAN where payload.count >= 4 && Int(payload[2]) == COMM_GET_MCCONF:
      handleMcconfPayload(Array(payload[3...]))
    case COMM_PRINT where payload.count >= 2:
      handlePrintPayload(Array(payload[1...]))
    case COMM_FORWARD_CAN where payload.count >= 4 && Int(payload[2]) == COMM_PRINT:
      handlePrintPayload(Array(payload[3...]))
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

    // A valid mode-69 response still paces the response-driven poll loop — the frame is a real
    // answer, it just carries no metrics.
    onPollResponse(session: session)
    lastTelemetryAt = now
    armStaleWatchdog(session: session)
    markBoardReady()
    startLinkIntegrityProbe(session: session)
    if telemetry.hasFault {
      // Refloat fault mode: a state signal with zeroed metrics, never a Telemetry Sample. It
      // opens/extends a VESC Fault Occurrence and stops here — persisting or aggregating it would
      // poison Ride History with a frame of zeros.
      onRefloatFaultFrame(telemetry.faultCode)
      return
    }
    onRefloatNormalFrame()
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

  /// Take ownership of the Board Config Values a read or write just produced: they become this
  /// session's config truth, get cached for the next connect, and feed warning evaluation.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onBoardConfigValues`
  private func onBoardConfigValues(_ values: BoardConfigValues, origin: BoardConfigOperationOrigin) {
    // The link can go `mismatched` (or the Board change) while a read is on the wire; those bytes
    // describe a board this session no longer owns, so they must not repopulate what was cleared.
    guard values.boardId == config?.appBoardId, linkIntegrity == .trusted else { return }
    boardConfigValues = values
    syncBoardLightsFromConfig(values)
    alertCoordinator.updateBoardConfigValues(values.values)
    if origin == .freshRead { BoardConfigStore.shared.saveFresh(values) }
    else { BoardConfigStore.shared.save(values) }
    evaluateConfigSafety(values)
  }

  /// The cached values for the connecting Board, as `lastKnown`.
  private func restoredBoardConfigValues(_ config: BoardConnectConfig) -> BoardConfigValues? {
    guard let base = config.refloatBaseVersion else { return nil }
    return BoardConfigStore.shared.load(boardId: config.appBoardId, refloatBaseVersion: base)
  }

  /// Drop held and persisted Board Config Values for the connected Board (`mismatched` link).
  private func clearBoardConfigValues() {
    boardConfigValues = nil
    motorConfigValues = nil
    alertCoordinator.updateBoardConfigValues([:])
    guard let boardId = config?.appBoardId else { return }
    BoardConfigStore.shared.clear(boardId: boardId)
    MotorConfigStore.shared.clear(boardId: boardId)
  }

  /// Evaluate the config-safety rules against a freshly decoded config (background read after link
  /// trust, or the in-hand bytes from a tune write) and report findings / clean evaluations through
  /// the Board Warning registry. Per-cell rules use the configured battery series count and are
  /// skipped when it is absent; skipped kinds report nothing so stored warnings stay untouched.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateConfigSafety`
  private func evaluateConfigSafety(_ values: BoardConfigValues) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    let seriesCount = config?.batteryConfig?["seriesCount"] as? Int
    let perCellSupported = ConfigSafetyDetector.supportsPerCellVoltage(vescLiveFirmware)
    let report = ConfigSafetyDetector.evaluate(values, seriesCount: seriesCount, perCell: perCellSupported)
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

  /// Once per Board Session, after the link is trusted, kick off the one background Refloat config
  /// read that acquires this session's Board Config Values. Runs regardless of the Board Warnings
  /// setting — that gate sits on warning *evaluation*, not on acquiring config (ADR 0035). Read-only;
  /// reuses the normal config read path (pauses/resumes polling), and a consumer asking for config
  /// while it is in flight joins this read instead of starting a competing one.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `triggerBoardConfigRead`
  private func triggerBoardConfigRead(_ session: BoardSession) {
    guard session === self.session, session.isActive, let config else { return }
    configController.consumeRead(
      connection: configConnection(config),
      onSuccess: { [weak self, weak session] _ in
        guard let self, let session else { return }
        self.requestMotorConfig(session)
      },
      onError: { [weak self, weak session] _, _ in
        guard let self, let session else { return }
        self.requestMotorConfig(session)
      }
    )
  }

  /// Ask the controller for its motor config (MCCONF) once per Board Session. Deliberately sequenced
  /// after the Refloat read rather than beside it: both are multi-packet transfers over one BLE link,
  /// and the Refloat read owns the polling pause while it runs.
  ///
  /// Mandatory link state, like the Refloat read: the Board Probe waits for the decoded values and
  /// fails the link without them, so a board whose signature no layout carries is refused at link
  /// time rather than losing its cutoffs silently at ride time (ADR 0036).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `requestMotorConfig`
  private func requestMotorConfig(_ session: BoardSession) {
    guard session === self.session, session.isActive, !motorConfigRequested, let config else { return }
    motorConfigRequested = true
    _ = transport.sendPayload(config.transport.frame([UInt8(COMM_GET_MCCONF)]))
  }

  /// - Parameter body: the MCCONF response with its framing (and CAN wrapper) already stripped.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `handleMcconfPayload`
  private func handleMcconfPayload(_ body: [UInt8]) {
    // A response only counts for the session that asked. The link can go `mismatched` (clearing held
    // and persisted values) or the Board can change while the blob is on the wire; without these
    // guards those late bytes repopulate what was just cleared.
    guard let session, session === self.session, session.isActive, motorConfigRequested else { return }
    guard linkIntegrity == .trusted else { return }
    switch McconfDecoder.decode(body) {
    case .decoded(let signature, let firmware, let values):
      let decoded = MotorConfigValues(
        boardId: config?.appBoardId,
        signature: signature,
        firmware: firmware,
        capturedAtMs: nowMs(),
        freshness: .fresh,
        values: values
      )
      motorConfigValues = decoded
      MotorConfigStore.shared.saveFresh(decoded)
      NSLog("MCCONF decoded: \(firmware) signature=\(signature) fields=\(values.count)")
    // Not a failure of ours: this board runs a firmware whose layout is not carried yet.
    // Report the signature so a table can be generated for it; decode nothing.
    // Not a failure of ours: this board runs a firmware whose layout is not carried yet. Report the
    // signature so a table can be generated for it, and drop the optimistically restored cache row —
    // it was read under a signature this board does not answer with, and no motor config is the
    // honest answer here (ADR 0036).
    case .unknownSignature(let signature, let byteCount):
      motorConfigValues = nil
      NSLog("MCCONF signature \(signature) has no layout (\(byteCount) bytes)")
    case .malformed(let reason):
      motorConfigValues = nil
      NSLog("MCCONF malformed: \(reason)")
    }
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
    // The probe is claimed once per Board Session and never re-armed, so a send the transport drops
    // strands the link in `checking` for the whole session — commands stay blocked with no Re-link
    // CTA to offer. Retry once, like Android.
    sendPayloadWithRetry(config.transport.frame([UInt8(COMM_FW_VERSION)]), session: session)
    sendPayloadWithRetry(RefloatConfigProtocol.buildGetInfo(transport: config.transport), session: session)
    if config.hasBms == true {
      DispatchQueue.main.asyncAfter(deadline: .now() + linkIntegrityBmsTimeoutSeconds) { [weak self, weak session] in
        guard let self, let session, session === self.session, session.isActive, let config = self.config else { return }
        self.updateLinkIntegrity(session.markBmsMissing(expected: config.linkIdentity()))
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + linkIntegrityCheckTimeoutSeconds) { [weak self, weak session] in
      guard let self, let session, session === self.session, session.isActive else { return }
      self.updateLinkIntegrity(session.markCheckTimedOut())
    }
  }

  private var lastEmittedLinkIntegrity: LinkIntegrity = .unknown
  private var boardConfigReadScheduled = false
  private var motorConfigRequested = false

  /// This Board Session's decoded motor config, keyed by firmware field id, or nil while none has
  /// been decoded — no layout for the board's signature is a normal reason for that.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `motorConfigValues`
  private var motorConfigValues: MotorConfigValues? {
    didSet {
      // Config-relative Alert Rules may anchor to MCCONF fields (temperature cutoffs), so the
      // engine follows this value the same way it follows the Refloat config.
      let motorValues: [String: Any] = motorConfigValues?.values ?? [:]
      alertCoordinator.updateMotorConfigValues(motorValues)
      emit?("onMotorConfigValues", ["values": motorConfigValues?.toBridgeMap()])
    }
  }

  /// The held Motor Config Values in bridge shape, or nil when none are held.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `motorConfigValuesMap`
  func motorConfigValuesMap() -> [String: Any?]? {
    motorConfigValues?.toBridgeMap()
  }
  /// This Board Session's Board Config Values: `fresh` once the post-trust read lands, `lastKnown`
  /// while it is the cache restored on connect. Native-owned truth; JS mirrors it through
  /// `getBoardConfigValues` + `onBoardConfigValues`.
  ///
  /// Every assignment emits — arrival, refresh after a write, and the clears (session end, board
  /// switch, `mismatched`) — so the bridge event needs no separate call sites to stay honest.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardConfigValues`
  private var boardConfigValues: BoardConfigValues? {
    didSet { emit?("onBoardConfigValues", ["values": boardConfigValues?.toBridgeMap()]) }
  }

  /// The held Board Config Values in bridge shape, or nil when none are held.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardConfigValuesMap`
  func boardConfigValuesMap() -> [String: Any?]? {
    boardConfigValues?.toBridgeMap()
  }
  /// Live-parsed firmware string ("FW 6.05 · …"), used to resolve per-cell vs pack pushback units.
  /// Mirrors Android `fwVersionString`.
  private var vescLiveFirmware: String?

  private func updateLinkIntegrity(_ next: LinkIntegrity) {
    guard next != lastEmittedLinkIntegrity else { return }
    lastEmittedLinkIntegrity = next
    onStateChanged?()
    // Link just became trusted — schedule the one background config read for this session.
    if next == .trusted { scheduleBoardConfigRead() }
    // Mismatched firmware makes every cached offset meaningless: drop the held object and the
    // persisted rows for this Board. `outdated` keeps them.
    if next == .mismatched { clearBoardConfigValues() }
  }

  private func scheduleBoardConfigRead() {
    guard !boardConfigReadScheduled, let session else { return }
    boardConfigReadScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + configSafetyReadDelaySeconds) { [weak self, weak session] in
      guard let self, let session else { return }
      self.triggerBoardConfigRead(session)
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
    latestTelemetry = telemetry
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
  /// keys `board_id` into the `board_id` column JS reads; `ble_id` and `board_nickname` stay in the
  /// opaque properties payload as diagnostic context, never as the row's identity.
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

  // MARK: - Manual VESC fault log

  /// One user-requested terminal read at a time. Output is returned directly and never parsed,
  /// persisted, or converted into fault occurrences.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `faultLogReader`
  private var faultLogReader: VescFaultLogReader?

  /// Read official VESC `faults` output on explicit user action. Refuse while moving because
  /// terminal traffic competes with response-paced ride telemetry.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `readVescFaultLog`
  func readVescFaultLog(
    boardId: String,
    onSuccess: @escaping (String) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    guard phase == .connected, config?.appBoardId == boardId, let session, let config else {
      onError("VESC_FAULT_LOG_BOARD_NOT_CONNECTED", "Matching Board must be connected")
      return
    }
    guard let speed = latestTelemetry?.speed, abs(speed) <= manualFaultLogMaxSpeedKmh else {
      onError("VESC_FAULT_LOG_BOARD_MOVING", "Stop the Board before reading controller fault log")
      return
    }
    guard faultLogReader == nil else {
      onError("VESC_FAULT_LOG_BUSY", "Controller fault log read already in progress")
      return
    }
    let reader = VescFaultLogReader(startedAtMs: nowMs(), onSuccess: onSuccess, onError: onError)
    faultLogReader = reader
    _ = sendPayloadWithRetry(buildFaultsTerminalCommand(config.transport), session: session)
    scheduleFaultLogTick(session: session)
  }

  private func scheduleFaultLogTick(session: BoardSession) {
    DispatchQueue.main.asyncAfter(deadline: .now() + VescFaultLogReader.tickSeconds) {
      [weak self, weak session] in
      guard let self, let session, session === self.session, session.isActive else { return }
      guard let reader = self.faultLogReader else { return }
      guard reader.poll(self.nowMs()) else {
        self.scheduleFaultLogTick(session: session)
        return
      }
      self.faultLogReader = nil
    }
  }

  /// Feed one `COMM_PRINT` frame to the in-flight read. Terminal text is deliberately isolated here
  /// and never reaches telemetry parsing; without an active read the bytes are dropped, because
  /// Vescape has no other reason to be listening to the controller's console.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `handlePrintPayload`
  private func handlePrintPayload(_ body: [UInt8]) {
    faultLogReader?.onPrintChunk(body, atMs: nowMs())
  }

  /// Point the VESC Fault Capture coordinator at this session's recent decoded window and at the
  /// occurrence transitions that mint capture ids. Reuses `LiveSeriesEmitter.recentSnapshot` — the
  /// same buffer behind `board.recentTelemetry` — rather than adding a second always-on pre-fault
  /// buffer.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `wireFaultCaptures`
  private func wireFaultCaptures() {
    let captures = VescFaultCaptureCoordinator.shared
    captures.recentWindow = { [weak self] in self?.liveSeries.recentSnapshot() ?? [] }
    captures.setCollectionEnabled(VescFaultCoordinator.shared.collectionEnabled)
    VescFaultCoordinator.shared.onOccurrenceOpened = { occurrence in
      captures.capturePast(
        occurrenceId: occurrence.id,
        boardId: occurrence.boardId,
        openedAtMs: occurrence.occurredAtMs
      )
    }
  }

  /// Refloat reported an active fault code. Independent of Ride Recording and Board Warnings: the
  /// VESC Fault Occurrence is Board-owned durable truth.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onRefloatFaultFrame`
  private func onRefloatFaultFrame(_ code: Int) {
    updateLiveFault(activeCode: code)
    guard let boardId = config?.appBoardId else { return }
    let timestamp = nowMs()
    // Edge-triggered plus a slow heartbeat: a fault can repeat at the full poll rate, and one
    // occurrence must not cost one durable write per frame.
    if lastDispatchedFaultCode == code,
       timestamp - lastFaultDispatchAtMs < VescFaultCoordinator.observationWriteIntervalMs {
      return
    }
    lastDispatchedFaultCode = code
    lastFaultDispatchAtMs = timestamp
    VescFaultCoordinator.shared.onActiveFault(boardId: boardId, code: code)
  }

  /// Refloat reported a normal `ALLDATA` frame — the controller is not faulting, so any open
  /// occurrence for this Board is closed.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onRefloatNormalFrame`
  private func onRefloatNormalFrame() {
    updateLiveFault(activeCode: nil)
    let timestamp = nowMs()
    // Retry a failed durable clear at the same bounded rate as an active observation.
    if lastDispatchedFaultCode == nil,
       timestamp - lastFaultDispatchAtMs < VescFaultCoordinator.observationWriteIntervalMs {
      return
    }
    lastDispatchedFaultCode = nil
    lastFaultDispatchAtMs = timestamp
    guard let boardId = config?.appBoardId else { return }
    VescFaultCoordinator.shared.onFaultCleared(boardId: boardId)
  }

  /// Reflect fault state in the Live Activity on the rising/falling edge of a sustained fault.
  /// Mirrors Android surfacing faults through the persistent notification (edge-triggered, one
  /// update per state change rather than one per frame).
  private func updateLiveFault(activeCode: Int?) {
    if let activeCode {
      guard liveFaultCode != activeCode else { return }
      liveFaultCode = activeCode
      presentCriticalFaultNotificationIfAllowed(faultCode: activeCode)
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
      boardId: config.appBoardId,
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
    latestRiderPresence().map(groupRideObserver.pushPresence)
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

  /// Send a payload, re-sending once shortly after if the transport refused it (busy GATT queue,
  /// mid-reconnect write). Both attempts are scoped to the Board Session that asked, so a torn-down
  /// or reconnected session never writes.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `sendPayloadWithRetry`
  @discardableResult
  private func sendPayloadWithRetry(_ payload: [UInt8], session: BoardSession?) -> Bool {
    if let session, !(session === self.session && session.isActive) { return false }
    let sent = transport.sendPayload(payload)
    if !sent, let session {
      DispatchQueue.main.asyncAfter(deadline: .now() + sendRetryDelaySeconds) { [weak self, weak session] in
        guard let self, let session, session === self.session, session.isActive else { return }
        _ = self.transport.sendPayload(payload)
      }
    }
    return sent
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
      refloatVersion: config.refloatVersion,
      refloatBaseVersion: config.refloatBaseVersion,
      linkIntegrity: linkIntegrity,
      boardConfigValues: boardConfigValues,
      isPollingActive: { [weak self] in self?.polling ?? false },
      stopPolling: { [weak self] in self?.stopPolling() },
      startPolling: { [weak self] in self?.restartPollingForConfigRead() },
      sendPayload: { [weak self] payload in self?.transport.sendPayload(payload) ?? false },
      captureDiagnostic: { [weak self] name, properties in
        self?.recordConnectionDiagnostic(name, operation: "config_rw", message: properties["message"] as? String ?? name, extra: properties)
      },
      loadProfile: { profileId in TuneProfileStore.shared.getTuneProfile(profileId) },
      onBoardConfigValues: { [weak self] values, origin in self?.onBoardConfigValues(values, origin: origin) }
    )
  }

  private func fallbackConfigRWConnection() -> ConfigRWConnection {
    ConfigRWConnection(
      phase: phase,
      appBoardId: config?.appBoardId,
      transport: config?.transport ?? .direct,
      fwVersion: nil,
      refloatVersion: config?.refloatVersion,
      refloatBaseVersion: config?.refloatBaseVersion,
      linkIntegrity: linkIntegrity,
      boardConfigValues: nil,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { _ in false },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in nil },
      onBoardConfigValues: { _, _ in }
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
  @discardableResult
  static func stopRide() -> Bool {
    let controller = BoardSessionController.shared
    let accepted = ManualBoardStop(
      defaults: .standard,
      activeBoardId: { controller.connectedBoardId },
      stop: { controller.stopBoard() }
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
