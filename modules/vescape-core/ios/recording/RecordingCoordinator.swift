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
  /// This Board Session is a restoration resume, so the first enable rejoins the open recording
  /// instead of minting a second identity for one ride.
  private var resumingRecording = false
  /// Auto-recording is a *connect* rule, not a re-ready rule: it fires at the first board-ready of a
  /// Board Session and stays quiet for every reconnect's board-ready after it.
  private var boardReadySeen = false
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

  /// Begin a Board Session's recording side.
  ///
  /// `resume` marks the one caller that may rejoin an open recording instead of starting a new one:
  /// an iOS BLE state-restoration relaunch rebuilding the session that was live when the process
  /// died (ADR 0034). Everything else — a fresh connect, an auto-connect, a Board change — starts a
  /// new recording, because a rider who asked to connect is asking for a new capture.
  func beginBoardSession(config: BoardConnectConfig, resume: Bool = false) {
    // A recording belongs to exactly one Board. An explicit connection attempt to another one ends
    // the previous recording here, before the attempt can succeed or fail — a failed connection
    // must not reopen it either (ADR 0038). Same Board is a stop-then-start and says so.
    let previousBoardId = store.activeRideRecordingBoardId
    if store.activeRideRecordingId != nil {
      store.endRideRecording(
        reason: previousBoardId == config.appBoardId
          ? RIDE_RECORDING_END_STOPPED
          : RIDE_RECORDING_END_BOARD_CHANGE
      )
    }
    // A new Board Session spends the rider's previous stop: the gate exists to stop a *reconnect*
    // from restarting what they stopped, not to keep the next ride from recording.
    explicitlyStopped = false
    resumingRecording = resume
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
    boardReadySeen = false
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

  /// Board-ready for the current Board Session — the first one after a connect, and again after
  /// every reconnect that gets telemetry flowing.
  ///
  /// Auto-recording only fires on the first: a reconnect that re-readied the board must not start a
  /// recording the rider stopped, nor mint a second recording alongside the one still open across
  /// the drop (#450). The `connected` marker still lands on every ready, as disconnect evidence
  /// inside a continuing recording.
  func markBoardReady(config: BoardConnectConfig) {
    activeConfig = config
    let firstReady = !boardReadySeen
    boardReadySeen = true
    let autoRecording = appData.getSettings()["autoRecording"] as? Bool ?? false
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
    store.endRideRecording(reason: RIDE_RECORDING_END_DISCONNECTED)
    store.flushBlocking()
    activeConfig = nil
    enabled = false
    startedAtMs = nil
    boardReadySeen = false
    resumingRecording = false
  }

  func failSession() {
    finishDebugRecording(status: "error")
    store.endRideRecording(reason: RIDE_RECORDING_END_DISCONNECTED)
    store.flushBlocking()
    activeConfig = nil
    enabled = false
    startedAtMs = nil
    boardReadySeen = false
    resumingRecording = false
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
      return true
    }
    // Explicit Stop Recording. The end is stamped on the recording row below, which is what a late
    // reconnect callback or a restoration relaunch reads — neither can revive an ended recording.
    explicitlyStopped = true
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
      //
      // A restoration resume rejoins the recording left open instead, so one ride across a process
      // death stays one identity and one history entry. It is consumed once: if the rider stops and
      // starts again inside the resumed session, that really is a new recording. `nil` means the
      // recording was explicitly ended before the process died — that intent is durable, so a new
      // recording is the only honest thing to open.
      let resumed = resumingRecording ? store.resumeRideRecording(boardId: config.appBoardId) : nil
      resumingRecording = false
      if resumed == nil {
        store.beginRideRecording(boardId: config.appBoardId)
      }
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
