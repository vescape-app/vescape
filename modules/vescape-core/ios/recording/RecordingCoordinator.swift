import Foundation

/// Starts/stops iOS Ride Recording storage and the raw debug `SessionRecorder` for the active
/// Board Session.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RecordingCoordinator.kt
internal final class RecordingCoordinator {
  private let store = TelemetryRepository.shared
  private let appData: AppDataRepository
  private var recorder: SessionRecorder?
  private var activeConfig: BoardConnectConfig?
  private var enabled = false
  private var startedAtMs: Int64?
  private var requestedTelemetryRecordingEnabled = false
  /// The rider stopped recording during this Board Session. Survives reconnects so a re-ready board
  /// cannot auto-restart what they explicitly stopped; cleared when a new Board Session begins.
  private var explicitlyStopped = false
  /// Auto-recording is a *connect* rule, not a re-ready rule: it fires at the first board-ready of a
  /// Board Session and stays quiet for every reconnect's board-ready after it.
  private var boardReadySeen = false
  private var privacyZonesReady = false
  private var backgroundFlush: BackgroundFlushGuard?
  var onFailure: (() -> Void)?

  init(appData: AppDataRepository) {
    self.appData = appData
    // Lives as long as the coordinator (process-level, below Expo module lifetime), so the flush
    // still fires after a JS reload has torn the module down mid-ride.
    backgroundFlush = BackgroundFlushGuard { [weak self] _ in self?.flushPendingTelemetry() }
    store.observeRecordingFailure { [weak self] in
      DispatchQueue.main.async {
        self?.enabled = false
        self?.requestedTelemetryRecordingEnabled = false
        self?.startedAtMs = nil
        self?.onFailure?()
      }
    }
  }

  /// Writes whatever `TelemetryRepository` still holds in memory. No-op when nothing is recording —
  /// the raw debug `SessionRecorder` needs none of this, it writes each line straight to its file
  /// handle with no buffer of its own.
  private func flushPendingTelemetry() {
    guard enabled else { return }
    store.flushBlocking()
  }

  var telemetryRecordingEnabled: Bool { enabled }
  var activeBoardId: String? { enabled ? activeConfig?.appBoardId : nil }

  func currentRecorder() -> SessionRecorder? { recorder }

  /// Begin a Board Session's recording side. Ride boundaries are derived from the recorded data
  /// (ADR 0041), so a connect never opens or closes a ride: it only decides whether capture is
  /// armed.
  func beginBoardSession(config: BoardConnectConfig) {
    // Tapping Connect to the same Board during a reconnect loop keeps capture armed, so no fix is
    // dropped between this connect and the board-ready that would otherwise enable it (#450).
    let keepRecording = enabled && activeConfig?.appBoardId == config.appBoardId
    // A new Board Session spends the rider's previous stop: the gate exists to stop a *reconnect*
    // from restarting what they stopped, not to keep the next ride from recording.
    explicitlyStopped = false
    enabled = false
    activeConfig = config
    recorder?.finish(status: "stopped")
    recorder = nil
    if config.recordingEnabled {
      do {
        let recorder = try SessionRecorder(
          deviceName: config.name,
          deviceId: config.bleId,
          pollIntervalMs: config.pollIntervalMs
        )
        recorder.start()
        self.recorder = recorder
      } catch {
        UnexpectedNativeError.report(operation: "debug_recording_open", category: "file_open_failed", error: error)
      }
    }
    boardReadySeen = false
    store.resetSessionState()
    privacyZonesReady = false
    do {
      store.reloadPrivacyZones(try appData.getEnabledPrivacyZoneEntities())
      privacyZonesReady = true
    }
    catch { RecordingStorageFailure.reportRead(operation: "recording_privacy_zones_read", error: error) }
    if let settings = readSettings(operation: "recording_settings_read") { store.applySettings(settings) }
    // `autoRecording` is honored at board-ready, not here — mirrors Android, which only enables
    // the telemetry store once the board is actually connected. Only an explicit JS request
    // (`setTelemetryRecordingEnabled`) starts recording this early — or capture this session keeps,
    // which was already running and must not lose the fixes between here and board-ready.
    if requestedTelemetryRecordingEnabled || keepRecording {
      enableTelemetryRecording(config: config, emitConnectedMarker: false)
    } else {
      enabled = false
      startedAtMs = nil
    }
  }

