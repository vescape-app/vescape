import Foundation
import UIKit
import UserNotifications

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `FAULT_CODE_UNKNOWN`
private let faultCodeUnknown = -1
private let manualFaultLogMaxSpeedKmh = 1.0
internal struct BoardConnectConfig {
  let appBoardId: String
  let bleId: String
  let name: String
  let transport: BoardTransport
  let linkVersion: Int?
  let hasBms: Bool?
  let vescFirmwareVersion: String?
  let refloatVersion: String?
  let refloatBaseVersion: String?
  let pollIntervalMs: Int
  let batteryConfig: [String: Any]?
  let liveHistoryLimitMinutes: Int
  var recordingEnabled = false
  var replay: ReplaySpec?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/SessionConfigBuilder.kt `buildSessionConfig`
  static func resolve(
    boardId: String,
    appData: AppDataRepository,
    recordingEnabled: Bool = false,
    hardware: RecordedHardware? = nil
  ) -> BoardConnectConfig? {
    let board: [String: Any?]
    do { guard let stored = try appData.getBoard(boardId) else { return nil }; board = stored }
    catch {
      RecordingStorageFailure.reportRead(operation: "board_connect_read", error: error)
      return nil
    }
    guard board["deletedAt"] as? Int64 == nil else { return nil }
    let link = board["link"] as? [String: Any?]
    let linkedBleId = (link?["bleId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let name = board["name"] as? String ?? "VESC Board"
    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "board_connect_settings_read", error: error)
      return nil
    }
    let hz = AppDataRepository.intValue(settings["telemetryPollRateHz"] ?? nil) ?? 0
    let batteryConfig = AppDataRepository.normalizeBatteryConfig(board["batteryConfig"] ?? nil)
    let liveHistoryLimitMinutes = AppDataRepository.liveHistoryLimitMinutes(settings["liveHistoryLimit"] ?? nil) ?? 5
    if let hardware {
      return BoardConnectConfig(
        appBoardId: boardId,
        bleId: linkedBleId ?? hardware.deviceId ?? boardId,
        name: name,
        transport: hardware.transport,
        linkVersion: LinkIdentity.currentLinkVersion,
        hasBms: hardware.hasBms,
        vescFirmwareVersion: hardware.firmware,
        refloatVersion: hardware.refloatVersion,
        refloatBaseVersion: hardware.refloatVersion.flatMap(LinkIdentity.normalizeRefloatBaseVersion),
        pollIntervalMs: hardware.pollIntervalMs ?? (hz > 0 ? 1000 / hz : 0),
        batteryConfig: batteryConfig,
        liveHistoryLimitMinutes: liveHistoryLimitMinutes,
        recordingEnabled: recordingEnabled
      )
    }
    guard let link, let bleId = linkedBleId else { return nil }
    let transport = BoardTransport.fromBridge(link["transport"] ?? nil) ?? .direct
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
      batteryConfig: batteryConfig,
      liveHistoryLimitMinutes: liveHistoryLimitMinutes,
      recordingEnabled: recordingEnabled
    )
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/CoreForegroundService.kt `ReplaySpec`
internal struct ReplaySpec {
  let recording: ReplayRecording
  let warmupMs: Int64
  let loop: Bool
}

/// @platform-diff below.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt
/// @platform-diff iOS relies on CoreBluetooth persistent connect for retry timing instead of
/// Android's backoff scheduler (`ReconnectPolicy.nextRetry`). Both the board-ready watchdog
/// (`armBoardReadyTimeout`) and the post-connected stale-telemetry watchdog (`armStaleWatchdog` /
/// `onTelemetryStaleFired`) are ported. iOS has no distinct `Stale` phase: a stale trip routes
/// straight into the shared reconnect path (`.reconnecting`), where Android first transitions
/// through `BoardPhase.Stale`.
internal final class BoardSessionController: VescGattListener {
  static let shared = BoardSessionController()

  var emit: ((String, [String: Any?]) -> Void)?
  var onStateChanged: (() -> Void)?

  private let makeGatt: (VescGattListener, Scheduler) -> VescGattClient
  private lazy var gatt = makeGatt(self, scheduler)
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `transport`
  private var simulatedBoard: SimulatedBoard?
  private let suppliedTransport: SessionTransport?
  private var transport: SessionTransport { simulatedBoard ?? suppliedTransport ?? gatt }
  var replayPlayback: SimulatedBoard? { simulatedBoard }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `remoteTiltController`
  private lazy var remoteTiltController = RemoteTiltController(
    transport: { [weak self] in
      guard let self, self.phase == .connected, let config = self.config else { return nil }
      return config.transport ?? .direct
    },
    send: { [weak self] payload, urgent in
      self?.transport.sendRemoteInput(payload, urgent: urgent) ?? false
    },
    scheduler: scheduler
  )
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardMoveController`
  private lazy var boardMoveController = BoardMoveController(
    transport: { [weak self] in
      guard let self, self.phase == .connected, let config = self.config else { return nil }
      return config.transport ?? .direct
    },
    canMove: { [weak self] in self?.firmwareCommandsTrusted() ?? false },
    generation: { [weak self] in BoardMoveGeneration.forBaseVersion(self?.config?.refloatBaseVersion) },
    send: { [weak self] payload, urgent in
      self?.transport.sendRemoteInput(payload, urgent: urgent) ?? false
    },
    scheduler: scheduler
  )

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `remoteInput`
  private lazy var remoteInput = RemoteInputArbiter(
    tilt: remoteTiltController,
    move: boardMoveController,
    nowMs: { Int64(ProcessInfo.processInfo.systemUptime * 1000) },
    sensorBound: { AccessorySessionController.shared.groundClearanceBound() }
  )
  private lazy var groundClearanceBinding = BoardGroundClearanceBinding(
    remoteInput: remoteInput,
    boundInput: { AccessorySessionController.shared.groundClearanceBound() },
    tiltInput: { AccessorySessionController.shared.groundClearanceTilt() })
  private let connectTimeoutSeconds = 20.0
  private let gattHandshakeDeadline = GattHandshakeDeadline()
  private var connectTimeout: Cancellable?
  /// @platform-diff Android scales this per reconnect attempt (base 4s → 15s cap via
  /// `ReconnectPolicy.boardReadyTimeoutMs`); iOS relies on CoreBluetooth persistent connect and has
  /// no per-attempt counter, so it uses a fixed value matching Android's base.
  private let boardReadyTimeoutSeconds = 4.0
  private let telemetryStaleSeconds = 4.0
  private let linkIntegrityBmsTimeoutSeconds = 12.0
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `LINK_INTEGRITY_CHECK_TIMEOUT_MS`
  private let linkIntegrityCheckTimeoutSeconds = 20.0
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `sendPayloadWithRetry`
  private let sendRetryDelaySeconds = 0.12
  private let configSafetyReadDelaySeconds = 0.4

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
  private let socWindow = SocMedianWindow()
  private lazy var liveSeries = LiveSeriesEmitter(scheduler: scheduler)
  private let bmsSeriesRing = BmsSeriesRing()
  private let cellSpreadDetector = CellSpreadDetector()
  private let batteryConfigMismatchDetector = BatteryConfigMismatchDetector()
  private var bmsSeriesFocused = false
  private let appData: AppDataRepository
  private let scheduler: Scheduler
  private lazy var recordingCoordinator: RecordingCoordinator = {
    let value = RecordingCoordinator(appData: appData)
    value.onFailure = { [weak self] in self?.onStateChanged?() }
    return value
  }()

  func recordingFailure() -> RecordingStorageFailureKind? { RecordingStorageFailure.value() }
  private lazy var configController = ConfigRWController(scheduler: scheduler)
  private lazy var locationTracker = LocationTracker(
    recentWindowMs: { [weak self] in Int64(max(1, self?.config?.liveHistoryLimitMinutes ?? 5)) * 60_000 },
    recordLocation: { [weak self] in self?.recordingCoordinator.recordLocation($0) },
    navigationFix: { location in
      NavigationController.shared.onFix(
        latitude: location.latitude, longitude: location.longitude, speedMps: location.speedMps
      )
    },
    persistLocation: LastGpsLocationPersistence(appData: appData).onLocationUpdated
  )
  private lazy var gpsMonitor = GpsMonitor(
    onLocation: { [weak self] location in self?.onLocationUpdated(location) },
    onAuthorizationResolved: { [weak self] in self?.onStateChanged?() }
  )
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `groupRideObserver`
  private lazy var groupRideObserver = GroupRideObserver(
    emit: { [weak self] event, payload in self?.emit?(event, payload) },
    online: AppStatusCoordinator.shared,
    scheduler: scheduler,
    onCue: { [weak self] cue in
      guard let self else { return }
      self.alertAudioPlayer.playAppCue(cue)
    },
    ownLocation: { [weak self] in
      self?.locationTracker.latestLocation.map { (lat: $0.latitude, lng: $0.longitude) }
    },
    signalContext: { [weak self] in
      self?.riderSignalContext() ?? RiderSignalContext(fix: nil, insidePrivacyZone: true)
    },
    // intentional-suppression: an unreadable credential cannot authenticate buffered positions
    deviceCredential: { try? DeviceCredentialStore.shared.read() },
    onPublicRideDemandChanged: { [weak self] in
      self?.scheduler.post { [weak self] in
        self?.syncPublicRideLink()
        self?.refreshGpsDemand()
      }
    },
    persistPublicRide: { PublicRideStore().write($0) },
    lastKnownLocation: { [weak self] in
      // intentional-suppression: unreadable settings leave look-around without a last position
      guard let settings = try? self?.appData.getSettings(),
            let lat = settings["lastGpsLatitude"] as? Double,
            let lng = settings["lastGpsLongitude"] as? Double
      else { return nil }
      return (lat: lat, lng: lng)
    }
  )

  private var jsObserving = false
  private var removeCredentialListener: (() -> Void)?

  private var groupRidePrivacy = PrivacyZoneReadState()

  private var groupRideTarget: TargetPoint?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `telemetry`
  private var latestTelemetry: RefloatTelemetry?

  private lazy var alertAudioPlayer: AlertAudioPlayer = {
    let player = AlertAudioPlayer()
    player.onDiagnostic = { name, props in DiagnosticsRecorder.shared.record(eventName: name, properties: props) }
    return player
  }()
  private lazy var alertCoordinator = AlertCoordinator(player: alertAudioPlayer)
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `weatherAlerts`
  private lazy var weatherAlerts = WeatherAlertMonitor(
    isLive: { [weak self] in self?.phase == .connected },
    speak: { [weak self] line in self?.alertAudioPlayer.speakAdvisory(line.voiceAnnouncement) }
  )
  private var removeWeatherListener: (() -> Void)?
  private var removeRideNoticesListener: (() -> Void)?
  private var removeLiveActivityNoticesListener: (() -> Void)?
  private var liveActivityNotice: RideNotice?
  private let legalPolicyCatalog = LegalPolicyCatalog()
  private lazy var liveActivity = RideLiveActivityController()
  private lazy var watchMirror = iosWatchMirror(
    scheduler: scheduler,
    snapshot: { [weak self] in self?.watchSnapshot() ?? WatchSnapshot() },
    isStale: { [weak self] in
      guard let self else { return true }
      return latestTelemetry != nil && isTelemetryStale()
    },
    groupFrame: { [weak self] in self?.groupRideFrame() },
    command: { [weak self] in self?.acceptWatchCommand($0) },
    record: { [weak self] in self?.recordWatchDiagnostic($0, $1) },
    onNavigatingChanged: { [weak self] in self?.refreshGpsDemand() }
  )
  private var criticalNotificationFaultCode: Int?
  private var liveBatteryPercent: Int?
  private var liveBatteryVoltage: Double?
  private var liveFaultCode: Int?
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `liveFaultCode`
  private var lastDispatchedFaultCode: Int? = faultCodeUnknown
  private var lastFaultDispatchAtMs: Int64 = 0
  private var lastLiveTelemetryRefreshAt: Int64 = 0
  private let liveTelemetryRefreshMinMs: Int64 = 1000
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

  private var reconnecting = false
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/reconnect/ReconnectScheduler.kt `currentAttempt`
  private var rescanAttempt = 0
  private var failureRetryAttempt = 0
  private var failureRetry: Cancellable?

  private(set) var scanPhase = "idle"
  private(set) var scanError: String?

  private var polling = false
  private let idlePauseDetector = IdlePauseDetector()
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardWarningsEnabled`
  private var boardWarningsEnabled = true
  private var connectionSoundsEnabled = false
  private lazy var pollingLoop = PollingLoop(
    scheduler: scheduler,
    isCurrentSession: { [weak self] in $0 === self?.session },
    sendPayload: { [weak self] payload, session in
      self?.sendPayloadWithRetry(payload, session: session) ?? false
    },
    nowMs: { [weak self] in self?.nowMs() ?? 0 }
  )
  private var staleWorkItem: Cancellable?

