import Foundation
import GRDB

internal let TELEMETRY_FLAG_KEYFRAME = 1
internal let TELEMETRY_FLAG_HAS_LOCATION = 1 << 2
internal let GAP_BOUNDARY_MS: Int64 = 90_000
internal let KEYFRAME_INTERVAL_MS: Int64 = 60_000
internal let MIN_PERSIST_INTERVAL_MS: Int64 = 500
internal let DEFAULT_HISTORY_LIMIT = 100
internal let DEFAULT_SAMPLE_LIMIT = 2_000
/// Float64 lanes per sample in the columnar history payload. Must match the JS decoder.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `SAMPLE_COLUMN_COUNT`
/// @parity /modules/vescape-core/src/index.ts `SAMPLE_COLUMN_COUNT`
internal let SAMPLE_COLUMN_COUNT = 21

/// GRDB writer for iOS Ride Recording telemetry. Raw Telemetry Samples are preserved; Metric
/// Sanitizers only write exclusion ranges and bucket-derived metric values.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt
/// @platform-diff iOS stores full keyframe rows for v1 instead of Android's delta chain; schema,
/// metric exclusions, bucket semantics, markers, and read payloads stay aligned.
internal final class TelemetryRepository {
  static let shared = TelemetryRepository()

  /// Internal, not private: `getRange` lives in `TelemetryRangePayload.swift` because it returns an
  /// Expo `NativeArrayBuffer`, and a cross-file extension can only reach internal members.
  internal var pool: DatabasePool? { TelemetryDatabase.pool }
  private let queue = DispatchQueue(label: "vesc.telemetry.repository")
  private var pendingStates: [FullTelemetryState] = []
  private var pendingPersisted: [FullTelemetryState] = []
  private var pendingMarkers: [[String: Any?]] = []
  // Ride Track fixes admitted but not yet durable. Written on the GPS clock, never aligned to a
  // telemetry frame, and already carrying the Board and Ride Recording they were captured under —
  // a Board change flushes them under those identities rather than the new session's (ADR 0038).
  private var pendingTrack: [RideTrackPoint] = []
  private var lastFlushedTrackPoint: RideTrackPoint?
  private var currentRecording: RideRecording?
  private var lastFrameAtMs: Int64?
  private var lastHistoryAtMs: Int64?
  private var lastKeyframeAtMs: Int64?
  private var metricConfig = MetricSanitizerConfig()
  private var enabledPrivacyZones: [PrivacyZoneEntity] = []
  internal let batteryEstimator = BatterySocEstimator()
  private var onRecordingFailure: (() -> Void)?
  private var databaseSwapInProgress = false
  private lazy var recordingCommitBoundary = RecordingCommitBoundary { [weak self] error in
    RecordingStorageFailure.fail(error)
    self?.onRecordingFailure?()
  }

  private init() {
    RecordingStorageFailure.initialize()
  }

  func observeRecordingFailure(_ listener: (() -> Void)?) {
    queue.sync { onRecordingFailure = listener }
  }

  func applySettings(_ settings: [String: Any?]) {
    queue.async { self.metricConfig = MetricSanitizerConfig.from(settings: settings) }
  }

  /// Replace the enabled Privacy Zones consulted while flushing recorded telemetry. Fixes whose
  /// GPS location falls inside any zone are dropped (both the persisted frame and its bucket
  /// contribution) so no location leaks into Ride History.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `reloadPrivacyZones`
  func reloadPrivacyZones(_ zones: [PrivacyZoneEntity]) {
    queue.async { self.enabledPrivacyZones = zones }
  }

  /// Identity #449 groups history on and #450 carries across a Board Session teardown.
  var activeRideRecordingId: String? { queue.sync { currentRecording?.id } }


  /// Rejoin the Ride Recording named by `recordingId`, or nil when it can no longer be rejoined.
  ///
  /// The one path that does not mint a new identity. Two callers need it: an iOS BLE
  /// state-restoration relaunch rebuilding the session that was live when the process died (ADR
  /// 0034), and an explicit Connect to the Board that already owns the open recording — a rider
  /// tapping Connect to hurry its reconnect loop along is not asking for a second ride.
  ///
  /// The recording is named, not searched for. An abandoned row from a ride days ago has a
  /// different identity and is refused, so a restoration relaunch can never claim capture across a
  /// gap the process could not run through. The still-open row is also the persisted end intent: an
  /// explicitly stopped or disconnected recording carries `ended_at_ms`, so this returns nil and the
  /// caller must start a fresh recording rather than reviving an ended one.
  ///
  /// The dead interval is left exactly as honest as it was — no fix or frame is fabricated for the
  /// time the process could not run.
  ///
  /// @platform-diff No Android peer for the restoration half. Android's `CoreForegroundService`
  /// keeps the process alive, so there is no restoration relaunch to resume from, and its launch
  /// auto-connect is an ordinary cold start.
  @discardableResult
  func resumeRideRecording(boardId: String?, recordingId: String) -> String? {
    queue.sync {
      guard !databaseSwapInProgress, recordingCommitBoundary.isAccepting() else { return nil }
      if let open = currentRecording {
        return open.id == recordingId && open.boardId == boardId ? open.id : nil
      }
      var recording: RideRecording?
      guard recordingCommitBoundary.commit({
        recording = try TelemetryDatabase.requirePool().read { db in
          try openRideRecording(db, id: recordingId, boardId: boardId)
        }
      }), let recording else { return nil }
      currentRecording = recording
      lastFlushedTrackPoint = nil
      return recording.id
    }
  }

