import Foundation
import GRDB

internal let TELEMETRY_FLAG_KEYFRAME = 1
internal let TELEMETRY_FLAG_HAS_LOCATION = 1 << 2
internal let TELEMETRY_BUCKET_SIZE_MS: Int64 = 60_000
internal let GAP_BOUNDARY_MS: Int64 = 90_000
internal let KEYFRAME_INTERVAL_MS: Int64 = 60_000
internal let MIN_PERSIST_INTERVAL_MS: Int64 = 500
internal let MAX_ENERGY_SAMPLE_GAP_MS: Int64 = 5_000
internal let DEFAULT_HISTORY_LIMIT = 100
internal let DEFAULT_SAMPLE_LIMIT = 2_000
internal let MAX_SAMPLE_LIMIT = 20_000
/// Float64 lanes per sample in the columnar history payload. Must match the JS decoder.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `SAMPLE_COLUMN_COUNT`
/// @parity /modules/vescape-core/src/index.ts `SAMPLE_COLUMN_COUNT`
internal let SAMPLE_COLUMN_COUNT = 23

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
  private var lastFrameAtMs: Int64?
  private var lastHistoryAtMs: Int64?
  private var lastKeyframeAtMs: Int64?
  private var metricConfig = MetricSanitizerConfig()
  private var enabledPrivacyZones: [PrivacyZoneEntity] = []
  private let batteryEstimator = BatterySocEstimator()

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

  func recordTelemetry(_ capture: TelemetryCapture) {
    let state = FullTelemetryState(capture: capture)
    queue.async {
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

  func resetSessionState() {
    queue.async {
      self.lastFrameAtMs = nil
      self.lastHistoryAtMs = nil
      self.lastKeyframeAtMs = nil
    }
  }

  func getSummary() -> [String: Any?] {
    guard let pool else {
      return ["sampleCount": 0, "gpsPointCount": 0, "firstAtMs": nil, "lastAtMs": nil, "droppedPendingSamples": 0]
    }
    return (try? pool.read { db in
      [
        "sampleCount": try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames") ?? 0,
        "gpsPointCount": try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE latitude_e7 IS NOT NULL") ?? 0,
        "firstAtMs": try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames"),
        "lastAtMs": try Int64.fetchOne(db, sql: "SELECT MAX(captured_at_ms) FROM telemetry_frames"),
        "droppedPendingSamples": 0,
      ]
    }) ?? ["sampleCount": 0, "gpsPointCount": 0, "firstAtMs": nil, "lastAtMs": nil, "droppedPendingSamples": 0]
  }

  func getHistory(_ options: [String: Any]) -> [[String: Any?]] {
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let beforeMs = telemetryLong(options["cursorBeforeMs"]) ?? toMs
    let limit = min(500, max(1, telemetryInt(options["limit"]) ?? DEFAULT_HISTORY_LIMIT))
    let boardId = options["boardId"] as? String
    guard let pool else { return [] }
    let boardNames = Self.boardNamesById()
    return (try? pool.read { db in
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
    }) ?? []
  }

  func getSamples(_ options: [String: Any]) -> [[String: Any?]] {
    guard let pool else { return [] }
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let limit = min(MAX_SAMPLE_LIMIT, max(1, telemetryInt(options["limit"]) ?? DEFAULT_SAMPLE_LIMIT))
    let boardId = options["boardId"] as? String
    // Battery configs, board names and the smoothing window are read up front (each opens its own
    // DB read) so the estimate stays a pure computation inside the frames read below.
    let configs = batteryConfigByBoard()
    let boardNames = Self.boardNamesById()
    let windowMs = socWindowMs()
    return (try? pool.read { db in
      let rows = try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_frames
          WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND (? IS NULL OR board_id = ?)
          ORDER BY captured_at_ms ASC
          LIMIT ?
          """,
        arguments: [fromMs, toMs, boardId, boardId, limit]
      )
      let percents = self.batteryPercents(rows, configs: configs, windowMs: windowMs)
      return zip(rows, percents).map { sampleMap($0.0, batteryPercent: $0.1, boardNames: boardNames) }
    }) ?? []
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
  internal func batteryConfigByBoard() -> [String: [String: Any]] {
    batteryEstimator.ensureLoaded()
    var result: [String: [String: Any]] = [:]
    for board in AppDataRepository.shared.getBoards() {
      guard
        let id = board["id"] as? String,
        let config = board["batteryConfig"] as? [String: Any]
      else { continue }
      result[id] = config
    }
    return result
  }

  /// SoC median window length from app settings (seconds → ms), defaulting to Android's 20 s.
  internal func socWindowMs() -> Int64 {
    Int64(telemetryInt(AppDataRepository.shared.getSettings()["socEstimateWindowSeconds"] ?? nil) ?? 20) * 1000
  }

  // MARK: - Favorites (ADR 0029)

  /// Board names are resolved here, not stored on the row: a Favorite outlives board renames, and
  /// a snapshot would drift.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getFavorites`
  func getFavorites() -> [[String: Any?]] {
    FavoriteMediaStore.shared.reconcileAll()
    let boardNames = Self.boardNamesById()
    return FavoriteStore.shared.list().map { favorite in
      favorite.toMap(
        boardName: favorite.boardId.flatMap { boardNames[$0] },
        routePoints: favoriteRoutePoints(favorite)
      )
    }
  }

  /// Coarse native route projection for Favorite cards, independent of JS history pagination.
  private func favoriteRoutePoints(_ favorite: Favorite) -> [[String: Double]] {
    guard let pool else { return [] }
    let fromBucketMs = favorite.startMs - (favorite.startMs % TELEMETRY_BUCKET_SIZE_MS)
    return (try? pool.read { db in
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
    }) ?? []
  }

  /// Pin a time range as a Favorite. Identity and timestamps are minted here — the range and the
  /// optional name are the only things JS gets to supply. Summary stats come from the raw samples
  /// inside the range, so a range that cuts mid-bucket still gets exact numbers.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `createFavorite`
  func createFavorite(_ options: [String: Any]) -> [String: Any?]? {
    flushBlocking()
    guard let pool else { return nil }
    guard let range = Self.favoriteRange(options) else { return nil }
    let startMs = range.startMs
    let endMs = range.endMs
    let boardId = options["boardId"] as? String
    let trimmedName = (options["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let config = queue.sync { metricConfig }
    let points = (try? pool.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_frames
          WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND (? IS NULL OR board_id = ?)
          ORDER BY captured_at_ms ASC
          """,
        arguments: [startMs, endMs, boardId, boardId]
      ).compactMap(bucketPoint)
    }) ?? []
    let summary = Self.favoriteSummary(points, config: config)
    let nowMs = telemetryNowMs()
    let favorite = Favorite(
      id: UUID().uuidString,
      boardId: boardId,
      name: (trimmedName?.isEmpty ?? true) ? nil : trimmedName,
      startMs: startMs,
      endMs: endMs,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      summary: summary
    )
    guard FavoriteStore.shared.insert(favorite) else { return nil }
    SyncCoordinator.shared.notifyRiderEdit()
    return favorite.toMap(
      boardName: favorite.boardId.flatMap { Self.boardNamesById()[$0] },
      routePoints: favoriteRoutePoints(favorite)
    )
  }

  /// `boards.id` -> Board name, tombstones included: Ride History still has to name a Board the
  /// Rider deleted (ADR 0027), and resolving on read is what makes a rename retroactive.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `boardNamesById`
  internal static func boardNamesById() -> [String: String] {
    guard let pool = TelemetryDatabase.pool else { return [:] }
    return (try? pool.read { db in
      try Row.fetchAll(db, sql: "SELECT id, name FROM boards").reduce(into: [String: String]()) {
        $0[$1["id"] as String] = $1["name"] as String
      }
    }) ?? [:]
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
  func updateFavorite(_ id: String, options: [String: Any]) -> [String: Any?]? {
    flushBlocking()
    guard let existing = FavoriteStore.shared.list().first(where: { $0.id == id }), let pool
    else { return nil }
    guard let range = Self.favoriteRange(options) else { return nil }
    let startMs = range.startMs
    let endMs = range.endMs
    let boardId = options["boardId"] as? String
    let trimmedName = (options["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let config = queue.sync { metricConfig }
    let points = (try? pool.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM telemetry_frames
          WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND (? IS NULL OR board_id = ?)
          ORDER BY captured_at_ms ASC
          """,
        arguments: [startMs, endMs, boardId, boardId]
      ).compactMap(bucketPoint)
    }) ?? []
    let updated = Favorite(
      id: existing.id,
      boardId: existing.boardId,
      name: (trimmedName?.isEmpty ?? true) ? nil : trimmedName,
      startMs: startMs,
      endMs: endMs,
      createdAtMs: existing.createdAtMs,
      updatedAtMs: telemetryNowMs(),
      summary: Self.favoriteSummary(points, config: config)
    )
    guard let stored = FavoriteStore.shared.update(updated) else { return nil }
    SyncCoordinator.shared.notifyRiderEdit()
    return stored.toMap(
      boardName: stored.boardId.flatMap { Self.boardNamesById()[$0] },
      routePoints: favoriteRoutePoints(stored)
    )
  }

  /// Unpin a Favorite. Telemetry in its range stays and becomes normally deletable (ADR 0029).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `deleteFavorite`
  func deleteFavorite(_ id: String) -> Bool {
    let deleted = FavoriteStore.shared.delete(id)
    if deleted {
      FavoriteMediaStore.shared.deleteDirectory(favoriteId: id)
      SyncCoordinator.shared.notifyRiderEdit()
    }
    return deleted
  }

  /// Read and reconcile Favorite Media. Missing files remove their manifest rows; temp/orphan files
  /// are deleted and never published to JS.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryRepository.kt `getFavoriteMedia`
  func getFavoriteMedia(_ favoriteId: String) -> [[String: Any?]] {
    FavoriteMediaStore.shared.list(favoriteId: favoriteId).map {
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
  internal static func favoriteSummary(
    _ points: [BucketTelemetryPoint],
    config: MetricSanitizerConfig
  ) -> FavoriteSummary {
    guard !points.isEmpty else { return FavoriteSummary() }
    let sanitization = sanitizeTelemetrySamples(points, config: config)
    var sanitized = points
    for i in sanitized.indices {
      sanitized[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
      sanitized[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
      sanitized[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
    }
    return buildFavoriteSummary(buildTelemetryBuckets(sanitized))
  }

  /// Retention sweep. Age-only while this database has never been bound to an Account, and age plus
  /// the accepted Sync Cursor once it has — cleanup must not remove a row the uploader has not
  /// delivered (#284).
  func deleteBefore(_ beforeMs: Int64) -> Int {
    guard let pool else { return 0 }
    return (try? pool.write { db in
      try deleteBeforeGated(db, beforeMs: beforeMs)
    }) ?? 0
  }

  func deleteRange(_ options: [String: Any]) -> Int {
    flushBlocking()
    guard let pool else { return 0 }
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? 0
    let boardId = options["boardId"] as? String
    guard toMs >= fromMs else { return 0 }
    let deletable = subtractProtectedTelemetryRanges(
      deleteRange: TelemetryTimeRange(startMs: fromMs, endMs: toMs),
      protectedRanges: favoriteTelemetryRanges()
    )
    let deleted = (try? pool.write { db in
      var count = 0
      for range in deletable {
        count += try Int.fetchOne(
          db,
          sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))",
          arguments: [range.startMs, range.endMs, boardId, boardId, boardId]
        ) ?? 0
        try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ? AND board_id = ?", arguments: [range.startMs, range.endMs, boardId ?? UNKNOWN_TELEMETRY_BOARD_ID])
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ?", arguments: [range.startMs, range.endMs])
        try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? AND ((? IS NOT NULL AND board_id = ?) OR (? IS NULL AND board_id IS NULL))", arguments: [range.startMs, range.endMs, boardId, boardId, boardId])
      }
      return count
    }) ?? 0
    return deleted
  }

  func rebuildBuckets(onProgress: (Int, Int) -> Void = { _, _ in }) -> Int {
    flushBlocking()
    guard let pool else { return 0 }
    return (try? pool.write { db in
      guard
        let firstMs = try Int64.fetchOne(db, sql: "SELECT MIN(captured_at_ms) FROM telemetry_frames"),
        let lastMs = try Int64.fetchOne(db, sql: "SELECT MAX(captured_at_ms) FROM telemetry_frames")
      else { return 0 }
      try db.execute(sql: "DELETE FROM telemetry_minute_buckets")
      try db.execute(sql: "DELETE FROM metric_exclusion_ranges")

      let chunkMs: Int64 = 3_600_000
      let chunks = Int((lastMs - firstMs) / chunkMs + 1)
      var rebuilt = 0
      onProgress(0, chunks)

      for index in 0..<chunks {
        let chunkFrom = firstMs + Int64(index) * chunkMs
        let chunkTo = min(chunkFrom + chunkMs - 1, lastMs)
        let rows = try Row.fetchAll(
          db,
          sql: """
            SELECT * FROM telemetry_frames
            WHERE captured_at_ms >= ? AND captured_at_ms <= ?
            ORDER BY captured_at_ms ASC
            """,
          arguments: [chunkFrom, chunkTo]
        )
        var points = rows.compactMap(bucketPoint)
        let sanitization = sanitizeTelemetrySamples(points, config: metricConfig)
        for i in points.indices {
          points[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
          points[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
          points[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
        }
        for range in sanitization.exclusions { try insertExclusion(db, range) }
        let buckets = buildTelemetryBuckets(points)
        for bucket in buckets {
          try upsertBucket(db, bucket)
          rebuilt += 1
        }
        onProgress(index + 1, chunks)
      }
      return rebuilt
    }) ?? 0
  }

  func clearAll() {
    flushBlocking()
    guard let pool else { return }
    let protected = favoriteTelemetryRanges()
    if protected.isEmpty {
      try? pool.write { db in
        try db.execute(sql: "DELETE FROM telemetry_frames")
        try db.execute(sql: "DELETE FROM telemetry_minute_buckets")
        try db.execute(sql: "DELETE FROM telemetry_markers")
        try db.execute(sql: "DELETE FROM metric_exclusion_ranges")
      }
    } else {
      let deletable = subtractProtectedTelemetryRanges(
        deleteRange: TelemetryTimeRange(startMs: Int64.min, endMs: Int64.max),
        protectedRanges: protected
      )
      try? pool.write { db in
        for range in deletable {
          try db.execute(
            sql: "DELETE FROM telemetry_frames WHERE captured_at_ms >= ? AND captured_at_ms <= ?",
            arguments: [range.startMs, range.endMs]
          )
          try db.execute(
            sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms >= ? AND occurred_at_ms <= ?",
            arguments: [range.startMs, range.endMs]
          )
          try db.execute(
            sql: "DELETE FROM telemetry_minute_buckets WHERE last_sample_at_ms >= ? AND first_sample_at_ms <= ?",
            arguments: [range.startMs, range.endMs]
          )
          try db.execute(
            sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms >= ? AND start_ms <= ?",
            arguments: [range.startMs, range.endMs]
          )
        }
      }
    }
    queue.sync {
      pendingStates.removeAll()
      pendingPersisted.removeAll()
      pendingMarkers.removeAll()
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
    FavoriteStore.shared.list().map {
      expandTelemetryRangeToBuckets(
        TelemetryTimeRange(startMs: $0.startMs, endMs: $0.endMs)
      )
    }
  }

  private func flushOnQueue() {
    guard let pool, (!pendingStates.isEmpty || !pendingPersisted.isEmpty || !pendingMarkers.isEmpty) else { return }
    let markers = pendingMarkers
    // Drop any fix inside an enabled Privacy Zone before it reaches storage. Fixes without a
    // location always pass. Bucket source (full rate) and persisted frames are filtered alike so
    // aggregates and detail traces stay consistent.
    let zones = enabledPrivacyZones
    let states = zones.isEmpty ? pendingStates : pendingStates.filter { !Self.isInPrivacyZone($0, zones) }
    let persisted = zones.isEmpty ? pendingPersisted : pendingPersisted.filter { !Self.isInPrivacyZone($0, zones) }
    pendingStates.removeAll(keepingCapacity: true)
    pendingPersisted.removeAll(keepingCapacity: true)
    pendingMarkers.removeAll(keepingCapacity: true)
    guard !states.isEmpty || !persisted.isEmpty || !markers.isEmpty else { return }

    let telemetryPoints = states.map { $0.toBucketPoint() }
    let sanitization = sanitizeTelemetrySamples(telemetryPoints, config: metricConfig)
    var sanitized = telemetryPoints
    for i in sanitized.indices {
      sanitized[i].excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed
      sanitized[i].excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed
      sanitized[i].excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty
    }
    let buckets = buildTelemetryBuckets(sanitized)

    try? pool.write { db in
      for state in persisted { try insertFrame(db, state) }
      for bucket in buckets { try upsertBucket(db, bucket) }
      for marker in markers { try insertMarker(db, marker) }
      for range in sanitization.exclusions { try insertExclusion(db, range) }
    }
    // Samples are actually being produced, which is what the uploader's ride cadence follows — Idle
    // Pause halts production without ending the Board Session.
    SyncCoordinator.shared.notifySamplesPersisted()
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
      try? pool.write { db in
        try db.execute(
          sql: """
            INSERT INTO diagnostic_events
              (occurred_at_ms, elapsed_realtime_ms, event_name, operation, phase, board_id, message, properties_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
          arguments: [occurredAtMs, elapsed, eventName, operation, phase, boardId, message, propertiesJson]
        )
      }
    }
  }

  func getDiagnosticEvents(_ options: [String: Any]) -> [[String: Any?]] {
    guard let pool else { return [] }
    let fromMs = telemetryLong(options["fromMs"]) ?? 0
    let toMs = telemetryLong(options["toMs"]) ?? telemetryNowMs()
    let boardId = options["boardId"] as? String
    let limit = min(1_000, max(1, telemetryInt(options["limit"]) ?? 200))
    return (try? pool.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM diagnostic_events
          WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? AND (? IS NULL OR board_id = ?)
          ORDER BY occurred_at_ms DESC
          LIMIT ?
          """,
        arguments: [fromMs, toMs, boardId, boardId, limit]
      ).map { row in
        [
          "id": row["id"] as Int64,
          "occurredAtMs": row["occurred_at_ms"] as Int64,
          "eventName": row["event_name"] as String,
          "operation": row["operation"] as String?,
          "phase": row["phase"] as String?,
          "boardId": row["board_id"] as String?,
          "message": row["message"] as String?,
          "propertiesJson": row["properties_json"] as String,
        ]
      }
    }) ?? []
  }

  func clearDiagnosticEvents() {
    guard let pool else { return }
    try? pool.write { db in try db.execute(sql: "DELETE FROM diagnostic_events") }
  }

  private static func encodeDiagnosticProperties(_ properties: [String: Any?]) -> String {
    var sanitized: [String: Any] = [:]
    for (key, value) in properties {
      switch value {
      case let value as String: sanitized[key] = value
      // `Bool` bridges to `NSNumber` (as a CFBoolean) so booleans still serialize as true/false.
      case let value as NSNumber: sanitized[key] = value
      case nil, is NSNull: continue
      case let value?: sanitized[key] = String(describing: value)
      }
    }
    guard
      let data = try? JSONSerialization.data(withJSONObject: sanitized),
      let json = String(data: data, encoding: .utf8)
    else { return "{}" }
    return json
  }
}
