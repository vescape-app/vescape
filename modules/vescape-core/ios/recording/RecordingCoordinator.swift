import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RecordingCoordinator.kt
internal final class RecordingCoordinator {
  private let store = TelemetryRepository.shared
  private let appData: AppDataRepository
  private var recorder: SessionRecorder?
  private var activeConfig: BoardConnectConfig?
  private var enabled = false
  private var startedAtMs: Int64?
  private var requestedTelemetryRecordingEnabled = false
  private var explicitlyStopped = false
  private var boardReadySeen = false
  private var privacyZonesReady = false
  private var backgroundFlush: BackgroundFlushGuard?
  var onFailure: (() -> Void)?

  init(appData: AppDataRepository) {
    self.appData = appData
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

  private func flushPendingTelemetry() {
    guard enabled else { return }
    store.flushBlocking()
  }

  var telemetryRecordingEnabled: Bool { enabled }
  var activeBoardId: String? { enabled ? activeConfig?.appBoardId : nil }

  func currentRecorder() -> SessionRecorder? { recorder }

  func beginBoardSession(config: BoardConnectConfig) {
    let keepRecording = enabled && activeConfig?.appBoardId == config.appBoardId
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
          pollIntervalMs: config.pollIntervalMs,
          transport: config.transport
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
    if requestedTelemetryRecordingEnabled || keepRecording {
      enableTelemetryRecording(config: config, emitConnectedMarker: false)
    } else {
      enabled = false
      startedAtMs = nil
    }
  }

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

  private func flushRecordingForStats() {
    store.flushBlocking()
    guard enabled, let boardId = activeConfig?.appBoardId, let sinceMs = startedAtMs else { return }
    let throughMs = nowMs()
    Task { await RiderStatsSender.shared.recordingEnded(boardId: boardId, sinceMs: sinceMs, throughMs: throughMs) }
  }

  func finishBoardSession(status: String, markerType: String) {
    finishDebugRecording(status: status)
    if let config = activeConfig, enabled {
      recordMarker(markerType, config: config)
    }
    flushRecordingForStats()
    activeConfig = nil
    enabled = false
    privacyZonesReady = false
    startedAtMs = nil
    boardReadySeen = false
  }

  func failSession() {
    finishDebugRecording(status: "error")
    flushRecordingForStats()
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
    explicitlyStopped = true
    if enabled {
      recordMarker(recordingStopMarker, config: config, message: "Recording stopped")
    }
    flushRecordingForStats()
    enabled = false
    startedAtMs = nil
    return true
  }

  func recordTelemetry(_ capture: TelemetryCapture) {
    guard enabled else { return }
    store.recordTelemetry(capture)
  }

  func recordGpsFix(_ location: TelemetryLocationCapture) {
    guard enabled else { return }
    store.recordGpsFix(location, boardId: activeConfig?.appBoardId)
  }

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