  /// Close every Ride Recording a dead process left open, stamping each at its own last durable
  /// write. Called once the launch is known not to be adopting one: an unswept row has no
  /// `ended_at_ms`, and #449's reader shows only finished recordings, so leaving it open hides that
  /// ride from history until some later recording happens to sweep it — possibly never.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `closeAbandonedRideRecordings`
  func closeAbandonedRideRecordings() {
    queue.sync {
      guard !databaseSwapInProgress else { return }
      _ = recordingCommitBoundary.commit {
        _ = try TelemetryDatabase.requirePool().write { db in
          try VescapeCore.closeAbandonedRideRecordings(
            db, reason: RIDE_RECORDING_END_DISCONNECTED, except: currentRecording?.id)
        }
      }
    }
  }

  /// Keep the open Ride Recording when it belongs to `boardId`; end it as a Board change otherwise.
  /// Returns the identity still open, or nil when nothing is.
  ///
  /// One decision, one critical section: reading the open recording's Board and then acting on it
  /// from outside would let a concurrent begin/end land in between and answer for the wrong ride.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `retainRideRecording`
  @discardableResult
  func retainRideRecording(forBoardId boardId: String?) -> String? {
    closeOpenRideRecording(reason: RIDE_RECORDING_END_BOARD_CHANGE, keepingBoardId: boardId)
  }

  /// Open a **Ride Recording**: mint its durable identity and stamp its start boundary.
  ///
  /// Board attribution and recording identity are separate facts. `boardId` says which Board is
  /// riding; the returned id says which capture, so two recordings of one Board — even inside the
  /// same minute — never merge in storage or in the summaries built from it.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `beginRideRecording`
  @discardableResult
  func beginRideRecording(boardId: String?) -> String? {
    queue.sync {
      guard !databaseSwapInProgress, recordingCommitBoundary.isAccepting() else { return nil }
      flushOnQueue()
      let recording = RideRecording(id: UUID().uuidString, boardId: boardId,
        startedAtMs: telemetryNowMs(), endedAtMs: nil, endedReason: nil)
      guard recordingCommitBoundary.commit({
        try TelemetryDatabase.requirePool().write { db in
          try beginRideRecordingRow(db, recording: recording, replacingId: currentRecording?.id)
        }
      }) else { return nil }
      currentRecording = recording
      lastFlushedTrackPoint = nil
      return recording.id
    }
  }

  /// Close the open Ride Recording, if any. Everything already admitted is flushed first, under the
  /// Board and recording it was captured with — a late fix from the old session is never
  /// re-attributed to whatever comes next.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `endRideRecording`
  func endRideRecording(reason: String) {
    _ = closeOpenRideRecording(reason: reason, keepingBoardId: nil, keepAnyBoard: false)
  }

  /// Read, decide and clear in one critical section: a concurrent `beginRideRecording` between the
  /// steps would nil out the *new* recording's identity while its row stayed open, and a Board read
  /// from outside could answer for a ride that has already been replaced.
  ///
  /// `keepAnyBoard` distinguishes "keep the recording of this Board" from "close whatever is open",
  /// which a plain `nil` `keepingBoardId` cannot: nil is itself a valid Board attribution.
  @discardableResult
  private func closeOpenRideRecording(
    reason: String,
    keepingBoardId: String?,
    keepAnyBoard: Bool = true
  ) -> String? {
    queue.sync {
      guard !databaseSwapInProgress, let recording = currentRecording else { return nil }
      if keepAnyBoard && recording.boardId == keepingBoardId { return recording.id }
      flushOnQueue()
      guard recordingCommitBoundary.commit({
        try TelemetryDatabase.requirePool().write { db in
          try closeRideRecordingRow(db, id: recording.id, endedAtMs: telemetryNowMs(), reason: reason)
        }
      }) else { return nil }
      currentRecording = nil
      lastFlushedTrackPoint = nil
      return nil
    }
  }

