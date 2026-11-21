import Foundation
import GRDB

internal let TELEMETRY_FLAG_KEYFRAME = 1
internal let TELEMETRY_FLAG_HAS_LOCATION = 1 << 2
internal let GAP_BOUNDARY_MS: Int64 = 90_000
internal let KEYFRAME_INTERVAL_MS: Int64 = 60_000
internal let MIN_PERSIST_INTERVAL_MS: Int64 = 500
internal let DEFAULT_HISTORY_LIMIT = 100
internal let DEFAULT_SAMPLE_LIMIT = 2_000
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `SAMPLE_COLUMN_COUNT`
/// @parity /modules/vescape-core/src/index.ts `SAMPLE_COLUMN_COUNT`
internal let SAMPLE_COLUMN_COUNT = 21

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt
/// @platform-diff iOS stores full keyframe rows for v1 instead of Android's delta chain; schema,
/// metric exclusions, bucket semantics, markers, and read payloads stay aligned.
internal final class TelemetryRepository {
  static let shared = TelemetryRepository()

  internal var pool: DatabasePool? { VescapeDatabase.pool }
  private let queue = DispatchQueue(label: "vesc.telemetry.repository")
  private var pendingStates: [FullTelemetryState] = []
  private var pendingPersisted: [FullTelemetryState] = []
  private var pendingMarkers: [[String: Any?]] = []
  private var pendingTrack: [RideTrackPoint] = []
  private var lastFlushedTrackPoint: RideTrackPoint?
  private var lastFlushedFreeSpin = FreeSpinCarry()
  private var lastFrameAtMs: Int64?
  private var lastHistoryAtMs: Int64?
  private var lastKeyframeAtMs: Int64?
  private var metricConfig = MetricSanitizerConfig()
  private var enabledPrivacyZones: [PrivacyZoneEntity] = []
  internal let batteryEstimator = BatterySocEstimator()
  private var onRecordingFailure: (() -> Void)?
  // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `exportRideGpx`
  func exportRideGpx(_ options: [String: Any]) throws -> [String: Any] {
    try VescapeDatabase.requirePool().read { db in
      try RideExport.gpx(db, directory: FileManager.default.temporaryDirectory, options: options)
    }
  }

  // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `exportRideCsv`
  func exportRideCsv(_ options: [String: Any]) throws -> [String: Any] {
    try VescapeDatabase.requirePool().read { db in
      try RideExport.csv(db, directory: FileManager.default.temporaryDirectory, options: options)
    }
  }

  // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `exportRideFloaty`
  func exportRideFloaty(_ options: [String: Any]) throws -> [String: Any] {
    let config = try (options["boardId"] as? String).flatMap { try batteryConfigByBoard()[$0] }
    return try VescapeDatabase.requirePool().read { db in
      try RideExport.floaty(db, directory: FileManager.default.temporaryDirectory, options: options) { voltage, current in
        self.batteryEstimator.estimateBatteryPercent(voltageV: voltage, config: config, batteryCurrentA: current)
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `exportRides`
  func exportRides(_ items: [RideBatch.Item], format: RideExport.Format, isCancelled: @escaping () -> Bool,
    onProgress: (_ done: Int, _ total: Int) -> Void) throws -> [String: Any] {
    let configs = format == .floaty ? try batteryConfigByBoard() : [:]
    return try VescapeDatabase.requirePool().read { db in
      try RideBatch.zip(directory: FileManager.default.temporaryDirectory, items: items, format: format,
        zone: .current, isCancelled: isCancelled, onProgress: onProgress) { ride, write in
        switch format {
        case .gpx:
          try RideExport.writeGpx(db, fromMs: ride.fromMs, toMs: ride.toMs, boardId: ride.boardId,
            name: ride.name ?? "Vescape ride", write: write)
        case .csv:
          try RideExport.writeCsv(db, fromMs: ride.fromMs, toMs: ride.toMs, boardId: ride.boardId, write: write)
        case .floaty:
          let config = ride.boardId.flatMap { configs[$0] }
          try RideExport.writeFloaty(db, fromMs: ride.fromMs, toMs: ride.toMs, boardId: ride.boardId,
            name: ride.name, batteryPercent: { voltage, current in
              self.batteryEstimator.estimateBatteryPercent(voltageV: voltage, config: config, batteryCurrentA: current)
            }, write: write)
        }
      }
    }
  }

  private var databaseSwapInProgress = false
  private lazy var flushTimer = RecordingFlushTimer(queue: queue)
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `reloadPrivacyZones`
  func reloadPrivacyZones(_ zones: [PrivacyZoneEntity]) {
    queue.async { self.enabledPrivacyZones = zones }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `recordGpsFix`
  func recordGpsFix(_ location: TelemetryLocationCapture, boardId: String?) {
    queue.async {
      guard !self.databaseSwapInProgress, self.recordingCommitBoundary.isAccepting() else { return }
      let latitudeE7 = Int64((location.latitude * 10_000_000.0).rounded())
      let longitudeE7 = Int64((location.longitude * 10_000_000.0).rounded())
      guard
        !isInsideAnyPrivacyZone(
          latitudeE7: Int(latitudeE7),
          longitudeE7: Int(longitudeE7),
          zones: self.enabledPrivacyZones
        )
      else { return }
      self.pendingTrack.append(
        RideTrackPoint(
          boardId: boardId,
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
      else { self.flushTimer.schedule { [weak self] in self?.flushOnQueue() } }
    }
  }

  func recordTelemetry(_ capture: TelemetryCapture) {
    queue.async {
      guard !self.databaseSwapInProgress, self.recordingCommitBoundary.isAccepting() else { return }
      let state = FullTelemetryState(capture: capture)
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
      } else {
        self.flushTimer.schedule { [weak self] in self?.flushOnQueue() }
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
      lastFlushedFreeSpin = FreeSpinCarry()
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
    let pool = try VescapeDatabase.requirePool()
    return try pool.read { db in
      [
        "sampleCount": try telemetrySampleCount(db),
        "gpsPointCount": try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ride_track_points") ?? 0,
        "firstAtMs": try firstTelemetrySampleAt(db),
        "lastAtMs": try lastTelemetrySampleAt(db),
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
    let pool = try VescapeDatabase.requirePool()
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
    let pool = try VescapeDatabase.requirePool()
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let limit = min(MAX_SAMPLE_LIMIT, max(1, telemetryInt(options["limit"]) ?? DEFAULT_SAMPLE_LIMIT))
    let boardId = options["boardId"] as? String
    let windowMs = try socWindowMs()
    return try pool.read { db in
      batteryEstimator.ensureLoaded()
      let configs = try historyBatteryConfigs(db)
      let boardNames = try historyBoardNames(db)
      let rows = try telemetryFrameRows(db, fromMs: fromMs, toMs: toMs, boardId: boardId,
                                        allBoards: boardId == nil, limit: limit)
      let percents = self.batteryPercents(rows, configs: configs, windowMs: windowMs)
      return zip(rows, percents).map { sampleMap($0.0, batteryPercent: $0.1, boardNames: boardNames) }
    }
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `deriveBatteryPercent`
  private func deriveBatteryPercent(boardId: String, voltageV: Double, batteryCurrentA: Double, configs: [String: [String: Any]]) -> Double? {
    guard let config = configs[boardId] else { return nil }
    return batteryEstimator.estimateBatteryPercent(voltageV: voltageV, config: config, batteryCurrentA: batteryCurrentA)
  }

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

  internal func socWindowMs() throws -> Int64 {
    Int64(telemetryInt(try AppDataRepository.shared.getSettings()["socEstimateWindowSeconds"] ?? nil) ?? 20) * 1000
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getFavorites`
  func getFavorites() throws -> [[String: Any?]] {
    try FavoriteMediaStore.shared.reconcileAll()
    let boardNames = try Self.boardNamesById()
    return try FavoriteStore.shared.list().map { favorite in
      favorite.toMap(
        boardName: favorite.boardId.flatMap { boardNames[$0] },
        routePoints: try favoriteRoutePoints(favorite),
        weather: try favoriteWeather(favorite)
      )
    }
  }

  private func favoriteWeather(_ favorite: Favorite) throws -> RideWeather? {
    try VescapeDatabase.requirePool().read { db in
      try rideWeather(db, startMs: favorite.startMs, endMs: favorite.endMs)
    }
  }

  private func favoriteRoutePoints(_ favorite: Favorite) throws -> [[String: Any]] {
    let pool = try VescapeDatabase.requirePool()
    return try pool.read { db in
      try favoriteRoutePreview(db, startMs: favorite.startMs, endMs: favorite.endMs, boardId: favorite.boardId)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `createFavorite`
  func createFavorite(_ options: [String: Any]) throws -> [String: Any?]? {
    flushBlocking()
    guard let range = Self.favoriteRange(options) else { return nil }
    let pool = try VescapeDatabase.requirePool()
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
      routePoints: try favoriteRoutePoints(favorite),
      weather: try favoriteWeather(favorite)
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `boardNamesById`
  internal static func boardNamesById() throws -> [String: String] {
    let pool = try VescapeDatabase.requirePool()
    return try pool.read { db in
      try Row.fetchAll(db, sql: "SELECT id, name FROM boards").reduce(into: [String: String]()) {
        $0[$1["id"] as String] = $1["name"] as String
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `favoriteRange`
  internal static func favoriteRange(_ options: [String: Any]) -> TelemetryTimeRange? {
    guard
      let startMs = telemetryLong(options["startMs"]),
      let endMs = telemetryLong(options["endMs"]),
      endMs >= startMs
    else { return nil }
    return TelemetryTimeRange(startMs: startMs, endMs: endMs)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `updateFavorite`
  func updateFavorite(_ id: String, options: [String: Any]) throws -> [String: Any?]? {
    flushBlocking()
    guard let range = Self.favoriteRange(options) else { return nil }
    let pool = try VescapeDatabase.requirePool()
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
      routePoints: try favoriteRoutePoints(stored),
      weather: try favoriteWeather(stored)
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `deleteFavorite`
  func deleteFavorite(_ id: String) throws -> Bool {
    let deleted = try FavoriteStore.shared.delete(id)
    if deleted { try FavoriteMediaStore.shared.deleteDirectory(favoriteId: id) }
    return deleted
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getFavoriteMedia`
  func getFavoriteMedia(_ favoriteId: String) throws -> [[String: Any?]] {
    try FavoriteMediaStore.shared.list(favoriteId: favoriteId).map {
      $0.toMap(fileURL: FavoriteMediaStore.shared.fileURL(for: $0))
    }
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `favoriteSummary`
  /// @parity /src/modules/history/lib/favoritePreview.ts `summarizeFavoriteRange`
  /// @platform-diff JS is a live preview over loaded samples; this is the durable sanitized summary.
  private func favoriteSummaryInputs(
    startMs: Int64,
    endMs: Int64,
    boardId: String?
  ) throws -> (points: [BucketTelemetryPoint], track: [RideTrackPoint]) {
    let pool = try VescapeDatabase.requirePool()
    return try pool.read { db in
      let rows = try telemetryFrameRows(db, fromMs: startMs, toMs: endMs, boardId: boardId, allBoards: boardId == nil)
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
    let sanitization = sanitizeTelemetrySamples(points, config: config)
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
    let pool = try VescapeDatabase.requirePool()
    return try TelemetryMaintenancePersistence(writer: pool).deleteBefore(beforeMs)
  }

  func deleteRange(_ options: [String: Any]) throws -> Int {
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? 0
    guard toMs >= fromMs else { return 0 }
    return try deleteRides([RideBatch.Item(fromMs: fromMs, toMs: toMs, boardId: options["boardId"] as? String, name: nil)])
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `deleteRides`
  func deleteRides(_ items: [RideBatch.Item]) throws -> Int {
    flushBlocking()
    let pool = try VescapeDatabase.requirePool()
    let protected = favoriteTelemetryRanges()
    let byBoard = Dictionary(grouping: items, by: \.boardId).mapValues { rides in
      rides.flatMap {
        subtractProtectedTelemetryRanges(deleteRange: TelemetryTimeRange(startMs: $0.fromMs, endMs: $0.toMs), protectedRanges: protected)
      }
    }
    return try TelemetryMaintenancePersistence(writer: pool).deleteBoardRanges(byBoard)
  }

  func clearAll() throws {
    flushBlocking()
    let pool = try VescapeDatabase.requirePool()
    let protected = favoriteTelemetryRanges()
    try DatabaseReplacementFence.process.fence {
      try TelemetryMaintenancePersistence(writer: pool).clear(protectedRanges: protected)
    }
    queue.sync {
      pendingStates.removeAll()
      pendingPersisted.removeAll()
      pendingMarkers.removeAll()
      pendingTrack.removeAll()
      lastFlushedTrackPoint = nil
      lastFlushedFreeSpin = FreeSpinCarry()
      lastFrameAtMs = nil
      lastHistoryAtMs = nil
      lastKeyframeAtMs = nil
    }
  }

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
    flushTimer.cancel()
    guard recordingCommitBoundary.isAccepting(),
      (!pendingStates.isEmpty || !pendingPersisted.isEmpty || !pendingMarkers.isEmpty
        || !pendingTrack.isEmpty)
    else { return }
    let markers = pendingMarkers
    let previousTrackPoint = lastFlushedTrackPoint
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
    let sanitization = sanitizeTelemetrySamples(telemetryPoints, config: metricConfig, freeSpinCarry: lastFlushedFreeSpin)
    lastFlushedFreeSpin = sanitization.freeSpinCarry
    var sanitized = telemetryPoints
    for i in sanitized.indices {
      sanitized[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
      sanitized[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
      sanitized[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
    }
    let buckets = buildTelemetryBuckets(
      sanitized,
      locationPoints: rideTrackBucketPoints(
        track,
        previous: previousTrackPoint,
        movingThresholdCentiKmh: metricConfig.movingSpeedThresholdCentiKmh
      )
    )

    _ = recordingCommitBoundary.commit {
      try VescapeDatabase.requirePool().write { db in
        for state in persisted { try insertFrame(db, state) }
        try RecordingPersistenceSQL.insertTrackAndBuckets(db, track: track, buckets: buckets)
        for marker in markers { try insertMarker(db, marker) }
        for range in sanitization.exclusions { try insertExclusion(db, range) }
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `recordSealFailure`
  func recordSealFailure(_ key: TelemetryMinuteKey, _ error: Error) {
    let properties: [String: Any] = ["operation": "telemetry_seal", "board_id": key.boardId ?? NSNull(),
                                     "minute_start_ms": key.minuteStartMs, "message": String(describing: error)]
    // intentional-suppression: diagnostic encoding falls back locally to avoid recursive reporting.
    let json = (try? JSONSerialization.data(withJSONObject: properties)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    let event = PersistedDiagnosticEvent(id: nil, occurredAtMs: telemetryNowMs(), elapsedRealtimeMs: telemetryElapsedMs(),
      eventName: "telemetry_seal_failed", operation: "telemetry_seal", phase: nil, boardId: key.boardId,
      message: String(describing: error), propertiesJson: json)
    // intentional-suppression: a failed diagnostic write must not recurse into the same failed store.
    do { try DiagnosticEventPersistence(writer: VescapeDatabase.requirePool()).insert(event) } catch {}
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
        RecordingStorageFailure.report(operation: "diagnostic_event_insert", category: "write_failed", error: error)
      }
    }
  }

  func getDiagnosticEvents(_ options: [String: Any]) throws -> [[String: Any?]] {
    let pool = try VescapeDatabase.requirePool()
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
    let pool = try VescapeDatabase.requirePool()
    try DiagnosticEventPersistence(writer: pool).clear()
  }

  private static func encodeDiagnosticProperties(_ properties: [String: Any?]) -> String {
    var sanitized: [String: Any] = [:]
    for (key, value) in properties {
      switch value {
      case let value as String: sanitized[key] = value
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