  /// Board-ready for the current Board Session — the first one after a connect, and again after
  /// every reconnect that gets telemetry flowing.
  ///
  /// Auto-recording only fires on the first: a reconnect that re-readied the board must not start a
  /// recording the rider stopped (#450). The `connected` marker still lands on every ready, as
  /// disconnect evidence inside a continuing ride.
  func markBoardReady(config: BoardConnectConfig) {
    activeConfig = config
    let firstReady = !boardReadySeen
    guard let settings = readSettings(operation: "auto_recording_settings_read") else { return }
    boardReadySeen = true
    let autoRecording = settings["autoRecording"] as? Bool ?? false
    if autoRecording && !enabled && firstReady && !explicitlyStopped {
      enableTelemetryRecording(config: config, emitConnectedMarker: false)
    }
    if enabled {
      recordMarker("connected", config: config)
    }
  }

  func updateBoardSessionConfig(_ config: BoardConnectConfig) {
    guard activeConfig?.appBoardId == config.appBoardId else { return }
    activeConfig = config
  }

  func finishBoardSession(status: String, markerType: String) {
    finishDebugRecording(status: status)
    if let config = activeConfig, enabled {
      recordMarker(markerType, config: config)
    }
    store.flushBlocking()
    activeConfig = nil
    enabled = false
    privacyZonesReady = false
    startedAtMs = nil
    boardReadySeen = false
  }

  func failSession() {
    finishDebugRecording(status: "error")
    store.flushBlocking()
    activeConfig = nil
    enabled = false
    privacyZonesReady = false
    startedAtMs = nil
    boardReadySeen = false
  }

  func setTelemetryRecordingEnabled(_ requested: Bool) -> Bool {
    requestedTelemetryRecordingEnabled = requested
    if requested { explicitlyStopped = false }
    guard let config = activeConfig else {
      enabled = false
      startedAtMs = nil
      return false
    }
    if requested {
      enableTelemetryRecording(config: config)
      return enabled
    }
    // Explicit Stop Recording: the only marker that splits a ride (ADR 0041).
    explicitlyStopped = true
    if enabled {
      recordMarker(recordingStopMarker, config: config, message: "Recording stopped")
    }
    store.flushBlocking()
    enabled = false
    startedAtMs = nil
    return true
  }

  func recordTelemetry(_ capture: TelemetryCapture) {
    guard enabled else { return }
    store.recordTelemetry(capture)
  }

  /// Offer one GPS Fix to the Ride Track. Independent of telemetry arrival: while recording is
  /// armed and unpaused, fixes keep landing straight through a board dropout (ADR 0038).
  func recordGpsFix(_ location: TelemetryLocationCapture) {
    guard enabled else { return }
    store.recordGpsFix(location, boardId: activeConfig?.appBoardId)
  }

  // MARK: Raw debug Session Recorder passthroughs

  func recordState(_ status: String, extra: [(String, Any?)] = []) {
    recorder?.recordState(status, extra: extra)
  }

  func recordChunk(direction: String, bytes: [UInt8]) {
    recorder?.recordChunk(direction: direction, bytes: bytes)
  }

  func recordLocation(_ location: TelemetryLocationCapture) {
    recorder?.recordLocation(
      latitude: location.latitude,
      longitude: location.longitude,
      speedMps: location.speedMps,
      bearingDeg: location.bearingDeg,
      accuracyM: location.accuracyM,
      altitudeM: location.altitudeM,
      timestamp: location.timestamp
    )
  }

  private func finishDebugRecording(status: String) {
    recorder?.finish(status: status)
    recorder = nil
  }

  /// Marks where recording entered an Idle Pause so the resulting gap is explained (ADR-0021).
  func recordIdlePauseMarker(config: BoardConnectConfig) {
    recordMarker("auto_pause", config: config, message: "Recording paused — idle")
  }

  func applySettings(_ settings: [String: Any?]) {
    store.applySettings(settings)
  }

  private func enableTelemetryRecording(config: BoardConnectConfig, emitConnectedMarker: Bool = true) {
    guard RecordingStorageFailure.value() == nil, privacyZonesReady,
      let settings = readSettings(operation: "recording_settings_read") else { return }
    store.applySettings(settings)
    if !enabled {
      startedAtMs = nowMs()
      if emitConnectedMarker {
        recordMarker("connected", config: config)
      }
    }
    enabled = true
    activeConfig = config
  }

  private func readSettings(operation: String) -> [String: Any?]? {
    do { return try appData.getSettings() }
    catch {
      RecordingStorageFailure.reportRead(operation: operation, error: error)
      return nil
    }
  }

  private func recordMarker(_ type: String, config: BoardConnectConfig, message: String? = nil) {
    store.recordMarker(type: type, boardId: config.appBoardId, message: message)
  }

  private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }
}