  private var latestBatterySoc: Double?
  private var latestBatteryVoltage: Double?
  private var lastBatteryPersistedAt: Int64 = 0

  init(
    appData: AppDataRepository = .shared,
    scheduler: Scheduler = MainQueueScheduler(),
    transport: SessionTransport? = nil,
    makeGatt: @escaping (VescGattListener, Scheduler) -> VescGattClient = {
      VescGattClient(listener: $0, restoreIdentifier: VescGattClient.sessionRestoreIdentifier, scheduler: $1)
    }
  ) {
    self.appData = appData
    self.scheduler = scheduler
    self.suppliedTransport = transport
    self.makeGatt = makeGatt
    removeWeatherListener = WeatherCoordinator.shared.addNativeChangeListener { [weak self] weather in
      self?.weatherAlerts.evaluate(weather)
      Self.storeWeatherObservation(weather)
    }
    liveActivityNotice = RideNotices.shared.current.first
    removeLiveActivityNoticesListener = RideNotices.shared.addListener { [weak self] in
      self?.onRideNoticesChanged($0)
    }
    loadPublicRide()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `storeWeatherObservation`
  private static func storeWeatherObservation(_ weather: Weather) {
    guard let observation = weather.observation else { return }
    let recorder = WeatherObservationRecorder.process
    let ticket = recorder.ticket()
    DispatchQueue.global(qos: .utility).async {
      do { _ = try recorder.record(observation, ticket: ticket) }
      catch { RecordingStorageFailure.report(operation: "weather_observations", category: "write_failed", error: error) }
    }
  }

  deinit {
    removeWeatherListener?()
    removeRideNoticesListener?()
    removeLiveActivityNoticesListener?()
    removeCredentialListener?()
  }

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

  func connect(
    config: BoardConnectConfig,
    onSuccess: @escaping () -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    let replacedReplay = simulatedBoard != nil
    simulatedBoard?.disconnect()
    simulatedBoard = nil
    releaseGpsFromSession(wasReplay: replacedReplay)
    weatherAlerts.rideEnded()
    if config.replay != nil { gatt.disconnect() }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `beginSession`
    if config.replay != nil { locationTracker.resetTrail() }
    simulatedBoard = config.replay.map { spec in
      SimulatedBoard(
        recording: spec.recording,
        warmupMs: spec.warmupMs,
        loop: spec.loop,
        listener: self,
        scheduler: scheduler,
        onLocation: { [weak self] fix in
          guard let self else { return }
          self.onLocationUpdated(self.replayedLocation(fix, atMs: Self.wallMs()))
        },
        onEnded: { [weak self] in self?.endSession(phase: .idle, error: nil) }
      )
    }
    (transport as? VescGattClient)?.recorder = { [weak self] in self?.recordingCoordinator.currentRecorder() }
    batteryEstimator.ensureLoaded()
    liveSeries.emit = { [weak self] name, body in self?.emit?(name, body) }
    liveSeries.generation = { [weak self] in self?.connectionSeq ?? 0 }
    liveSeries.setWindowMinutes(config.liveHistoryLimitMinutes)
    beginSession(config: config, onSuccess: onSuccess, onError: onError)
    armConnectTimeout()
    transport.connect(peripheralId: config.bleId)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `startDebugReplay`
  func startReplay(
    recordingName: String,
    warmupMs: Int64,
    loop: Bool,
    onSuccess: @escaping () -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    let boardId: String
    do {
      guard let selected = try appData.getSettings()["selectedBoardId"] as? String else {
        onError("ERR_NO_BOARD", "Replay runs as the selected Board: select one first")
        return
      }
      boardId = selected
    } catch {
      RecordingStorageFailure.reportRead(operation: "replay_settings_read", error: error)
      onError("APP_STORAGE_READ_FAILED", "Could not read replay settings")
      return
    }
    guard
      let url = ReplayRecordings.url(name: recordingName),
      // intentional-suppression: an unreadable recording is reported as not found
      let jsonl = try? String(contentsOf: url, encoding: .utf8)
    else {
      onError("REPLAY_NOT_FOUND", "Debug recording not found: \(recordingName)")
      return
    }
    let recording = ReplayRecording.parse(name: recordingName, jsonl: jsonl)
    guard var config = BoardConnectConfig.resolve(boardId: boardId, appData: appData, hardware: recording.hardware) else {
      onError("ERR_NO_BOARD", "Board not found: \(boardId)")
      return
    }
    config.replay = ReplaySpec(recording: recording, warmupMs: min(max(0, warmupMs), recording.durationMs), loop: loop)
    connect(config: config, onSuccess: onSuccess, onError: onError)
  }

  @discardableResult
  func stopBoard() -> Bool {
    guard session != nil || pendingResume != nil || SessionResumeStore.shared.pending != nil else { return false }
    endSession(phase: .idle, error: nil)
    return true
  }

  fileprivate var manualStopBoardId: String? {
    config?.appBoardId ?? pendingResume?.appBoardId ?? SessionResumeStore.shared.pending?.appBoardId
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWController.kt `consumeWrite`
  func pushProfileToBoard(
    profileId: String,
    fieldIds: [String],
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
      fieldIds: fieldIds,
      connection: configConnection(config),
      onSuccess: onSuccess,
      onError: onError
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/LiveStateMapper.kt `remoteTiltWire`
  func remoteTiltState() -> [String: Any?]? {
    let phase = remoteTiltController.phase
    if phase == .idle { return nil }
    var wire: [String: Any?] = [
      "value": remoteTiltController.currentValue,
      "phase": phase.wireValue,
      "owner": remoteInput.owner.wire,
    ]
    if let decay = remoteTiltController.decayProgress {
      wire["decay"] = ["elapsedMs": decay.elapsedMs, "totalMs": decay.totalMs]
    }
    return wire
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `startGroundClearanceTilt`
  private func startGroundClearanceTilt(session: BoardSession) {
    let scheduler = scheduler
    groundClearanceBinding.start(
      schedule: { [weak self] tick in
        scheduler.postDelayedForSession(
          session, delayMs: BoardGroundClearanceBinding.tickMs,
          isCurrent: { [weak self] in $0 === self?.session }
        ) { _ in tick() }
      },
      boardInput: { [weak self] in
        guard let self else {
          return BoardGroundClearanceBinding.BoardInput(commandsTrusted: false, telemetryFresh: false)
        }
        return BoardGroundClearanceBinding.BoardInput(
          commandsTrusted: self.firmwareCommandsTrusted(),
          telemetryFresh: self.latestTelemetry != nil && !self.isTelemetryStale())
      })
  }

  private func stopGroundClearanceTilt() {
    groundClearanceBinding.stop()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `groundClearanceTiltState`
  /// @parity /modules/vescape-core/src/index.ts `GroundClearanceTiltState`
  func groundClearanceTiltState() -> [String: Any?] {
    groundClearanceBinding.state()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardLights`
  private var boardLights: BoardLightsState?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `lightsEventBody`
  func lightsEventBody() -> [String: Any?] {
    ["enabled": boardLights?.enabled, "headlightsEnabled": boardLights?.headlightsEnabled]
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `publishBoardLights`
  private func publishBoardLights() {
    emit?("onBoardLights", lightsEventBody())
    pushWatchBoard()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `pushWatchBoard`
  private func pushWatchBoard() {
    watchMirror.pushBoard(
      WatchBoardLights(
        lightsEnabled: boardLights?.enabled,
        headlightsEnabled: boardLights?.headlightsEnabled,
        lightsControllable: firmwareCommandsTrusted() && config != nil
      )
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `watchLightsRelay`
  private lazy var watchLightsRelay = WatchLightsRelay(
    currentLights: { [weak self] in self?.boardLights },
    setLights: { [weak self] enabled, headlights in
      self?.setBoardLights(enabled: enabled, headlightsEnabled: headlights) ?? false
    },
    record: { [weak self] name, props in self?.recordWatchDiagnostic(name, props) }
  )

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardMoveStrengthPercent`
  private var boardMoveStrengthPercent =
    AppDataRepository.boardMoveStrengthPercent(AppDataRepository.defaultSettings["boardMoveStrengthPercent"]) ?? 0

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `watchMoveRelay`
  private lazy var watchMoveRelay = WatchMoveRelay(
    scheduler: scheduler,
    strengthPercent: { [weak self] in self?.boardMoveStrengthPercent ?? 0 },
    startMove: { [weak self] input in self?.startBoardMove(input: input) ?? false },
    stopMove: { [weak self] in self?.stopBoardMove() ?? false },
    record: { [weak self] name, props in self?.recordWatchDiagnostic(name, props) }
  )

  private var watchTiltRefused = false

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `watchTiltLock`
  private func watchTiltLock(_ value: Int) {
    let refused = !lockRemoteTilt(value: value)
    guard refused != watchTiltRefused else { return }
    watchTiltRefused = refused
    recordWatchDiagnostic(refused ? "watch_tilt_refused" : "watch_tilt_locked", ["value": value])
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `watchTiltCancel`
  private func watchTiltCancel() {
    watchTiltRefused = false
    recordWatchDiagnostic("watch_tilt_cancel", ["accepted": stopRemoteTilt()])
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `lightsGeneration`
  private func lightsGeneration() -> BoardLightsGeneration {
    BoardLightsGeneration.forBaseVersion(config?.refloatBaseVersion)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onBoardLightsEcho`
  private func onBoardLightsEcho(_ lights: BoardLightsState) {
    boardLights = lights
    publishBoardLights()
    guard lightsCommandChangesBoardConfig(config?.refloatBaseVersion), let values = boardConfigValues else { return }
    let patched: BoardConfigValues?
    do {
      patched = try values.withLights(enabled: lights.enabled, headlightsEnabled: lights.headlightsEnabled)
    } catch {
      let encodeError = error as? RefloatConfigEncodeException
      recordConnectionDiagnostic(
        "board_lights_write_base_patch_failed",
        operation: "config_rw",
        message: encodeError?.message ?? String(describing: error),
        extra: ["code": encodeError?.code.rawValue]
      )
      // intentional-suppression: provisional values carry no write base, so the encoder is never reached
      patched = try? values.demotedToProvisional().withLights(
        enabled: lights.enabled, headlightsEnabled: lights.headlightsEnabled)
    }
    guard let rebased = patched else { return }
    boardConfigValues = rebased
    guard let boardId = rebased.boardId, let baseVersion = rebased.refloatBaseVersion else { return }
    let patch = rebased.values.filter {
      $0.key == BoardConfigFlagField.ledsOn.id || $0.key == BoardConfigFlagField.headlightsOn.id
    }
    do { try BoardConfigStore.shared.patch(boardId: boardId, refloatBaseVersion: baseVersion, values: patch) }
    catch { RecordingStorageFailure.report(operation: "board_config_patch", category: "write_failed", error: error) }
  }

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
    publishBoardLights()
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setRemoteTilt`
  func setRemoteTilt(value: Int) -> Bool {
    firmwareCommandsTrusted() && remoteInput.manualHold(value)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `lockRemoteTilt`
  func lockRemoteTilt(value: Int) -> Bool {
    firmwareCommandsTrusted() && remoteInput.manualLock(value)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `releaseRemoteTilt`
  func releaseRemoteTilt(value: Int, durationMs: Int64) -> Bool {
    firmwareCommandsTrusted() && remoteInput.manualRelease(value, durationMs: durationMs)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `stopRemoteTilt`
  func stopRemoteTilt() -> Bool {
    remoteInput.cancelTilt()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `startBoardMove`
  func startBoardMove(input: Int) -> Bool {
    remoteInput.startMove(input)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `stopBoardMove`
  func stopBoardMove() -> Bool {
    remoteInput.stopMove()
  }

  private func firmwareCommandsTrusted() -> Bool {
    phase == .connected && linkIntegrity == .trusted
  }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `gpsPhase`
  func gpsPhase() -> String { (simulatedBoard != nil ? GpsPhase.active : gpsMonitor.phase).rawValue }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `gpsMode`
  func gpsMode() -> String { gpsMonitor.mode.rawValue }
  func gpsLatestLocation() -> [String: Any?]? { locationTracker.latestLocation?.map }
  func gpsLatestPreciseLocation() -> [String: Any?]? { locationTracker.latestPreciseLocation?.map }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `riderPosition`
  func riderPosition() -> (latitude: Double, longitude: Double)? {
    guard let location = locationTracker.riderPosition else { return nil }
    return (location.latitude, location.longitude)
  }
  func gpsRecentLocations() -> [[String: Any?]] { locationTracker.recentLocations }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `recentSnapshot`
  func recentTelemetry() -> [[String: Any?]] { liveSeries.recentSnapshot() }
  func gpsLastError() -> String? { gpsError }
  func telemetryRecordingEnabled() -> Bool { recordingCoordinator.telemetryRecordingEnabled }
  func recordingPaused() -> Bool { idlePauseDetector.isPaused }
  func recordingActiveBoardId() -> String? { recordingCoordinator.activeBoardId }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `appVisible`
  var appVisible: Bool = false {
    didSet {
      guard appVisible != oldValue else { return }
      refreshGpsDemand()
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `riding`
  private var riding: Bool {
    guard config != nil, !idlePauseDetector.isPaused else { return false }
    return GpsDemand.ridingThroughDropout(linkLostAtMs: linkLostAtMs, nowMs: nowMs())
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `linkLostAtMs`
  private var linkLostAtMs: Int64?
  private var dropoutGraceTimer: Cancellable?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setLinkLost`
  private func setLinkLost(_ lost: Bool) {
    guard lost else {
      guard linkLostAtMs != nil else { return }
      dropoutGraceTimer?.cancel()
      dropoutGraceTimer = nil
      linkLostAtMs = nil
      refreshGpsDemand()
      return
    }
    guard linkLostAtMs == nil else { return }
    linkLostAtMs = nowMs()
    dropoutGraceTimer?.cancel()
    dropoutGraceTimer = scheduler.postDelayed(RIDE_DROPOUT_GRACE_MS) { [weak self] in
      guard let self else { return }
      self.dropoutGraceTimer = nil
      self.weatherAlerts.rideEnded()
      self.refreshGpsDemand()
    }
    refreshGpsDemand()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `refreshGpsDemand`
  func refreshGpsDemand() {
    let mode = GpsDemand.resolve(
      appVisible: appVisible,
      riding: riding,
      watchNavigating: watchMirror.navigating,
      replayOwnsPosition: simulatedBoard != nil,
      manualPublicRide: groupRideObserver.publicRideNeedsGps
    )
    let wasActive = gpsMonitor.active
    gpsMonitor.apply(mode)
    if config != nil, linkLostAtMs != nil, !riding { alertAudioPlayer.goIdle() }
    if wasActive, mode == .off {
      DispatchQueue.global(qos: .utility).async { TelemetryRepository.shared.flushBlocking() }
    }
    onStateChanged?()
  }

  func stopLocationUpdates() {
    gpsMonitor.stop()
    onStateChanged?()
  }

  func setTelemetryRecordingEnabled(_ enabled: Bool) -> Bool {
    let ok = recordingCoordinator.setTelemetryRecordingEnabled(enabled)
    syncResumeMarkerRecording()
    refreshGpsDemand()
    onStateChanged?()
    return ok
  }

  private func applyAppSoundSettings(_ settings: [String: Any?]) {
    connectionSoundsEnabled = settings["connectionSoundsEnabled"] as? Bool ?? true
    alertAudioPlayer.applySoundSettings(settings)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `consumePendingGroupRideObserve`
  func startGroupRideObserve(_ url: String) {
    do { applyAppSoundSettings(try appData.getSettings()) }
    catch { RecordingStorageFailure.reportRead(operation: "group_ride_sound_settings", error: error) }
    loadPrivacyZones()
    loadGroupRideTarget()
    jsObserving = true
    groupRideObserver.start(url)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `stopGroupRideObserve`
  func stopGroupRideObserve() {
    jsObserving = false
    if groupRideObserver.publicRideNeedsLink { return }
    groupRideObserver.stop()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadPublicRide`
  private func loadPublicRide() {
    // intentional-suppression: an unreadable credential reads as signed out, which keeps the switch off
    let accountId = (try? DeviceCredentialStore.shared.read())?.accountId
    groupRideObserver.loadPublicRide(PublicRideStore().read(), accountId: accountId)
    removeCredentialListener?()
    removeCredentialListener = DeviceCredentialStore.shared.addChangeListener { [weak self] in
      // intentional-suppression: an unreadable credential reads as signed out, which ends the public ride
      let account = (try? DeviceCredentialStore.shared.read())?.accountId
      self?.scheduler.post { self?.groupRideObserver.setAccount(account) }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setPublicRide`
  func setPublicRide(on: Bool, until: Int64?) {
    groupRideObserver.setPublicRide(on ? PublicRideSwitch(on: true, until: until) : .off)
    syncPublicRideLink()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setManualPublicRideSharing`
  func setManualPublicRideSharing(_ enabled: Bool) {
    groupRideObserver.setManualPublicRideSharing(enabled)
  }

  func watchPublicRiders() {
    groupRideObserver.watchPublicRiders()
    syncPublicRideLink()
  }

  func stopWatchingPublicRiders() {
    groupRideObserver.stopWatchingPublicRiders()
    syncPublicRideLink()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `publicRideBoardPhase`
  private func publicRideBoardPhase(_ phase: BoardPhase) {
    let connected: Bool
    switch phase {
    case .connected: connected = true
    case .idle, .error: connected = false
    default: return
    }
    groupRideObserver.setBoardConnected(connected)
    syncPublicRideLink()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `syncPublicRideLink`
  /// @platform-diff The observer applies changes inline on the main thread here, so nothing is
  /// posted; Android posts behind its handler queue.
  private func syncPublicRideLink() {
    let needed = groupRideObserver.publicRideNeedsLink
    if needed && !groupRideObserver.active {
      loadPrivacyZones()
      loadGroupRideTarget()
      groupRideObserver.start(GroupRideOnlineGate.webSocketUrl(serverBaseUrl: AppStatusCoordinator.serverBaseUrl))
    } else if !needed && !jsObserving && groupRideObserver.active {
      groupRideObserver.stop()
    }
  }

  func sendGroupRideSignal(_ kind: String) {
    groupRideObserver.sendSignal(kind)
  }

  func clearGroupRideSignal() {
    groupRideObserver.clearSignal()
  }

  func sendGroupRideHazard(_ kind: String) {
    groupRideObserver.sendHazard(kind)
  }

  func clearGroupRideHazard() {
    groupRideObserver.clearHazard()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `latestRiderPresence`
  private func latestRiderPresence() -> RiderPresence? {
    guard let location = groupRidePrivacy.presenceFix(locationTracker.latestPreciseLocation ?? locationTracker.latestLocation)
    else { return nil }
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
      target: groupRideTarget,
      atMs: location.timestamp
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `riderSignalContext`
  private func riderSignalContext() -> RiderSignalContext {
    groupRidePrivacy.signalContext(locationTracker.latestLocation, nowMs: Int64(Date().timeIntervalSince1970 * 1000))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `readPhoneBattery`
  func readPhoneBattery() -> Double? {
    UIDevice.current.isBatteryMonitoringEnabled = true
    let level = UIDevice.current.batteryLevel
    return level < 0 ? nil : Double(level)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadPrivacyZones`
  func loadPrivacyZones() {
    do {
      try groupRidePrivacy.reload { try appData.getEnabledPrivacyZoneEntities() }
    }
    catch {
      RecordingStorageFailure.reportRead(operation: "group_ride_privacy_zones_read", error: error)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadGroupRideTarget`
  func loadGroupRideTarget() {
    do { groupRideTarget = try appData.getDirectionPoint().map { TargetPoint(lat: $0.latitude, lng: $0.longitude) } }
    catch {
      RecordingStorageFailure.reportRead(operation: "group_ride_target_read", error: error)
      return
    }
    latestRiderPresence().map(groupRideObserver.pushPresence)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `isTelemetryStale`
  private func isTelemetryStale(now: Int64 = BoardSessionController.wallMs()) -> Bool {
    now - (lastTelemetryAt ?? 0) >= Int64(telemetryStaleSeconds * 1000)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadAlertRules`
  func reloadAlertRules() {
    guard let boardId = config?.appBoardId else {
      alertCoordinator.replaceRules([])
      return
    }
    let board: [String: Any?]?
    let settings: [String: Any?]
    do { board = try appData.getBoard(boardId); settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "alert_settings_read", error: error)
      return
    }
    let enabled = ((board?["legalMode"] ?? nil) as? [String: Any])?["enabled"] as? Bool ?? false
    let jurisdictionCode =
      ((settings["legalPolicy"] ?? nil) as? [String: Any])?["jurisdictionCode"] as? String
    let speeds = jurisdictionCode.flatMap(legalPolicyCatalog.speeds)
    let alertRules: [AlertRule]
    do { alertRules = try appData.getEnabledAlertRules(boardId) }
    catch { RecordingStorageFailure.reportRead(operation: "enabled_alert_rules_read", error: error); return }
    alertCoordinator.replaceRules(withLegalModeOverlay(
      alertRules,
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `reloadBoardDataForActiveBoard`
  func reloadBoardDataForActiveBoard() {
    guard let current = config else { return }
    let board: [String: Any?]
    do { guard let stored = try appData.getBoard(current.appBoardId) else { return }; board = stored }
    catch {
      RecordingStorageFailure.reportRead(operation: "active_board_read", error: error)
      return
    }
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `loadTelemetrySettings`
  func reloadTelemetrySettings() {
    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "telemetry_settings_read", error: error)
      return
    }
    applyAppSoundSettings(settings)
    guard let current = config else { return }
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
    let warningsWereEnabled = boardWarningsEnabled
    let collectionWasEnabled = VescFaultCoordinator.shared.collectionEnabled
    let collectionEnabled = settings["vescFaultCollectionEnabled"] as? Bool ?? true
    VescFaultCoordinator.shared.collectionEnabled = collectionEnabled
    VescFaultCaptureCoordinator.shared.setCollectionEnabled(collectionEnabled)
    if !collectionWasEnabled, collectionEnabled {
      lastDispatchedFaultCode = faultCodeUnknown
      lastFaultDispatchAtMs = 0
    }
    boardWarningsEnabled = settings["boardWarningsEnabled"] as? Bool ?? true
    weatherAlerts.settings = WeatherAlertSettings(settings: settings)
    alertCoordinator.distanceUnit = settings["distanceUnit"] as? String ?? "km"
    alertCoordinator.temperatureUnit = settings["temperatureUnit"] as? String ?? "celsius"
    if !warningsWereEnabled, boardWarningsEnabled, lastEmittedLinkIntegrity == .trusted {
      if let values = boardConfigValues, values.freshness == .fresh {
        evaluateConfigSafety(values)
      } else {
        boardConfigReadScheduled = false
        scheduleBoardConfigRead()
      }
    }
    pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
    liveSeries.setWindowMinutes(liveHistoryLimit)
    socWindow.windowMs = Int64(AppDataRepository.intValue(settings["socEstimateWindowSeconds"] ?? nil) ?? 20) * 1000
    recordingCoordinator.applySettings(settings)
    locationTracker.pruneRecentLocations(now: nowMs())
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `previewAlertSound`
  func previewAlertSound(_ spec: String) {
    do {
      let settings = try appData.getSettings()
      alertAudioPlayer.applySoundSettings(settings)
      alertAudioPlayer.preview(
        spec: spec,
        distanceUnit: settings["distanceUnit"] as? String ?? "km",
        temperatureUnit: settings["temperatureUnit"] as? String ?? "celsius"
      )
    } catch { RecordingStorageFailure.reportRead(operation: "alert_preview_settings", error: error) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `previewWeatherAlert`
  func previewWeatherAlert(_ line: WeatherAlertLine) {
    do { alertAudioPlayer.applySoundSettings(try appData.getSettings()) }
    catch { RecordingStorageFailure.reportRead(operation: "alert_preview_settings", error: error) }
    alertAudioPlayer.speakVoice(line.voiceAnnouncement)
  }

  func playPackSound(pack: String, slot: String) {
    alertAudioPlayer.playPackSound(pack: pack, slot: slot)
  }

  func startGeigerSimulation(spec: String, rangeDepth: Double) {
    do { alertAudioPlayer.applySoundSettings(try appData.getSettings()) }
    catch { RecordingStorageFailure.reportRead(operation: "geiger_preview_settings", error: error) }
    alertAudioPlayer.updateGeiger(ruleId: geigerSimulationId, spec: spec, rangeDepth: rangeDepth)
  }

  func stopGeigerSimulation() {
    alertAudioPlayer.stopGeiger(ruleId: geigerSimulationId)
  }

  private let geigerSimulationId = "vescape.preview.geiger"

  private var pendingResume: SessionResumeMarker?
  private var pendingResumeExpiry: Cancellable?
  private let pendingResumeWindowSeconds = 15.0

  func prepareForLaunch() {
    guard session == nil, pendingResume == nil else { return }
    guard let marker = SessionResumeStore.shared.pending else { return }
    pendingResume = marker
    pendingResumeExpiry = scheduler.postDelayed(Int64(pendingResumeWindowSeconds * 1000)) {
      [weak self] in self?.expirePendingResume()
    }
    _ = gatt
  }

  private func expirePendingResume() {
    pendingResumeExpiry = nil
    guard pendingResume != nil, session == nil else {
      pendingResume = nil
      return
    }
    pendingResume = nil
    reapOrphanLiveActivities()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/AutoConnectProvider.kt
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `autoConnectSelectedBoard`
  func autoConnectSelectedBoard() {
    let settings: [String: Any?]
    do { settings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "auto_connect_settings_read", error: error)
      return
    }
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
      guard self.session == nil, self.pendingResume == nil else {
        NSLog("[VescAutoConnect] aborted on main queue: session adopted between launch and connect")
        return
      }
      guard !ManualBoardStop.isAutoStartSuppressed(boardId: boardId) else { return }
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

  private func resumeSession(marker: SessionResumeMarker, restoredPeripheralIds: [String]) {
    guard session == nil else { return }
    guard let config = BoardConnectConfig.resolve(boardId: marker.appBoardId, appData: appData) else {
      SessionResumeStore.shared.clear()
      clearPendingResume()
      reapOrphanLiveActivities()
      return
    }
    gatt.recorder = { [weak self] in self?.recordingCoordinator.currentRecorder() }
    batteryEstimator.ensureLoaded()
    liveSeries.emit = { [weak self] name, body in self?.emit?(name, body) }
    liveSeries.generation = { [weak self] in self?.connectionSeq ?? 0 }
    liveSeries.setWindowMinutes(config.liveHistoryLimitMinutes)
    if marker.recordingActive {
      _ = recordingCoordinator.setTelemetryRecordingEnabled(true)
    }
    beginSession(
      config: config,
      resume: true,
      onSuccess: {},
      onError: { _, _ in }
    )
    let restoredId = restoredPeripheralIds.first {
      $0.caseInsensitiveCompare(config.bleId) == .orderedSame
    }
    armConnectTimeout()
    if let restoredId, gatt.adoptRestored(peripheralId: restoredId) {
      recordConnectionDiagnostic(
        "session_restored",
        operation: "connect",
        message: "Board Session resumed from CoreBluetooth state restoration",
        extra: ["recording_active": marker.recordingActive]
      )
    } else {
      recordConnectionDiagnostic(
        "session_restored",
        operation: "connect",
        message: "Board Session resumed without a restored peripheral",
        extra: ["recording_active": marker.recordingActive]
      )
      transport.connect(peripheralId: config.bleId)
    }
    clearPendingResume()
  }

  private func syncResumeMarkerRecording() {
    guard session != nil, simulatedBoard == nil else { return }
    SessionResumeStore.shared.setRecording(
      active: recordingCoordinator.telemetryRecordingEnabled
    )
  }

  private func beginSession(
    config: BoardConnectConfig,
    resume: Bool = false,
    onSuccess: @escaping () -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    gattHandshakeDeadline.reset()
    failureRetryAttempt = 0
    faultLogReader?.cancel()
    faultLogReader = nil
    session?.invalidate()
    stopPolling()
    stopReconnect()
    configController.onSessionTerminated("Board session replaced", connection: fallbackConfigRWConnection())
    reassembler.reset()

    sessionSequence += 1
    session = BoardSession(id: sessionSequence)
    socWindow.reset()
    bmsSeriesRing.clear()
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
    boardConfigValues = restoredBoardConfigValues(config)
    if let restored = boardConfigValues { syncBoardLightsFromConfig(restored) }
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `restoreMotorConfigValues`
    do { motorConfigValues = try MotorConfigStore.shared.loadLatest(boardId: config.appBoardId) }
    catch { RecordingStorageFailure.reportRead(operation: "motor_config_restore", error: error); motorConfigValues = nil }
    alertCoordinator.updateBoardConfigValues(boardConfigValues?.values ?? [:])
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `connectSelectedBoard`
    if simulatedBoard == nil {
      ManualBoardStop.clearAutoStartSuppression()
    }
    if let session {
      lastEmittedLinkIntegrity = session.startLinkIntegrityCheck(expected: config.linkIdentity())
    }
    let sessionSettings: [String: Any?]
    do { sessionSettings = try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: "session_settings_read", error: error)
      return
    }
    VescFaultCoordinator.shared.collectionEnabled = sessionSettings["vescFaultCollectionEnabled"] as? Bool ?? true
    wireFaultCaptures()
    boardWarningsEnabled = sessionSettings["boardWarningsEnabled"] as? Bool ?? true
    weatherAlerts.settings = WeatherAlertSettings(settings: sessionSettings)
    connectionSoundsEnabled = sessionSettings["connectionSoundsEnabled"] as? Bool ?? true
    alertCoordinator.distanceUnit = sessionSettings["distanceUnit"] as? String ?? "km"
    alertCoordinator.temperatureUnit = sessionSettings["temperatureUnit"] as? String ?? "celsius"
    alertAudioPlayer.applySoundSettings(sessionSettings)
    alertAudioPlayer.wake()
    recordingCoordinator.beginBoardSession(config: config)
    beginGpsSessionDiagnostics()
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt
    BoardWarningRegistry.shared.beginSession(config.appBoardId)
    BoardWarningRegistry.shared.onManualClear = { [weak self] boardId, kind in
      DispatchQueue.main.async { self?.onWarningManuallyCleared(boardId: boardId, kind: kind) }
    }
    BoardWarningFailureReporter.shared.beginSession()
    linkLostAtMs = nil
    dropoutGraceTimer?.cancel()
    dropoutGraceTimer = nil
    refreshGpsDemand()
    let board: [String: Any?]?
    do { board = try appData.getBoard(config.appBoardId) }
    catch {
      RecordingStorageFailure.reportRead(operation: "session_board_read", error: error)
      return
    }
    let legalModeEnabled = ((board?["legalMode"] ?? nil) as? [String: Any])?["enabled"] as? Bool ?? false
    let jurisdictionCode =
      ((sessionSettings["legalPolicy"] ?? nil) as? [String: Any])?["jurisdictionCode"] as? String
    let legalSpeeds = jurisdictionCode.flatMap(legalPolicyCatalog.speeds)
    let alertRules: [AlertRule]
    do { alertRules = try appData.getEnabledAlertRules(config.appBoardId) }
    catch { RecordingStorageFailure.reportRead(operation: "enabled_alert_rules_read", error: error); return }
    alertCoordinator.replaceRules(withLegalModeOverlay(
      alertRules,
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
    lastDispatchedFaultCode = faultCodeUnknown
    lastFaultDispatchAtMs = 0
    lastLiveTelemetryRefreshAt = 0
    if let simulatedBoard, let spec = config.replay { prefillReplayWarmup(simulatedBoard, warmupMs: spec.warmupMs) }
    setPhase(.connecting)
    if let session {
      updateLinkIntegrity(session.markOutdatedIfIncomplete(expected: config.linkIdentity()))
    }
    if simulatedBoard == nil {
      SessionResumeStore.shared.save(
        appBoardId: config.appBoardId,
        bleId: config.bleId,
        recordingActive: recordingCoordinator.telemetryRecordingEnabled
      )
    }
    if resume || !appIsForeground {
      liveActivity.resume(state: currentLiveState())
    } else {
      liveActivity.start(state: currentLiveState())
    }
  }

  private func endSession(phase: BoardPhase, error: String?) {
    let wasReplay = simulatedBoard != nil
    SessionResumeStore.shared.clear()
    clearPendingResume()
    stopGroundClearanceTilt()
    remoteInput.reset()
    persistLastBattery(percent: latestBatterySoc, voltage: latestBatteryVoltage, now: nowMs(), force: true)
    latestBatterySoc = nil
    latestTelemetry = nil
    latestBatteryVoltage = nil
    socWindow.reset()
    bmsSeriesRing.clear()
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
    boardConfigValues = nil
    motorConfigValues = nil
    motorConfigRequested = false
    watchMoveRelay.cancel()
    boardLights = nil
    publishBoardLights()
    recordingCoordinator.finishBoardSession(
      status: error == nil ? "stopped" : "disconnected",
      markerType: error == nil ? "disconnect" : "error"
    )
    stopPolling()
    stopReconnect()
    configController.onSessionTerminated(error ?? "Board session ended", connection: fallbackConfigRWConnection())
    alertCoordinator.stopAllGeiger()
    alertAudioPlayer.goIdle()
    transport.disconnect()
    simulatedBoard = nil
    reassembler.reset()
    connectedBoardId = nil
    bleId = nil
    boardName = nil
    boardError = error
    lastTelemetryAt = nil
    releaseGpsFromSession(wasReplay: wasReplay)
    weatherAlerts.rideEnded()
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `armConnectPhaseTimeout`
  private func armConnectTimeout(timeoutSeconds: Double? = nil) {
    connectTimeout?.cancel()
    guard let token = session else { return }
    let timeoutSeconds = timeoutSeconds ?? connectTimeoutSeconds
    connectTimeout = scheduler.postDelayedForSession(
      token,
      delayMs: Int64(timeoutSeconds * 1000),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] _ in
      guard let self else { return }
      let stuckPhase = self.phase
      if stuckPhase == .connecting || stuckPhase == .discovering || stuckPhase == .subscribing {
        self.recordConnectionDiagnostic(
          "connect_phase_timeout",
          operation: "connect",
          message: "BLE connect phase timed out",
          extra: [
            "connect_phase": stuckPhase.rawValue,
            "timeout_ms": Int(timeoutSeconds * 1000),
          ]
        )
        if stuckPhase == .discovering || stuckPhase == .subscribing {
          self.gattHandshakeDeadline.timedOut()
        }
        self.beginReconnect(restartTransport: true)
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `armBoardReadyTimeout`
  private func armBoardReadyTimeout(session: BoardSession) {
    scheduler.postDelayedForSession(
      session,
      delayMs: Int64(boardReadyTimeoutSeconds * 1000),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] _ in
      guard let self else { return }
      guard self.phase == .waitingForTelemetry, self.lastTelemetryAt == nil else { return }
      self.recordConnectionDiagnostic(
        "board_ready_timeout",
        operation: "connect",
        message: "Board telemetry unavailable before ready timeout",
        extra: ["timeout_ms": Int(self.boardReadyTimeoutSeconds * 1000)]
      )
      self.beginReconnect(restartTransport: true)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryPipeline.kt `armStaleWatchdog`
  private func armStaleWatchdog(session: BoardSession) {
    staleWorkItem?.cancel()
    let armedAt = lastTelemetryAt
    staleWorkItem = scheduler.postDelayedForSession(
      session,
      delayMs: Int64(telemetryStaleSeconds * 1000),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] _ in
      guard let self else { return }
      self.staleWorkItem = nil
      self.onTelemetryStaleFired(armedAt: armedAt)
    }
  }

  private func cancelStaleWatchdog() {
    staleWorkItem?.cancel()
    staleWorkItem = nil
  }

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
    beginReconnect(restartTransport: true)
  }

  private func setPhase(_ phase: BoardPhase) {
    guard self.phase != phase else { return }
    self.phase = phase
    publicRideBoardPhase(phase)
    pushWatchBoard()
    recordingCoordinator.recordState(phase.rawValue)
    onStateChanged?()
    refreshLiveActivity()
  }

  private func fail(code: String, message: String) {
    let wasReplay = simulatedBoard != nil
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
    stopPolling()
    stopReconnect()
    configController.onSessionTerminated(message, connection: fallbackConfigRWConnection())
    alertCoordinator.stopAllGeiger()
    alertAudioPlayer.goIdle()
    transport.disconnect()
    simulatedBoard = nil
    releaseGpsFromSession(wasReplay: wasReplay)
    weatherAlerts.rideEnded()
    endLiveActivity()
    emit?("onError", ["message": message])
    setPhase(.error)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `scheduleAutoReconnect`
  private func beginReconnect(restartTransport: Bool = false, retryDelayMs: Int = 0) {
    guard let config else { return }
    failureRetry?.cancel()
    failureRetry = nil
    settleConnect(success: false, code: "RECONNECTING", message: "Board unavailable — retrying")
    let wasConnected = phase == .connected
    recordConnectionDiagnostic(
      "ble_disconnected_unexpectedly",
      operation: "connect",
      message: "Board disconnected unexpectedly"
    )
    if wasConnected { alertAudioPlayer.boardDisconnected(playCue: connectionSoundsEnabled) }
    session?.invalidate()
    connectTimeout?.cancel()
    connectTimeout = nil
    stopPolling()
    configController.onSessionTerminated("Board connection lost", connection: fallbackConfigRWConnection())
    resetIdlePause()
    reassembler.reset()
    socWindow.reset()
    bmsSeriesRing.clear()
    boardConfigValues = boardConfigValues?.demotedToProvisional()
    boardLights = nil
    publishBoardLights()
    boardConfigReadScheduled = false
    motorConfigValues = motorConfigValues?.demotedToLastKnown()
    motorConfigRequested = false

    sessionSequence += 1
    session = BoardSession(id: sessionSequence)
    reconnecting = true
    boardError = nil
    lastTelemetryAt = nil
    rescanAttempt = 0
    setLinkLost(true)
    setPhase(.reconnecting)
    if retryDelayMs > 0, let session {
      transport.disconnect()
      failureRetry = scheduler.postDelayedForSession(
        session,
        delayMs: Int64(retryDelayMs),
        isCurrent: { [weak self] in $0 === self?.session }
      ) { [weak self] session in
        guard let self else { return }
        self.failureRetry = nil
        self.transport.connect(peripheralId: config.bleId)
        self.scheduleRescanCycle(session: session)
      }
      return
    }
    if restartTransport {
      transport.connect(peripheralId: config.bleId)
    } else {
      transport.reconnect()
    }
    if let session { scheduleRescanCycle(session: session) }
  }

  private func scheduleRescanCycle(session: BoardSession) {
    guard reconnecting, session === self.session, session.isActive else { return }
    rescanAttempt += 1
    setPhase(.rescanning)
    transport.startReconnectScan()
    scheduler.postDelayedForSession(
      session,
      delayMs: Int64(rescanWindowMs),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] session in
      guard let self, self.reconnecting else { return }
      self.transport.stopReconnectScan()
      if self.phase == .rescanning { self.setPhase(.reconnecting) }
      self.scheduler.postDelayedForSession(
        session,
        delayMs: Int64(self.rescanIdleMs),
        isCurrent: { [weak self] in $0 === self?.session }
      ) { [weak self] session in
        self?.scheduleRescanCycle(session: session)
      }
    }
  }

  private func stopReconnect() {
    failureRetry?.cancel()
    failureRetry = nil
    guard reconnecting else { return }
    reconnecting = false
    rescanAttempt = 0
    transport.stopReconnectScan()
  }

  private var appIsForeground: Bool {
    UIApplication.shared.applicationState == .active
  }

  private var rescanWindowMs: Int { ReconnectPolicy.rescanWindowMs }

  private var rescanIdleMs: Int {
    ReconnectPolicy.rescanIdleMs(attempt: rescanAttempt, appForeground: appIsForeground)
  }

  func onDeviceDiscovered(id: String, name: String, rssi: Int, serviceUUIDs: [String]) {
    emit?("onDevice", [
      "id": id,
      "name": name,
      "rssi": rssi,
      "serviceUUIDs": serviceUUIDs,
    ])
  }

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
    stopReconnect()
    recordConnectionDiagnostic("gatt_connected", operation: "connect", message: "GATT connected")
    setPhase(.discovering)
    armConnectTimeout(timeoutSeconds: Double(gattHandshakeDeadline.timeoutMs) / 1000)
  }

  func onGattSubscribing() {
    guard session != nil else { return }
    setPhase(.subscribing)
  }

  func onGattReady() {
    guard let session else { return }
    connectTimeout?.cancel()
    connectTimeout = nil
    boardError = nil
    recordConnectionDiagnostic("gatt_ready", operation: "connect", message: "GATT ready")
    setPhase(.waitingForTelemetry)
    settleConnect(success: true, code: nil, message: nil)
    startPolling(session: session)
  }

  func onGattFailure(code: String, message: String) {
    guard session != nil else { return }
    guard code != "INVALID_DEVICE" else {
      fail(code: code, message: message)
      return
    }
    guard failureRetry == nil else { return }
    recordConnectionDiagnostic(
      "ble_connect_failed",
      operation: "connect",
      message: message,
      extra: ["error_code": code]
    )
    failureRetryAttempt = min(failureRetryAttempt + 1, ReconnectPolicy.slowAfterAttempts + 1)
    beginReconnect(
      restartTransport: true,
      retryDelayMs: ReconnectPolicy.failureRetryDelayMs(attempt: failureRetryAttempt, appForeground: appIsForeground)
    )
  }

  func onGattDisconnected(intentional: Bool, message: String) {
    if intentional { return }
    guard session != nil else { return }
    beginReconnect()
  }

  func onGattFrameChunk(_ chunk: [UInt8]) {
    guard session != nil else { return }
    recordingCoordinator.recordChunk(direction: "rx", bytes: chunk)
    for payload in reassembler.feed(chunk) {
      handlePayload(payload)
    }
  }

  private func handlePayload(_ payload: [UInt8]) {
    guard let session, session.isActive else { return }
    _ = handleLinkIntegrityRefloat(payload)
    if let config, configController.onPayload(payload, connection: configConnection(config)) {
      return
    }
    guard !payload.isEmpty else { return }
    switch Int(payload[0]) {
    case COMM_CUSTOM_APP_DATA:
      if let lights = parseLightsControlResponse(payload) {
        onBoardLightsEcho(lights)
        return
      }
      handleTelemetry(payload, session: session)
    case COMM_FW_VERSION:
      handleFwVersion(payload)
    case COMM_BMS_GET_VALUES:
      handleBms(payload)
    case COMM_FORWARD_CAN where payload.count >= 5 && Int(payload[2]) == COMM_CUSTOM_APP_DATA:
      if let lights = parseLightsControlResponse(payload) {
        onBoardLightsEcho(lights)
      }
    case COMM_FORWARD_CAN where payload.count >= 3 && Int(payload[2]) == COMM_BMS_GET_VALUES:
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
      pullRateHz: pollingLoop.measuredRateHz()
    ) else { return }

    pollingLoop.onResponse()
    lastTelemetryAt = now
    armStaleWatchdog(session: session)
    markBoardReady()
    startLinkIntegrityProbe(session: session)
    if telemetry.hasFault {
      AccessorySessionController.shared.setRiding(false)
      AccessorySessionController.shared.clearLightTelemetry()
      onRefloatFaultFrame(telemetry.faultCode)
      return
    }
    onRefloatNormalFrame()
    emitTelemetry(telemetry)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `handleBmsPayload`
  private func handleBms(_ payload: [UInt8]) {
    guard let bms = parseBmsValues(payload, packetAt: nowMs()) else { return }
    if let session, let config {
      updateLinkIntegrity(session.observeBms(expected: config.linkIdentity()))
    }
    emit?("onBms", bms.toMap())
    evaluateCellSpread(bms)
    evaluateBatteryConfigMismatch(bms)
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateCellSpread`
  private func evaluateCellSpread(_ bms: BmsTelemetry) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    let finding: CellSpreadFinding
    do {
      guard let value = try cellSpreadDetector.onFrame(
        cellVoltages: bms.cellVoltages, balancing: bms.balancing,
        vCharge: bms.vCharge, atMs: bms.capturedAt
      ) else { return }
      finding = value
    } catch {
      UnexpectedNativeError.report(operation: "cell_spread_payload_encode", category: "serialization", error: error)
      return
    }
    BoardWarningRegistry.shared.reportFinding(
      boardId: boardId,
      kind: BoardWarningKind.cellSpread,
      severity: finding.severity,
      payloadJson: finding.payloadJson
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateBatteryConfigMismatch`
  private func evaluateBatteryConfigMismatch(_ bms: BmsTelemetry) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    let seriesCount = config?.batteryConfig?["seriesCount"] as? Int
    let payloadJson: String
    do {
      guard let value = try batteryConfigMismatchDetector.onFrame(
        bmsCellCount: bms.cellVoltages.count, configuredSeries: seriesCount
      ) else { return }
      payloadJson = value
    } catch {
      UnexpectedNativeError.report(operation: "battery_mismatch_payload_encode", category: "serialization", error: error)
      return
    }
    BoardWarningRegistry.shared.reportFinding(
      boardId: boardId,
      kind: BoardWarningKind.batteryConfigMismatch,
      severity: .warn,
      payloadJson: payloadJson
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onBoardConfigValues`
  private func onBoardConfigValues(_ values: BoardConfigValues, origin: BoardConfigOperationOrigin) {
    guard values.boardId == config?.appBoardId, linkIntegrity == .trusted else { return }
    boardConfigValues = values
    syncBoardLightsFromConfig(values)
    alertCoordinator.updateBoardConfigValues(values.values)
    do {
      if origin == .freshRead { try BoardConfigStore.shared.saveFresh(values) }
      else { try BoardConfigStore.shared.save(values) }
    } catch { RecordingStorageFailure.report(operation: "board_config_save", category: "write_failed", error: error) }
    evaluateConfigSafety(values)
  }

  private func restoredBoardConfigValues(_ config: BoardConnectConfig) -> BoardConfigValues? {
    guard let base = config.refloatBaseVersion else { return nil }
    do { return try BoardConfigStore.shared.load(boardId: config.appBoardId, refloatBaseVersion: base) }
    catch { RecordingStorageFailure.reportRead(operation: "board_config_restore", error: error); return nil }
  }

  private func clearBoardConfigValues() {
    boardConfigValues = nil
    motorConfigValues = nil
    alertCoordinator.updateBoardConfigValues([:])
    guard let boardId = config?.appBoardId else { return }
    do { try BoardConfigStore.shared.clear(boardId: boardId) }
    catch { RecordingStorageFailure.report(operation: "board_config_clear", category: "write_failed", error: error) }
    do { try MotorConfigStore.shared.clear(boardId: boardId) }
    catch { RecordingStorageFailure.report(operation: "motor_config_clear", category: "write_failed", error: error) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `evaluateConfigSafety`
  private func evaluateConfigSafety(_ values: BoardConfigValues) {
    guard boardWarningsEnabled, let boardId = config?.appBoardId else { return }
    let seriesCount = config?.batteryConfig?["seriesCount"] as? Int
    let perCellSupported = ConfigSafetyDetector.supportsPerCellVoltage(vescLiveFirmware)
    let report: ConfigSafetyReport
    do { report = try ConfigSafetyDetector.evaluate(values, seriesCount: seriesCount, perCell: perCellSupported) }
    catch {
      UnexpectedNativeError.report(operation: "config_safety_payload_encode", category: "serialization", error: error)
      return
    }
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
    for wire in BoardWarningKind.retiredWire {
      BoardWarningRegistry.shared.reportCleanEvaluation(boardId: boardId, kind: wire)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onWarningManuallyCleared`
  private func onWarningManuallyCleared(boardId: String, kind: String?) {
    guard config?.appBoardId == boardId else { return }
    if kind == nil || kind == BoardWarningKind.cellSpread.rawValue { cellSpreadDetector.reset() }
    if kind == nil || kind == BoardWarningKind.batteryConfigMismatch.rawValue {
      batteryConfigMismatchDetector.reset()
    }
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `requestMotorConfig`
  private func requestMotorConfig(_ session: BoardSession) {
    guard session === self.session, session.isActive, !motorConfigRequested, let config else { return }
    motorConfigRequested = true
    _ = transport.sendPayload(config.transport.frame([UInt8(COMM_GET_MCCONF)]))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `handleMcconfPayload`
  private func handleMcconfPayload(_ body: [UInt8]) {
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
      do { try MotorConfigStore.shared.saveFresh(decoded) }
      catch { RecordingStorageFailure.report(operation: "motor_config_save", category: "write_failed", error: error) }
      NSLog("MCCONF decoded: \(firmware) signature=\(signature) fields=\(values.count)")
    case .unknownSignature(let signature, let byteCount):
      motorConfigValues = nil
      NSLog("MCCONF signature \(signature) has no layout (\(byteCount) bytes)")
    case .malformed(let reason):
      motorConfigValues = nil
      NSLog("MCCONF malformed: \(reason)")
    }
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `setLiveSeriesMetrics`
  func setLiveSeriesMetrics(_ metrics: [String]) {
    liveSeries.setLiveMetrics(metrics)
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
    sendPayloadWithRetry(config.transport.frame([UInt8(COMM_FW_VERSION)]), session: session)
    sendPayloadWithRetry(RefloatConfigProtocol.buildGetInfo(transport: config.transport), session: session)
    if config.hasBms == true {
      scheduler.postDelayedForSession(
        session,
        delayMs: Int64(linkIntegrityBmsTimeoutSeconds * 1000),
        isCurrent: { [weak self] in $0 === self?.session }
      ) { [weak self] session in
        guard let self, let config = self.config else { return }
        self.updateLinkIntegrity(session.markBmsMissing(expected: config.linkIdentity()))
      }
    }
    scheduler.postDelayedForSession(
      session,
      delayMs: Int64(linkIntegrityCheckTimeoutSeconds * 1000),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] session in
      guard let self else { return }
      self.updateLinkIntegrity(session.markCheckTimedOut())
    }
  }

  private var lastEmittedLinkIntegrity: LinkIntegrity = .unknown
  private var boardConfigReadScheduled = false
  private var motorConfigRequested = false

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `motorConfigValues`
  private var motorConfigValues: MotorConfigValues? {
    didSet {
      let motorValues: [String: Any] = motorConfigValues?.values ?? [:]
      alertCoordinator.updateMotorConfigValues(motorValues)
      emit?("onMotorConfigValues", ["values": motorConfigValues?.toBridgeMap()])
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `motorConfigValuesMap`
  func motorConfigValuesMap() -> [String: Any?]? {
    motorConfigValues?.toBridgeMap()
  }
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardConfigValues`
  private var boardConfigValues: BoardConfigValues? {
    didSet { emit?("onBoardConfigValues", ["values": boardConfigValues?.toBridgeMap()]) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `boardConfigValuesMap`
  func boardConfigValuesMap() -> [String: Any?]? {
    boardConfigValues?.toBridgeMap()
  }
  private var vescLiveFirmware: String?

  private func updateLinkIntegrity(_ next: LinkIntegrity) {
    guard next != lastEmittedLinkIntegrity else { return }
    lastEmittedLinkIntegrity = next
    onStateChanged?()
    pushWatchBoard()
    if next == .trusted { scheduleBoardConfigRead() }
    if next == .mismatched { clearBoardConfigValues() }
  }

  private func scheduleBoardConfigRead() {
    guard !boardConfigReadScheduled, let session else { return }
    boardConfigReadScheduled = true
    scheduler.postDelayedForSession(
      session,
      delayMs: Int64(configSafetyReadDelaySeconds * 1000),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] session in
      guard let self else { return }
      self.triggerBoardConfigRead(session)
    }
  }

  private func markBoardReady() {
    guard phase == .waitingForTelemetry else { return }
    gattHandshakeDeadline.reset()
    failureRetryAttempt = 0
    boardError = nil
    recordConnectionDiagnostic("board_ready", operation: "connect", message: "Board telemetry received")
    if let config {
      recordingCoordinator.markBoardReady(config: config)
      syncResumeMarkerRecording()
    }
    alertAudioPlayer.wake()
    alertAudioPlayer.boardConnected(playCue: connectionSoundsEnabled)
    setLinkLost(false)
    setPhase(.connected)
    WeatherCoordinator.shared.refresh()
  }

  private func emitTelemetry(_ telemetry: RefloatTelemetry) {
    var tick = telemetry.toMap()
    let batteryPercent = batteryEstimator.estimateBatteryPercent(
      voltageV: telemetry.batteryVoltage,
      config: config?.batteryConfig,
      batteryCurrentA: telemetry.batteryCurrent
    )
    let batteryEstimate = batteryPercent.map { socWindow.median(percent: $0, nowMs: telemetry.lastPacketAt) }
    tick["batteryPercent"] = batteryEstimate
    latestBatterySoc = batteryEstimate
    latestBatteryVoltage = telemetry.batteryVoltage
    latestTelemetry = telemetry
    persistLastBattery(percent: batteryEstimate, voltage: telemetry.batteryVoltage, now: telemetry.lastPacketAt)
    tick["generation"] = connectionSeq
    tick["remoteTilt"] = remoteTiltState()
    if let latestPreciseLocation = locationTracker.latestPreciseLocation {
      tick["location"] = latestPreciseLocation.map
    }

    let firedAlerts = alertCoordinator.evaluate(
      telemetry: telemetry,
      batteryPercent: batteryEstimate,
      onDiagnostic: { [weak self] name, props in self?.recordAlertDiagnostic(name, props) }
    )
    if !firedAlerts.isEmpty {
      tick["firedAlerts"] = firedAlerts
    }
    updateLiveBattery(percent: batteryEstimate, voltage: telemetry.batteryVoltage, now: telemetry.lastPacketAt)
    let peaks = liveSeries.add(tick)
    var liveTick = tick
    liveTick["speedPeak"] = peaks.speed
    liveTick["dutyPeak"] = peaks.duty
    emit?("onLiveTick", liveTick)

    if let capture = telemetryCapture(telemetry) {
      updateIdlePause(capture)
      AccessorySessionController.shared.setRiding(isRefloatEngaged(state: capture.telemetry.state))
      AccessorySessionController.shared.setLightTelemetry(speedKmh: telemetry.speed, riding: isRefloatEngaged(state: capture.telemetry.state))
      if !idlePauseDetector.isPaused {
        recordingCoordinator.recordTelemetry(capture)
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `persistLastBattery`
  private func persistLastBattery(percent: Double?, voltage: Double?, now: Int64, force: Bool = false) {
    guard let percent else { return }
    guard let boardId = config?.appBoardId else { return }
    if !force && now - lastBatteryPersistedAt < 30_000 { return }
    do {
      try appData.updateLastBattery(boardId: boardId, percent: percent, voltage: voltage, atMs: now)
      lastBatteryPersistedAt = now
      pushWatchLastBattery()
    } catch {
      RecordingStorageFailure.report(operation: "last_battery_save", category: "write_failed", error: error)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLastBatteryPusher.kt
  func pushWatchLastBattery() {
    do {
      let id = try appData.getSettings()["selectedBoardId"] as? String
      watchMirror.pushLastBattery(.selected(boardId: id, board: try id.flatMap { try appData.getBoard($0) }))
    } catch {
      RecordingStorageFailure.reportRead(operation: "watch_last_battery_read", error: error)
    }
  }

  private func recordAlertDiagnostic(_ name: String, _ props: [String: Any?]) {
    DiagnosticsRecorder.shared.record(eventName: name, properties: props)
  }

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

  func startWatchMirror() {
    watchMirror.start()
    pushWatchLastBattery()
    reloadWatchSettings()
    pushWatchBoard()
    removeRideNoticesListener = RideNotices.shared.addListener { [weak self] in self?.watchMirror.pushRideNotices($0) }
    watchMirror.pushRideNotices(RideNotices.shared.current)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommandListenerService.kt `routeWatchCommand`
  func acceptWatchCommand(_ command: WatchCommand) {
    switch command {
    case .mirrorAwake: break
    case .lights(let switchValue, let on): watchLightsRelay.accept(switchValue, on: on)
    case .move(let direction): watchMoveRelay.accept(direction)
    case .tiltLock(let value): watchTiltLock(value)
    case .tiltCancel: watchTiltCancel()
    case .dismissNotice(let id, let rev): RideNotices.shared.dismiss(id: id, rev: rev)
    }
  }

  func reloadWatchSettings() {
    if let strength = watchMirror.reloadSettings(from: appData) { boardMoveStrengthPercent = strength }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `watchSnapshot`
  private func watchSnapshot() -> WatchSnapshot {
    let current = latestTelemetry
    let progress = NavigationController.shared.currentProgress
    let rider = locationTracker.riderPosition
    let offset: (east: Double, north: Double)? = {
      guard progress != nil, let origin = WatchRouteMirror.shared.origin, let rider else { return nil }
      return watchOffsetMeters(
        origin: origin,
        point: WatchGeoPoint(latitude: rider.latitude, longitude: rider.longitude)
      )
    }()
    return WatchSnapshot(
      speed: current?.speed,
      dutyCycle: current?.dutyCycle,
      // TODO(ios parity): Android nulls duty while the live sample is excluded from `max_duty`. iOS
      // decides that exclusion at bucket-build time, not per live sample, so there is no live flag
      // to read here and the wrist shows raw duty.
      dutyExcluded: current == nil,
      batterySoc: current != nil ? latestBatterySoc : nil,
      motorTemp: current?.tempMotor,
      ctrlTemp: current?.tempMosfet,
      navBearingDeg: offset != nil ? progress?.bearingDeg : nil,
      navDistanceM: offset != nil ? progress?.remainingMeters : nil,
      riderEastM: offset?.east,
      riderNorthM: offset?.north,
      courseDeg: rider?.courseDeg,
      routeSpanM: WatchRouteMirror.shared.viewportSpanM,
      remoteTilt: current != nil ? remoteTiltController.currentValue : nil,
      tiltControl: watchTiltControl(),
      trail: watchTrail(
        rider: rider.map { WatchGeoPoint(latitude: $0.latitude, longitude: $0.longitude) },
        history: locationTracker.recentLocations
      ),
      mapPosition: rider.map { WatchMapPosition(latitude: $0.latitude, longitude: $0.longitude) },
      riderSpeedMps: rider?.speedMps
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `groupRideFrame`
  private func groupRideFrame() -> GroupRideFrame? {
    guard let roster = groupRideObserver.watchRoster else { return nil }
    let rider = locationTracker.riderPosition
    return GroupRideFrameBuilder.build(
      roster: roster,
      own: rider.map { WatchGeoPoint(latitude: $0.latitude, longitude: $0.longitude) },
      courseDeg: rider?.courseDeg,
      spanM: WatchRouteMirror.shared.viewportSpanM,
      nowMs: Int64(Date().timeIntervalSince1970 * 1000)
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `watchTiltControl`
  private func watchTiltControl() -> WatchTiltControl {
    switch remoteInput.manualBlocker {
    case .sensor: return .sensor
    case .move: return .move
    default:
      if !firmwareCommandsTrusted() { return .blocked }
      return remoteInput.owner == .manual ? .manual : .free
    }
  }

  private func recordWatchDiagnostic(_ name: String, _ props: [String: Any?]) {
    DiagnosticsRecorder.shared.record(eventName: name, properties: props)
  }

  private func currentLiveState() -> RideActivityAttributes.ContentState {
    RideActivityContent.state(
      deviceName: boardName ?? config?.name,
      phase: phase,
      batteryPercent: liveBatteryPercent,
      batteryVoltage: liveBatteryVoltage,
      faultCode: liveFaultCode,
      notice: liveActivityNoticeContent()
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `presenter`
  private func liveActivityNoticeContent() -> RideNoticeContent? {
    guard let content = liveActivityNotice?.content else { return nil }
    if let expiresAt = content.expiresAt, expiresAt <= Int64(Date().timeIntervalSince1970 * 1000) { return nil }
    return content
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onRideNoticesChanged`
  private func onRideNoticesChanged(_ notices: [RideNotice]) {
    let top = notices.first
    let shown = liveActivityNotice
    liveActivityNotice = top
    guard top?.id != shown?.id || top?.rev != shown?.rev || top?.content.title != shown?.content.title
      || top?.content.severity != shown?.content.severity
    else { return }
    refreshLiveActivity()
  }

  private func refreshLiveActivity() {
    liveActivity.update(currentLiveState())
  }

  func reapOrphanLiveActivities() {
    guard !liveActivityIsClaimed else { return }
    liveActivity.reapOrphans()
  }

  private var liveActivityIsClaimed: Bool {
    session?.isActive == true || pendingResume != nil
  }

  func endOrphanLiveActivity() {
    guard !liveActivityIsClaimed else { return }
    liveActivity.end()
  }

  @MainActor
  func waitForLiveActivityDismissal() async {
    await liveActivity.waitForDismissal()
  }

  private func endLiveActivity() {
    liveActivity.end()
    liveBatteryPercent = nil
    liveBatteryVoltage = nil
    liveFaultCode = nil
    lastLiveTelemetryRefreshAt = 0
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `faultLogReader`
  private var faultLogReader: VescFaultLogReader?

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
    scheduler.postDelayedForSession(
      session,
      delayMs: Int64(VescFaultLogReader.tickSeconds * 1000),
      isCurrent: { [weak self] in $0 === self?.session }
    ) { [weak self] session in
      guard let self else { return }
      guard let reader = self.faultLogReader else { return }
      guard reader.poll(self.nowMs()) else {
        self.scheduleFaultLogTick(session: session)
        return
      }
      self.faultLogReader = nil
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `handlePrintPayload`
  private func handlePrintPayload(_ body: [UInt8]) {
    faultLogReader?.onPrintChunk(body, atMs: nowMs())
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onRefloatFaultFrame`
  private func onRefloatFaultFrame(_ code: Int) {
    updateLiveFault(activeCode: code)
    guard let boardId = config?.appBoardId else { return }
    let timestamp = nowMs()
    if lastDispatchedFaultCode == code,
       timestamp - lastFaultDispatchAtMs < VescFaultCoordinator.observationWriteIntervalMs {
      return
    }
    lastDispatchedFaultCode = code
    lastFaultDispatchAtMs = timestamp
    VescFaultCoordinator.shared.onActiveFault(boardId: boardId, code: code)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `onRefloatNormalFrame`
  private func onRefloatNormalFrame() {
    updateLiveFault(activeCode: nil)
    let timestamp = nowMs()
    if lastDispatchedFaultCode == nil,
       timestamp - lastFaultDispatchAtMs < VescFaultCoordinator.observationWriteIntervalMs {
      return
    }
    lastDispatchedFaultCode = nil
    lastFaultDispatchAtMs = timestamp
    guard let boardId = config?.appBoardId else { return }
    VescFaultCoordinator.shared.onFaultCleared(boardId: boardId)
  }

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
      location: telemetryLocationFreshEnoughToRecord(
        locationTracker.latestPreciseLocation,
        capturedAtMs: telemetry.lastPacketAt
      )
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `replayedLocation`
  private func replayedLocation(_ fix: ReplayLocation, atMs: Int64) -> TelemetryLocationCapture {
    TelemetryLocationCapture(
      latitude: fix.latitude,
      longitude: fix.longitude,
      speedMps: fix.speedMps,
      bearingDeg: fix.bearingDeg,
      accuracyM: fix.accuracyM,
      altitudeM: fix.altitudeM,
      timestamp: atMs,
      precise: isPreciseGpsFix(accuracyM: fix.accuracyM)
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `prefillReplayWarmup`
  private func prefillReplayWarmup(_ board: SimulatedBoard, warmupMs: Int64) {
    let startedAt = Self.wallMs()
    let oldest = startedAt - Int64(config?.liveHistoryLimitMinutes ?? 5) * 60_000
    for event in board.warmup {
      let stamp = startedAt - (warmupMs - event.t)
      if stamp < oldest { continue }
      switch event {
      case let .frame(_, payload): prefillFrame(payload, stamp: stamp)
      case let .fix(fix): locationTracker.prefill(replayedLocation(fix, atMs: stamp))
      case .configWrite: break
      }
    }
  }

  private func prefillFrame(_ payload: [UInt8], stamp: Int64) {
    switch Int(payload[0]) {
    case COMM_BMS_GET_VALUES:
      guard let bms = parseBmsValues(payload, packetAt: stamp) else { return }
      bmsSeriesRing.append(
        capturedAtMs: bms.capturedAt,
        cellVoltages: bms.cellVoltages,
        balancing: bms.balancing,
        windowMs: bmsSeriesWindowMs()
      )
    case COMM_CUSTOM_APP_DATA:
      guard
        let telemetry = parseRefloatGetAllData(payload: payload, avgLatency: nil, packetAt: stamp, pullRateHz: nil),
        !telemetry.hasFault
      else { return }
      var sample = telemetry.toMap()
      sample["batteryPercent"] = batteryEstimator.estimateBatteryPercent(
        voltageV: telemetry.batteryVoltage,
        config: config?.batteryConfig,
        batteryCurrentA: telemetry.batteryCurrent
      ).map { socWindow.median(percent: $0, nowMs: stamp) }
      liveSeries.prefill(sample)
    default:
      break
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `stopCurrentBoardSession`
  private func releaseGpsFromSession(wasReplay: Bool) {
    if wasReplay { locationTracker.resetTrail() }
    linkLostAtMs = nil
    dropoutGraceTimer?.cancel()
    dropoutGraceTimer = nil
    refreshGpsDemand()
  }

  private func onLocationUpdated(_ incoming: TelemetryLocationCapture) {
    recordGpsFix(incoming)
    let location = locationTracker.onLocationUpdated(incoming)
    recordRideTrackFix(location)
    WeatherCoordinator.shared.onPosition(latitude: location.latitude, longitude: location.longitude)
    latestRiderPresence().map(groupRideObserver.pushPresence)
    groupRideObserver.refreshSignalAvailability()
    groupRideObserver.onFix(lat: location.latitude, lng: location.longitude)
    emit?("onLocation", location.map)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `recordRideTrackFix`
  private func recordRideTrackFix(_ location: TelemetryLocationCapture) {
    guard !idlePauseDetector.isPaused else { return }
    recordingCoordinator.recordGpsFix(location)
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `currentBoardTransport`
  private func startPolling(session: BoardSession) {
    pollingLoop.stop()
    idlePauseDetector.reset()
    polling = true
    if phase == .waitingForTelemetry {
      armBoardReadyTimeout(session: session)
    }
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
    pollingLoop.start(
      session: session,
      pollPayload: pollPayload(),
      bmsPayload: config?.hasBms == true ? bmsPayload() : nil,
      pollIntervalMs: effectivePollIntervalMs()
    )
    startGroundClearanceTilt(session: session)
  }

  private func stopPolling() {
    polling = false
    pollingLoop.stop()
    stopGroundClearanceTilt()
    AccessorySessionController.shared.setRiding(false)
    AccessorySessionController.shared.clearLightTelemetry()
    cancelStaleWatchdog()
    idlePauseDetector.reset()
    liveSeries.stop()
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `effectivePollIntervalMs`
  private func effectivePollIntervalMs() -> Int {
    let configured = max(0, config?.pollIntervalMs ?? 0)
    return idlePauseDetector.isPaused ? max(IDLE_PAUSE_POLL_INTERVAL_MS, configured) : configured
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `updateIdlePause`
  private func updateIdlePause(_ capture: TelemetryCapture) {
    guard recordingCoordinator.telemetryRecordingEnabled else {
      if idlePauseDetector.isPaused {
        resetIdlePause()
        onStateChanged?()
      }
      return
    }
    let transition = idlePauseDetector.onSample(
      state: capture.telemetry.state
    )
    guard let transition else { return }
    if transition == .paused, let config {
      recordingCoordinator.recordIdlePauseMarker(config: config)
    }
    pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
    refreshGpsDemand()
    onStateChanged?()
  }

  private func resetIdlePause() {
    let wasPaused = idlePauseDetector.isPaused
    idlePauseDetector.reset()
    pollingLoop.setPollIntervalMs(effectivePollIntervalMs())
    if wasPaused { refreshGpsDemand() }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `sendPayloadWithRetry`
  @discardableResult
  private func sendPayloadWithRetry(_ payload: [UInt8], session: BoardSession?) -> Bool {
    if let session, !(session === self.session && session.isActive) { return false }
    let sent = transport.sendPayload(payload)
    if !sent, let session {
      scheduler.postDelayedForSession(
        session,
        delayMs: Int64(sendRetryDelaySeconds * 1000),
        isCurrent: { [weak self] in $0 === self?.session }
      ) { [weak self] _ in
        guard let self else { return }
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
      loadProfile: { profileId in
        do { return try TuneProfileStore.shared.getTuneProfile(profileId) }
        catch { RecordingStorageFailure.reportRead(operation: "board_tune_profile_read", error: error); throw error }
      },
      onBoardConfigValues: { [weak self] values, origin in self?.onBoardConfigValues(values, origin: origin) },
      demoteWriteBase: { [weak self] in self?.boardConfigValues = self?.boardConfigValues?.demotedToProvisional() },
      rideState: { [weak self] in
        self?.latestTelemetry.map { BoardRideState(state: $0.state, switchState: $0.switchState, receivedAtMs: $0.lastPacketAt) }
      }
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
      onBoardConfigValues: { _, _ in },
      demoteWriteBase: { [weak self] in self?.boardConfigValues = self?.boardConfigValues?.demotedToProvisional() },
      rideState: { nil }
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

  private func latency(at now: Int64) -> Int? {
    pollingLoop.latency(at: now)
  }

  private func nowMs() -> Int64 { Self.wallMs() }
  private static func wallMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
  private func elapsedMs() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000.0) }
}

@MainActor
enum BoardSessionCommands {
  @discardableResult
  static func stopRide(controller: BoardSessionController = .shared) async -> Bool {
    let accepted = ManualBoardStop(
      defaults: .standard,
      activeBoardId: { controller.manualStopBoardId },
      stop: { controller.stopBoard() }
    ).perform()
    if !accepted { controller.endOrphanLiveActivity() }
    await controller.waitForLiveActivityDismissal()
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
