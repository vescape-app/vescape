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
  private var backgroundFlush: BackgroundFlushGuard?

  init(appData: AppDataRepository) {
    self.appData = appData
    // Lives as long as the coordinator (process-level, below Expo module lifetime), so the flush
    // still fires after a JS reload has torn the module down mid-ride.
    backgroundFlush = BackgroundFlushGuard { [weak self] _ in self?.flushPendingTelemetry() }
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

  func beginBoardSession(config: BoardConnectConfig) {
    // A recording belongs to exactly one Board. An explicit connection attempt to another one ends
    // the previous recording here, before the attempt can succeed or fail — a failed connection
    // must not reopen it either (ADR 0038).
    store.endRideRecording(reason: RIDE_RECORDING_END_BOARD_CHANGE)
    activeConfig = config
    recorder?.finish(status: "stopped")
    recorder = nil
    if config.recordingEnabled,
      let recorder = SessionRecorder(
        deviceName: config.name,
        deviceId: config.bleId,
        pollIntervalMs: config.pollIntervalMs
      )
    {
      recorder.start()
      self.recorder = recorder
    }
    store.resetSessionState()
    store.reloadPrivacyZones(appData.getEnabledPrivacyZoneEntities())
    store.applySettings(appData.getSettings())
    // `autoRecording` is honored at board-ready, not here — mirrors Android, which only enables
    // the telemetry store once the board is actually connected. Only an explicit JS request
    // (`setTelemetryRecordingEnabled`) starts recording this early.
    if requestedTelemetryRecordingEnabled {
      enableTelemetryRecording(config: config, emitConnectedMarker: false)
    } else {
      enabled = false
      startedAtMs = nil
    }
  }

  func markBoardReady(config: BoardConnectConfig) {
    activeConfig = config
    let autoRecording = appData.getSettings()["autoRecording"] as? Bool ?? false
    if autoRecording && !enabled {
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
    store.endRideRecording(reason: RIDE_RECORDING_END_DISCONNECTED)
    store.flushBlocking()
    activeConfig = nil
    enabled = false
    startedAtMs = nil
  }

  func failSession() {
    finishDebugRecording(status: "error")
    store.endRideRecording(reason: RIDE_RECORDING_END_DISCONNECTED)
    store.flushBlocking()
    activeConfig = nil
    enabled = false
    startedAtMs = nil
  }

  func setTelemetryRecordingEnabled(_ requested: Bool) -> Bool {
    requestedTelemetryRecordingEnabled = requested
    guard let config = activeConfig else {
      enabled = false
      startedAtMs = nil
      return false
    }
    if requested {
      enableTelemetryRecording(config: config)
      return true
    }
    if enabled {
      recordMarker("app_stop", config: config, message: "Recording stopped")
    }
    store.endRideRecording(reason: RIDE_RECORDING_END_STOPPED)
    store.flushBlocking()
    enabled = false
    startedAtMs = nil
    return true
  }

  func recordTelemetry(_ capture: TelemetryCapture) {
    guard enabled else { return }
    store.recordTelemetry(capture)
  }

  /// Offer one GPS Fix to the Ride Track. Independent of telemetry arrival: while a Ride Recording
  /// is open and unpaused, fixes keep landing straight through a board dropout (ADR 0038).
  func recordGpsFix(_ location: TelemetryLocationCapture) {
    guard enabled else { return }
    store.recordGpsFix(location)
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

  /// Marks where a Ride Recording entered an Idle Pause so the resulting gap is explained (ADR-0021).
  func recordIdlePauseMarker(config: BoardConnectConfig) {
    recordMarker("auto_pause", config: config, message: "Recording paused — idle")
  }

  func applySettings(_ settings: [String: Any?]) {
    store.applySettings(settings)
  }

  private func enableTelemetryRecording(config: BoardConnectConfig, emitConnectedMarker: Bool = true) {
    if !enabled {
      startedAtMs = nowMs()
      // Enabling recording is what opens a Ride Recording: durable identity and an explicit start
      // boundary, minted before the first sample or fix can be admitted.
      store.beginRideRecording(boardId: config.appBoardId)
      if emitConnectedMarker {
        recordMarker("connected", config: config)
      }
    }
    enabled = true
    activeConfig = config
    store.applySettings(appData.getSettings())
  }

  private func recordMarker(_ type: String, config: BoardConnectConfig, message: String? = nil) {
    store.recordMarker(type: type, boardId: config.appBoardId, message: message)
  }

  private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000.0) }
}