  /// Offer one GPS Fix to the **Ride Track**.
  ///
  /// Stored with the accuracy the platform reported, poor fixes included: write-time discard is
  /// unrecoverable and would bake one consumer's threshold into everyone's data (ADR 0038). The fix
  /// does not have to line up with a telemetry frame, so a board dropout no longer erases the route.
  ///
  /// Two gates still drop a fix, and both are shared with the Telemetry Sample stream: an enabled
  /// Privacy Zone (ADR 0009 — a separate stream leaks straight through a zone otherwise), and the
  /// Ride Recording being closed or in Idle Pause, which the caller owns (ADR 0021).
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `recordGpsFix`
  func recordGpsFix(_ location: TelemetryLocationCapture) {
    queue.async {
      guard !self.databaseSwapInProgress, self.recordingCommitBoundary.isAccepting(), let recording = self.currentRecording else { return }
      let latitudeE7 = Int64((location.latitude * 10_000_000.0).rounded())
      let longitudeE7 = Int64((location.longitude * 10_000_000.0).rounded())
      // The one Privacy Zone geometry check, shared with the Telemetry Sample filter below.
      guard
        !isInsideAnyPrivacyZone(
          latitudeE7: Int(latitudeE7),
          longitudeE7: Int(longitudeE7),
          zones: self.enabledPrivacyZones
        )
      else { return }
      self.pendingTrack.append(
        RideTrackPoint(
          recordingId: recording.id,
          boardId: recording.boardId,
          fixAtMs: location.timestamp,
          latitudeE7: latitudeE7,
          longitudeE7: longitudeE7,
          accuracyCm: location.accuracyM.map { telemetryCenti($0) },
          gpsSpeedCentiMps: location.speedMps.map { telemetryCenti($0) },
          bearingCentiDeg: location.bearingDeg.map { telemetryCenti($0) },
          altitudeCm: location.altitudeM.map { telemetryCenti($0) }
        )
      )
      if self.pendingTrack.count >= 25 { self.flushOnQueue() }
    }
  }

  func recordTelemetry(_ capture: TelemetryCapture) {
    queue.async {
      // Stamped here, not at flush: a flush can land after this recording closed, and reading the
      // current recording then would file these frames under whatever opened next.
      guard !self.databaseSwapInProgress, self.recordingCommitBoundary.isAccepting() else { return }
      let state = FullTelemetryState(capture: capture, recordingId: self.currentRecording?.id)
      let gapMs = self.lastHistoryAtMs.map { capture.capturedAtMs - $0 }
      let gap = (gapMs ?? 0) > GAP_BOUNDARY_MS
      let keyframe = self.lastHistoryAtMs == nil || gap || self.lastKeyframeAtMs == nil ||
        capture.capturedAtMs - (self.lastKeyframeAtMs ?? 0) >= KEYFRAME_INTERVAL_MS
      self.pendingStates.append(state)

      let sinceKept = self.lastHistoryAtMs.map { capture.capturedAtMs - $0 }
      let persist = keyframe || sinceKept == nil || (sinceKept ?? 0) >= MIN_PERSIST_INTERVAL_MS
      if persist {
        self.pendingPersisted.append(state)
        if gap {
          self.pendingMarkers.append(self.marker(type: "gap", capture: capture, gapMs: gapMs))
        }
        self.lastHistoryAtMs = capture.capturedAtMs
        self.lastFrameAtMs = capture.capturedAtMs
        if keyframe { self.lastKeyframeAtMs = capture.capturedAtMs }
      }
      if self.pendingStates.count >= 25 || self.pendingPersisted.count >= 25 {
        self.flushOnQueue()
      }
    }
  }

  func recordMarker(type: String, boardId: String?, message: String? = nil) {
    queue.async {
      guard !self.databaseSwapInProgress else { return }
      self.pendingMarkers.append([
        "occurredAtMs": telemetryNowMs(),
        "elapsedRealtimeMs": telemetryElapsedMs(),
        "type": type,
        "boardId": boardId,
        "message": message,
        "gapMs": nil,
      ])
      self.flushOnQueue()
    }
  }

  func flushBlocking() {
    queue.sync { self.flushOnQueue() }
  }

  /// Flush accepted work and reject new ingestion until the candidate or original pool is open.
  func beginDatabaseSwap() {
    queue.sync {
      flushOnQueue()
      databaseSwapInProgress = true
    }
  }

  func endDatabaseSwap() {
    queue.sync {
      pendingStates.removeAll()
      pendingPersisted.removeAll()
      pendingMarkers.removeAll()
      pendingTrack.removeAll()
      lastFlushedTrackPoint = nil
      currentRecording = nil
      lastFrameAtMs = nil
      lastHistoryAtMs = nil
      lastKeyframeAtMs = nil
      databaseSwapInProgress = false
    }
  }

  func resetSessionState() {
    queue.async {
      self.lastFrameAtMs = nil
      self.lastHistoryAtMs = nil
      self.lastKeyframeAtMs = nil
    }
  }

