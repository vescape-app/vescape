import Foundation
import GRDB

/// One Favorite: a durable, optionally named time range over Ride History (ADR 0029). Identity and
/// timestamps are native-minted — JS may only supply the range and the name.
///
/// Summary stats are denormalized at creation/update from raw Telemetry Samples (ADR 0005 style)
/// because minute buckets are too coarse for a range that cuts mid-bucket.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `FavoriteEntity`
/// @parity /modules/vescape-core/src/index.ts `Favorite`
struct Favorite {
  let id: String
  /// Owning Board (`boards.id`), or `nil` when the recorded samples match no saved Board. Never the
  /// BLE peripheral id: that changes on re-link and differs per install, so it is not an identity.
  let boardId: String?
  let name: String?
  let startMs: Int64
  let endMs: Int64
  let createdAtMs: Int64
  let updatedAtMs: Int64
  let summary: FavoriteSummary

  /// Board name is resolved on read from `boards`, not snapshotted, so renames propagate.
  func toMap(
    boardName: String?,
    routePoints: [[String: Double]] = []
  ) -> [String: Any?] {
    [
      "id": id,
      "boardId": boardId,
      "boardName": boardName,
      "name": name,
      "startMs": startMs,
      "endMs": endMs,
      "createdAtMs": createdAtMs,
      "updatedAtMs": updatedAtMs,
      "sampleCount": summary.sampleCount,
      "gpsPointCount": summary.gpsPointCount,
      "distanceM": summary.distanceCm.map { Double($0) / 100.0 },
      "movingDurationMs": summary.movingDurationMs,
      "avgSpeedKmh": Double(summary.avgSpeedCentiKmh) / 100.0,
      "maxSpeedKmh": Double(summary.maxSpeedCentiKmh) / 100.0,
      "batteryUsedWh": Double(summary.batteryUsedWhMilli) / 1000.0,
      "routePoints": routePoints,
    ]
  }
}

/// Denormalized ride stats for one Favorite range, mirroring the history session summary fields.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt `FavoriteSummary`
struct FavoriteSummary {
  var sampleCount = 0
  var gpsPointCount = 0
  /// Odometer delta across the range, or `nil` when the range carries no odometer readings.
  var distanceCm: Int64?
  var movingDurationMs: Int64 = 0
  var avgSpeedCentiKmh = 0
  var maxSpeedCentiKmh = 0
  var batteryUsedWhMilli: Int64 = 0
}

/// Aggregate the buckets built from a Favorite's raw samples into one denormalized summary. Pure so
/// both the create path and its tests share one definition. Mirrors how JS collapses minute buckets
/// into a history session summary.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt `buildFavoriteSummary`
/// @platform-diff Distance uses the odometer delta only. iOS never fills `gps_distance_cm` (its
/// bucket writer stores 0), so the Android GPS-distance fallback has no iOS counterpart yet.
internal func buildFavoriteSummary(_ buckets: [TelemetryBucket]) -> FavoriteSummary {
  var summary = FavoriteSummary()
  guard !buckets.isEmpty else { return summary }

  var sumAbsSpeed: Int64 = 0
  var sumMovingSpeed: Int64 = 0
  var movingSampleCount = 0
  var distanceCm: Int64?
  var firstMovingAtMs: Int64?
  var lastMovingAtMs: Int64?
  var firstSampleAtMs = Int64.max
  var lastSampleAtMs = Int64.min

  for bucket in buckets.sorted(by: { $0.bucketStartMs < $1.bucketStartMs }) {
    summary.sampleCount += bucket.sampleCount
    summary.gpsPointCount += bucket.gpsPointCount
    sumAbsSpeed += bucket.sumAbsSpeedCentiKmh
    sumMovingSpeed += bucket.sumMovingAbsSpeedCentiKmh
    movingSampleCount += bucket.movingSpeedSampleCount
    summary.maxSpeedCentiKmh = max(summary.maxSpeedCentiKmh, bucket.maxAbsSpeedCentiKmh)
    summary.batteryUsedWhMilli += bucket.batteryUsedWhMilli
    if let first = bucket.firstOdometerCm, let last = bucket.lastOdometerCm {
      distanceCm = (distanceCm ?? 0) + max(0, last - first)
    }
    if let moving = bucket.firstMovingAtMs { firstMovingAtMs = min(firstMovingAtMs ?? moving, moving) }
    if let moving = bucket.lastMovingAtMs { lastMovingAtMs = max(lastMovingAtMs ?? moving, moving) }
    firstSampleAtMs = min(firstSampleAtMs, bucket.firstSampleAtMs)
    lastSampleAtMs = max(lastSampleAtMs, bucket.lastSampleAtMs)
  }

  summary.distanceCm = distanceCm
  // Moving Window when the range has moving samples, otherwise the wall-clock span it covers —
  // the same fallback JS applies to legacy rides with no precomputed window.
  if let first = firstMovingAtMs, let last = lastMovingAtMs {
    summary.movingDurationMs = max(0, last - first)
  } else if firstSampleAtMs <= lastSampleAtMs {
    summary.movingDurationMs = max(0, lastSampleAtMs - firstSampleAtMs)
  }
  if movingSampleCount > 0 {
    summary.avgSpeedCentiKmh = Int(sumMovingSpeed / Int64(movingSampleCount))
  } else if summary.sampleCount > 0 {
    summary.avgSpeedCentiKmh = Int(sumAbsSpeed / Int64(summary.sampleCount))
  }
  return summary
}