  func getSummary() throws -> [String: Any?] {
    let pool = try TelemetryDatabase.requirePool()
    return try pool.read { db in
      [
        "sampleCount": try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames") ?? 0,
        "gpsPointCount": try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ride_track_points") ?? 0,
        "firstAtMs": try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames"),
        "lastAtMs": try Int64.fetchOne(db, sql: "SELECT MAX(captured_at_ms) FROM telemetry_frames"),
        "droppedPendingSamples": 0,
      ]
    }
  }

  func getHistory(_ options: [String: Any]) throws -> [[String: Any?]] {
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let beforeMs = telemetryLong(options["cursorBeforeMs"]) ?? toMs
    let limit = min(500, max(1, telemetryInt(options["limit"]) ?? DEFAULT_HISTORY_LIMIT))
    let boardId = options["boardId"] as? String
    let pool = try TelemetryDatabase.requirePool()
    return try pool.read { db in
      let boardNames = try historyBoardNames(db)
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_minute_buckets
          WHERE bucket_start_ms >= ? AND bucket_start_ms <= ? AND bucket_start_ms < ?
            AND (? IS NULL OR board_id = ?)
          ORDER BY bucket_start_ms DESC
          LIMIT ?
          """,
        arguments: [fromMs, toMs, beforeMs, boardId, boardId, limit]
      )
      let markerFrom = (rows.map { $0["bucket_start_ms"] as Int64 }.min() ?? fromMs) - GAP_BOUNDARY_MS
      let markerTo = (rows.map { $0["bucket_start_ms"] as Int64 }.max() ?? toMs) + TELEMETRY_BUCKET_SIZE_MS
      let markers = try Row.fetchAll(
        db,
        sql: "SELECT * FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? AND (? IS NULL OR board_id = ?) ORDER BY occurred_at_ms ASC",
        arguments: [markerFrom, markerTo, boardId, boardId]
      )
      return rows.map { historyMap($0, markers: markers, boardNames: boardNames) }
    }
  }

  func getSamples(_ options: [String: Any]) throws -> [[String: Any?]] {
    let pool = try TelemetryDatabase.requirePool()
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let limit = min(MAX_SAMPLE_LIMIT, max(1, telemetryInt(options["limit"]) ?? DEFAULT_SAMPLE_LIMIT))
    let boardId = options["boardId"] as? String
    let recordingId = options["recordingId"] as? String
    // Battery configs, board names and the smoothing window are read up front (each opens its own
    // DB read) so the estimate stays a pure computation inside the frames read below.
    let windowMs = try socWindowMs()
    return try pool.read { db in
      batteryEstimator.ensureLoaded()
      let configs = try historyBatteryConfigs(db)
      let boardNames = try historyBoardNames(db)
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_frames
          WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND (? IS NULL OR board_id = ?)
            AND (? IS NULL OR COALESCE(recording_id, '') = ?)
          ORDER BY captured_at_ms ASC
          LIMIT ?
          """,
        arguments: [fromMs, toMs, boardId, boardId, recordingId, recordingId, limit]
      )
      let percents = self.batteryPercents(rows, configs: configs, windowMs: windowMs)
      return zip(rows, percents).map { sampleMap($0.0, batteryPercent: $0.1, boardNames: boardNames) }
    }
  }

  // MARK: - Battery SoC on read (ADR-0016)

  /// Per-sample Battery SoC Estimate for a run of frames (ordered by captured_at_ms): the
  /// IR-compensated % from the Board's stored battery config, smoothed by a per-Board
  /// `SocMedianWindow`. Returns one entry per row (nil where no config is known for the Board).
  /// Mirrors how the live path derives % per frame; approximate on read only because Android stores
  /// delta-encoded frames.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `smoothedSampleMaps`
  internal func batteryPercents(_ rows: [Row], configs: [String: [String: Any]], windowMs: Int64) -> [Double?] {
    var windows: [String: SocMedianWindow] = [:]
    return rows.map { row in
      let boardId = row["board_id"] as String?
      let voltageV = Double(row["battery_voltage_mv"] as Int? ?? 0) / 1000.0
      let batteryCurrentA = Double(row["battery_current_ma"] as Int? ?? 0) / 1000.0
      guard let boardId, let raw = deriveBatteryPercent(boardId: boardId, voltageV: voltageV, batteryCurrentA: batteryCurrentA, configs: configs) else {
        return nil
      }
      let window = windows[boardId] ?? {
        let w = SocMedianWindow(windowMs: windowMs)
        windows[boardId] = w
        return w
      }()
      return window.median(percent: raw, nowMs: row["captured_at_ms"] as Int64)
    }
  }

  /// Derive IR-compensated battery % for one sample, mirroring the live native path.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `deriveBatteryPercent`
  private func deriveBatteryPercent(boardId: String, voltageV: Double, batteryCurrentA: Double, configs: [String: [String: Any]]) -> Double? {
    guard let config = configs[boardId] else { return nil }
    return batteryEstimator.estimateBatteryPercent(voltageV: voltageV, config: config, batteryCurrentA: batteryCurrentA)
  }

  /// `boards.id` -> the Board's normalized battery config. Keyed on the Board rather than its BLE
  /// identifier now that samples carry the Board id (ADR 0028), so a re-linked Board keeps its
  /// config across its whole history.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `batteryConfigByBoard`
  internal func batteryConfigByBoard() throws -> [String: [String: Any]] {
    batteryEstimator.ensureLoaded()
    var result: [String: [String: Any]] = [:]
    for board in try AppDataRepository.shared.getBoards() {
      guard
        let id = board["id"] as? String,
        let config = board["batteryConfig"] as? [String: Any]
      else { continue }
      result[id] = config
    }
    return result
  }

  /// SoC median window length from app settings (seconds → ms), defaulting to Android's 20 s.
  internal func socWindowMs() throws -> Int64 {
    Int64(telemetryInt(try AppDataRepository.shared.getSettings()["socEstimateWindowSeconds"] ?? nil) ?? 20) * 1000
  }

  // MARK: - Favorites (ADR 0029)

  /// Board names are resolved here, not stored on the row: a Favorite outlives board renames, and
  /// a snapshot would drift.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getFavorites`
  func getFavorites() throws -> [[String: Any?]] {
    try FavoriteMediaStore.shared.reconcileAll()
    let boardNames = try Self.boardNamesById()
    return try FavoriteStore.shared.list().map { favorite in
      favorite.toMap(
        boardName: favorite.boardId.flatMap { boardNames[$0] },
        routePoints: try favoriteRoutePoints(favorite)
      )
    }
  }

  /// Coarse native route projection for Favorite cards, independent of JS history pagination.
  private func favoriteRoutePoints(_ favorite: Favorite) throws -> [[String: Double]] {
    let pool = try TelemetryDatabase.requirePool()
    let fromBucketMs = favorite.startMs - (favorite.startMs % TELEMETRY_BUCKET_SIZE_MS)
    return try pool.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT first_latitude_e7, first_longitude_e7
          FROM telemetry_minute_buckets
          WHERE bucket_start_ms >= ? AND bucket_start_ms <= ?
            AND first_sample_at_ms <= ? AND last_sample_at_ms >= ?
            AND first_latitude_e7 IS NOT NULL AND first_longitude_e7 IS NOT NULL
          ORDER BY bucket_start_ms ASC
          """,
        arguments: [fromBucketMs, favorite.endMs, favorite.endMs, favorite.startMs]
      ).map { row in
        [
          "latitude": Double(row["first_latitude_e7"] as Int64) / 1e7,
          "longitude": Double(row["first_longitude_e7"] as Int64) / 1e7,
        ]
      }
    }
  }

  /// Pin a time range as a Favorite. Identity and timestamps are minted here — the range and the
  /// optional name are the only things JS gets to supply. Summary stats come from the raw samples
  /// inside the range, so a range that cuts mid-bucket still gets exact numbers.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `createFavorite`
  func createFavorite(_ options: [String: Any]) throws -> [String: Any?]? {
    flushBlocking()
    guard let range = Self.favoriteRange(options) else { return nil }
    let pool = try TelemetryDatabase.requirePool()
    let startMs = range.startMs
    let endMs = range.endMs
    let boardId = options["boardId"] as? String
    let trimmedName = (options["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let config = queue.sync { metricConfig }
    let nowMs = telemetryNowMs()
    let favorite = try persistFavorite(
      store: .shared, existingId: nil, range: range, boardId: boardId,
      name: (trimmedName?.isEmpty ?? true) ? nil : trimmedName,
      nowMs: nowMs, newId: { UUID().uuidString },
      loadSummary: { requested, owner in
        let inputs = try self.favoriteSummaryInputs(startMs: requested.startMs, endMs: requested.endMs, boardId: owner)
        return Self.favoriteSummary(inputs.points, track: inputs.track, config: config)
      }
    )!
    let boardNames = try Self.boardNamesById()
    return favorite.toMap(
      boardName: favorite.boardId.flatMap { boardNames[$0] },
      routePoints: try favoriteRoutePoints(favorite)
    )
  }

  /// `boards.id` -> Board name, tombstones included: Ride History still has to name a Board the
  /// Rider deleted (ADR 0027), and resolving on read is what makes a rename retroactive.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `boardNamesById`
  internal static func boardNamesById() throws -> [String: String] {
    let pool = try TelemetryDatabase.requirePool()
    return try pool.read { db in
      try Row.fetchAll(db, sql: "SELECT id, name FROM boards").reduce(into: [String: String]()) {
        $0[$1["id"] as String] = $1["name"] as String
      }
    }
  }

  /// Favorite ranges are required bridge input. Missing or inverted bounds must fail instead of
  /// silently pinning epoch zero.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `favoriteRange`
  internal static func favoriteRange(_ options: [String: Any]) -> TelemetryTimeRange? {
    guard
      let startMs = telemetryLong(options["startMs"]),
      let endMs = telemetryLong(options["endMs"]),
      endMs >= startMs
    else { return nil }
    return TelemetryTimeRange(startMs: startMs, endMs: endMs)
  }

  /// Re-trim/rename a Favorite in place. Identity, creation time and Favorite Media stay attached;
  /// summary stats are rebuilt from raw samples for the new exact range.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `updateFavorite`
  func updateFavorite(_ id: String, options: [String: Any]) throws -> [String: Any?]? {
    flushBlocking()
    guard let range = Self.favoriteRange(options) else { return nil }
    let pool = try TelemetryDatabase.requirePool()
    let startMs = range.startMs
    let endMs = range.endMs
    let boardId = options["boardId"] as? String
    let trimmedName = (options["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let config = queue.sync { metricConfig }
    let persisted = try persistFavorite(
      store: .shared, existingId: id, range: range, boardId: boardId,
      name: (trimmedName?.isEmpty ?? true) ? nil : trimmedName,
      nowMs: telemetryNowMs(), newId: { UUID().uuidString },
      loadSummary: { requested, owner in
        let inputs = try self.favoriteSummaryInputs(startMs: requested.startMs, endMs: requested.endMs, boardId: owner)
        return Self.favoriteSummary(inputs.points, track: inputs.track, config: config)
      }
    )
    guard let stored = persisted else { return nil }
    let boardNames = try Self.boardNamesById()
    return stored.toMap(
      boardName: stored.boardId.flatMap { boardNames[$0] },
      routePoints: try favoriteRoutePoints(stored)
    )
  }

  /// Unpin a Favorite. Telemetry in its range stays and becomes normally deletable (ADR 0029).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `deleteFavorite`
  func deleteFavorite(_ id: String) throws -> Bool {
    let deleted = try FavoriteStore.shared.delete(id)
    if deleted { try FavoriteMediaStore.shared.deleteDirectory(favoriteId: id) }
    return deleted
  }

  /// Read and reconcile Favorite Media. Missing files remove their manifest rows; temp/orphan files
  /// are deleted and never published to JS.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getFavoriteMedia`
  func getFavoriteMedia(_ favoriteId: String) throws -> [[String: Any?]] {
    try FavoriteMediaStore.shared.list(favoriteId: favoriteId).map {
      $0.toMap(fileURL: FavoriteMediaStore.shared.fileURL(for: $0))
    }
  }

  /// Copy picker bytes into canonical app storage, hashing as they stream, then publish the
  /// immutable manifest only after the final file exists.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `importFavoriteMedia`
  func importFavoriteMedia(_ options: [String: Any]) throws -> [String: Any?] {
    guard
      let favoriteId = options["favoriteId"] as? String,
      let sourceURI = options["uri"] as? String,
      let mimeType = options["mimeType"] as? String,
      let mediaKind = options["mediaKind"] as? String
    else { throw FavoriteMediaStoreError.invalidSource }
    let media = try FavoriteMediaStore.shared.importMedia(
      favoriteId: favoriteId,
      sourceURI: sourceURI,
      capturedAtMs: telemetryLong(options["capturedAtMs"]),
      mimeType: mimeType,
      mediaKind: mediaKind
    )
    return media.toMap(fileURL: FavoriteMediaStore.shared.fileURL(for: media))
  }

  /// Run the raw samples of a Favorite range through the same Metric Sanitizers the recording flush
  /// applies, then collapse the resulting buckets into one denormalized summary. Exclusion ranges
  /// are deliberately not persisted: creating a Favorite is a read of Ride History, not a rewrite.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `favoriteSummary`
  /// @parity /src/modules/history/lib/favoritePreview.ts `summarizeFavoriteRange`
  /// @platform-diff JS is a live preview over loaded samples; this is the durable sanitized summary.
  /// Both halves of a Favorite's summary input: the Telemetry Samples in the range and the Ride
  /// Track over it. Read together because a Favorite spans two streams on two clocks (ADR 0038).
  private func favoriteSummaryInputs(
    startMs: Int64,
    endMs: Int64,
    boardId: String?
  ) throws -> (points: [BucketTelemetryPoint], track: [RideTrackPoint]) {
    let pool = try TelemetryDatabase.requirePool()
    return try pool.read { db in
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_frames
          WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND (? IS NULL OR board_id = ?)
          ORDER BY captured_at_ms ASC
          """,
        arguments: [startMs, endMs, boardId, boardId]
      )
      let track = try fetchRideTrackForAggregation(db, fromMs: startMs, toMs: endMs, boardId: boardId)
        .map(rideTrackPoint)
      return (rows.compactMap(bucketPoint), track)
    }
  }

  internal static func favoriteSummary(
    _ points: [BucketTelemetryPoint],
    track: [RideTrackPoint] = [],
    config: MetricSanitizerConfig
  ) -> FavoriteSummary {
    guard !points.isEmpty || !track.isEmpty else { return FavoriteSummary() }
    let sanitization = sanitizeTelemetrySamples(points, track: track, config: config)
    var sanitized = points
    for i in sanitized.indices {
      sanitized[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
      sanitized[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
      sanitized[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
    }
    return buildFavoriteSummary(
      buildTelemetryBuckets(
        sanitized,
        locationPoints: rideTrackBucketPoints(
          track,
          movingThresholdCentiKmh: config.movingSpeedThresholdCentiKmh
        )
      )
    )
  }

  func deleteBefore(_ beforeMs: Int64) throws -> Int {
    let pool = try TelemetryDatabase.requirePool()
    return try TelemetryMaintenancePersistence(writer: pool).deleteBefore(beforeMs)
  }

  func deleteRange(_ options: [String: Any]) throws -> Int {
    flushBlocking()
    let pool = try TelemetryDatabase.requirePool()
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? 0
    let boardId = options["boardId"] as? String
    guard toMs >= fromMs else { return 0 }
    let deletable = subtractProtectedTelemetryRanges(
      deleteRange: TelemetryTimeRange(startMs: fromMs, endMs: toMs),
      protectedRanges: favoriteTelemetryRanges()
    )
    return try TelemetryMaintenancePersistence(writer: pool).deleteRanges(deletable, boardId: boardId, allBoards: false, recordingId: options["recordingId"] as? String)
  }

  func rebuildBuckets(onProgress: (Int, Int) -> Void = { _, _ in }) throws -> Int {
    flushBlocking()
    let pool = try TelemetryDatabase.requirePool()
    return try TelemetryMaintenancePersistence(writer: pool).rebuild(config: metricConfig, onProgress: onProgress)
  }

  func clearAll() throws {
    flushBlocking()
    let pool = try TelemetryDatabase.requirePool()
    let protected = favoriteTelemetryRanges()
    try TelemetryMaintenancePersistence(writer: pool).clear(protectedRanges: protected)
    queue.sync {
      pendingStates.removeAll()
      pendingPersisted.removeAll()
      pendingMarkers.removeAll()
      pendingTrack.removeAll()
      lastFlushedTrackPoint = nil
      lastFrameAtMs = nil
      lastHistoryAtMs = nil
      lastKeyframeAtMs = nil
    }
  }

  /// Favorites protect time ranges globally. A Board can be re-linked after a Favorite is created,
  /// so its current BLE id cannot safely identify the historical telemetry device id.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `favoriteTelemetryRanges`
  private func favoriteTelemetryRanges() -> [TelemetryTimeRange] {
    do {
      return try FavoriteStore.shared.list().map {
        expandTelemetryRangeToBuckets(
          TelemetryTimeRange(startMs: $0.startMs, endMs: $0.endMs)
        )
      }
    } catch {
      RecordingStorageFailure.reportRead(operation: "favorite_pins_read", error: error)
      return [TelemetryTimeRange(startMs: Int64.min, endMs: Int64.max)]
    }
  }

  private func flushOnQueue() {
    guard recordingCommitBoundary.isAccepting(),
      (!pendingStates.isEmpty || !pendingPersisted.isEmpty || !pendingMarkers.isEmpty
        || !pendingTrack.isEmpty)
    else { return }
    let markers = pendingMarkers
    let previousTrackPoint = lastFlushedTrackPoint
    // Drop any fix inside an enabled Privacy Zone before it reaches storage. Fixes without a
    // location always pass. Bucket source (full rate), persisted frames and the Ride Track are all
    // filtered here, against the zones enabled *now*: a zone switched on mid-ride must suppress
    // what is still buffered, in both streams alike (ADR 0009).
    let zones = enabledPrivacyZones
    let states = zones.isEmpty ? pendingStates : pendingStates.filter { !Self.isInPrivacyZone($0, zones) }
    let persisted = zones.isEmpty ? pendingPersisted : pendingPersisted.filter { !Self.isInPrivacyZone($0, zones) }
    let track = zones.isEmpty ? pendingTrack : pendingTrack.filter { point in
      !isInsideAnyPrivacyZone(
        latitudeE7: Int(point.latitudeE7),
        longitudeE7: Int(point.longitudeE7),
        zones: zones
      )
    }
    pendingStates.removeAll(keepingCapacity: true)
    pendingPersisted.removeAll(keepingCapacity: true)
    pendingMarkers.removeAll(keepingCapacity: true)
    pendingTrack.removeAll(keepingCapacity: true)
    lastFlushedTrackPoint = track.last(where: rideTrackFixIsPrecise) ?? previousTrackPoint
    guard !states.isEmpty || !persisted.isEmpty || !markers.isEmpty || !track.isEmpty else { return }

    let telemetryPoints = states.map { $0.toBucketPoint() }
    let sanitization = sanitizeTelemetrySamples(telemetryPoints, track: track, config: metricConfig)
    var sanitized = telemetryPoints
    for i in sanitized.indices {
      sanitized[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
      sanitized[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
      sanitized[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
    }
    // Minute buckets aggregate the Ride Track that was admitted, not the fix stamped onto a frame:
    // the two streams keep their own clocks and are joined here only for the summary.
    let buckets = buildTelemetryBuckets(
      sanitized,
      locationPoints: rideTrackBucketPoints(
        track,
        previous: previousTrackPoint,
        movingThresholdCentiKmh: metricConfig.movingSpeedThresholdCentiKmh
      )
    )

    recordingCommitBoundary.commit {
      try TelemetryDatabase.requirePool().write { db in
        for state in persisted { try insertFrame(db, state) }
        for point in track { try insertRideTrackPoint(db, point) }
        for bucket in buckets { try upsertBucket(db, bucket) }
        for marker in markers { try insertMarker(db, marker) }
        for range in sanitization.exclusions { try insertExclusion(db, range) }
      }
    }
  }

  private func marker(type: String, capture: TelemetryCapture, gapMs: Int64?) -> [String: Any?] {
    [
      "occurredAtMs": capture.capturedAtMs,
      "elapsedRealtimeMs": capture.elapsedRealtimeMs,
      "type": type,
      "boardId": capture.boardId,
      "message": nil,
      "gapMs": gapMs,
    ]
  }

  private static func isInPrivacyZone(_ state: FullTelemetryState, _ zones: [PrivacyZoneEntity]) -> Bool {
    guard let loc = state.location else { return false }
    let latE7 = Int((loc.latitude * 10_000_000.0).rounded())
    let lonE7 = Int((loc.longitude * 10_000_000.0).rounded())
    return isInsideAnyPrivacyZone(latitudeE7: latE7, longitudeE7: lonE7, zones: zones)
  }

  // MARK: - Local Diagnostic Events (ADR 0007)

  /// Persist one Local Diagnostic Event to GRDB. Debug-facing, low-volume connection/telemetry
  /// breadcrumbs — the durable source of truth for field debugging even when remote transport
  /// misses the exact path. Property values are sanitized to JSON scalars; `nil`s are dropped.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `recordDiagnosticEvent`
  func recordDiagnosticEvent(eventName: String, properties: [String: Any?] = [:]) {
    guard let pool else { return }
    let occurredAtMs = telemetryNowMs()
    let elapsed = telemetryElapsedMs()
    let operation = properties["operation"] as? String
    let phase = properties["phase"] as? String
    let boardId = properties["board_id"] as? String
    let message = properties["message"] as? String
    let propertiesJson = Self.encodeDiagnosticProperties(properties)
    queue.async {
      do { try DiagnosticEventPersistence(writer: pool).insert(.init(id: nil, occurredAtMs: occurredAtMs, elapsedRealtimeMs: elapsed, eventName: eventName, operation: operation, phase: phase, boardId: boardId, message: message, propertiesJson: propertiesJson)) } catch {
        // Sentry only: writing another Local Diagnostic Event would recurse into the failed store.
        RecordingStorageFailure.report(operation: "diagnostic_event_insert", category: "write_failed", error: error)
      }
    }
  }

  func getDiagnosticEvents(_ options: [String: Any]) throws -> [[String: Any?]] {
    let pool = try TelemetryDatabase.requirePool()
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let boardId = options["boardId"] as? String
    let limit = min(1_000, max(1, telemetryInt(options["limit"]) ?? 200))
    return try DiagnosticEventPersistence(writer: pool).events(fromMs: fromMs, toMs: toMs, boardId: boardId, limit: limit).map { row in
        [
          "id": row.id, "occurredAtMs": row.occurredAtMs, "eventName": row.eventName,
          "operation": row.operation, "phase": row.phase, "boardId": row.boardId,
          "message": row.message, "propertiesJson": row.propertiesJson,
        ]
    }
  }

  func clearDiagnosticEvents() throws {
    let pool = try TelemetryDatabase.requirePool()
    try DiagnosticEventPersistence(writer: pool).clear()
  }

  private static func encodeDiagnosticProperties(_ properties: [String: Any?]) -> String {
    var sanitized: [String: Any] = [:]
    for (key, value) in properties {
      switch value {
      case let value as String: sanitized[key] = value
      // `Bool` bridges to `NSNumber` (as a CFBoolean) so booleans still serialize as true/false.
      case let value as NSNumber:
        let number = value.doubleValue
        if CFGetTypeID(value) == CFBooleanGetTypeID() || number.isFinite { sanitized[key] = value }
      case nil, is NSNull: continue
      case let value?: sanitized[key] = String(describing: value)
      }
    }
    guard
      // intentional-suppression: sanitized diagnostic encoding falls back locally to avoid recursive reporting
      let data = try? JSONSerialization.data(withJSONObject: sanitized),
      let json = String(data: data, encoding: .utf8)
    else { return "{}" }
    return json
  }
}