/// DB-backed storage for Favorites. Pure CRUD: the range is pinned against telemetry deletion by the
/// delete paths, not here, and removing a row only unpins (ADR 0029).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct FavoriteStore {
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = FavoriteStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  // MARK: - Schema

  /// Create the Favorites table. Called from the app-data `DatabaseMigrator` and reused by tests so
  /// the schema stays single-source. Mirrors Android `FavoriteEntity`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `FavoriteEntity`
  static func createTables(_ db: Database) throws {
    try db.execute(sql: """
      CREATE TABLE favorites (
        id TEXT NOT NULL PRIMARY KEY,
        board_id TEXT,
        name TEXT,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sample_count INTEGER NOT NULL,
        gps_point_count INTEGER NOT NULL,
        distance_cm INTEGER,
        moving_duration_ms INTEGER NOT NULL,
        avg_speed_centi_kmh INTEGER NOT NULL,
        max_speed_centi_kmh INTEGER NOT NULL,
        battery_used_wh_milli INTEGER NOT NULL
      )
      """)
    try db.execute(sql: "CREATE INDEX index_favorites_start_ms_end_ms ON favorites(start_ms, end_ms)")
    try db.execute(sql: "CREATE INDEX index_favorites_board_id ON favorites(board_id)")
  }

  // MARK: - Reads

  func list() -> [Favorite] {
    guard let writer = resolveWriter() else { return [] }
    return (try? writer.read { db in
      try Row.fetchAll(db, sql: "SELECT * FROM favorites ORDER BY start_ms DESC").map(Self.favorite)
    }) ?? []
  }

  // MARK: - Writes

  /// Insert a Favorite whose identity and timestamps were minted by the caller's native clock.
  @discardableResult
  func insert(_ favorite: Favorite) -> Bool {
    guard let writer = resolveWriter() else { return false }
    do {
      try writer.write { db in
        try db.execute(
          sql: """
            INSERT INTO favorites (
              id, board_id, name, start_ms, end_ms, created_at, updated_at,
              sample_count, gps_point_count, distance_cm, moving_duration_ms,
              avg_speed_centi_kmh, max_speed_centi_kmh, battery_used_wh_milli
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
          arguments: [
            favorite.id, favorite.boardId, favorite.name,
            favorite.startMs, favorite.endMs, favorite.createdAtMs, favorite.updatedAtMs,
            favorite.summary.sampleCount, favorite.summary.gpsPointCount, favorite.summary.distanceCm,
            favorite.summary.movingDurationMs, favorite.summary.avgSpeedCentiKmh,
            favorite.summary.maxSpeedCentiKmh, favorite.summary.batteryUsedWhMilli,
          ]
        )
      }
      return true
    } catch {
      return false
    }
  }

  /// Re-trim/rename one row in place so identity, creation time and Favorite Media remain stable.
  func update(_ favorite: Favorite) -> Favorite? {
    guard let writer = resolveWriter() else { return nil }
    let updated = try? writer.write { db -> Favorite? in
      try db.execute(
        sql: """
          UPDATE favorites SET
            name = ?, start_ms = ?, end_ms = ?, updated_at = ?,
            sample_count = ?, gps_point_count = ?, distance_cm = ?, moving_duration_ms = ?,
            avg_speed_centi_kmh = ?, max_speed_centi_kmh = ?, battery_used_wh_milli = ?
          WHERE id = ?
          """,
        arguments: [
          favorite.name, favorite.startMs, favorite.endMs, favorite.updatedAtMs,
          favorite.summary.sampleCount, favorite.summary.gpsPointCount,
          favorite.summary.distanceCm, favorite.summary.movingDurationMs,
          favorite.summary.avgSpeedCentiKmh, favorite.summary.maxSpeedCentiKmh,
          favorite.summary.batteryUsedWhMilli, favorite.id,
        ]
      )
      guard db.changesCount > 0 else { return nil }
      return try Row.fetchOne(
        db,
        sql: "SELECT * FROM favorites WHERE id = ?",
        arguments: [favorite.id]
      )
        .map(Self.favorite)
    }
    return updated ?? nil
  }

  /// Unpin one Favorite. Telemetry inside its range is untouched and becomes deletable again.
  /// Favorite Media rows are parent-covered and raw-deleted in the same transaction (ADR 0030);
  /// filesystem cleanup is best-effort in the repository after this commit succeeds.
  @discardableResult
  func delete(_ id: String) -> Bool {
    guard let writer = resolveWriter() else { return false }
    return (try? writer.write { db in
      try db.execute(sql: "DELETE FROM favorite_media WHERE favorite_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM favorites WHERE id = ?", arguments: [id])
      return db.changesCount > 0
    }) ?? false
  }

  private static func favorite(_ row: Row) -> Favorite {
    Favorite(
      id: row["id"] as String,
      boardId: row["board_id"] as String?,
      name: row["name"] as String?,
      startMs: row["start_ms"] as Int64,
      endMs: row["end_ms"] as Int64,
      createdAtMs: row["created_at"] as Int64,
      updatedAtMs: row["updated_at"] as Int64,
      summary: FavoriteSummary(
        sampleCount: row["sample_count"] as Int,
        gpsPointCount: row["gps_point_count"] as Int,
        distanceCm: row["distance_cm"] as Int64?,
        movingDurationMs: row["moving_duration_ms"] as Int64,
        avgSpeedCentiKmh: row["avg_speed_centi_kmh"] as Int,
        maxSpeedCentiKmh: row["max_speed_centi_kmh"] as Int,
        batteryUsedWhMilli: row["battery_used_wh_milli"] as Int64
      )
    )
  }
}
