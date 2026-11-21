import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `FavoriteEntity`
/// @parity /modules/vescape-core/src/index.ts `Favorite`
struct Favorite {
  let id: String
  let boardId: String?
  let name: String?
  let startMs: Int64
  let endMs: Int64
  let createdAtMs: Int64
  let updatedAtMs: Int64
  let summary: FavoriteSummary

  func toMap(
    boardName: String?,
    routePoints: [[String: Any]] = [],
    weather: RideWeather? = nil
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
      "weather": weather?.map,
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt `FavoriteSummary`
struct FavoriteSummary {
  var sampleCount = 0
  var gpsPointCount = 0
  var distanceCm: Int64?
  var movingDurationMs: Int64 = 0
  var avgSpeedCentiKmh = 0
  var maxSpeedCentiKmh = 0
  var batteryUsedWhMilli: Int64 = 0
}

private struct FavoriteRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "favorites"
  let id: String
  let boardId: String?
  let name: String?
  let startMs: Int64
  let endMs: Int64
  let createdAt: Int64
  let updatedAt: Int64
  let sampleCount: Int
  let gpsPointCount: Int
  let distanceCm: Int64?
  let movingDurationMs: Int64
  let avgSpeedCentiKmh: Int
  let maxSpeedCentiKmh: Int
  let batteryUsedWhMilli: Int64

  init(_ favorite: Favorite) {
    id = favorite.id; boardId = favorite.boardId; name = favorite.name
    startMs = favorite.startMs; endMs = favorite.endMs
    createdAt = favorite.createdAtMs; updatedAt = favorite.updatedAtMs
    sampleCount = favorite.summary.sampleCount; gpsPointCount = favorite.summary.gpsPointCount
    distanceCm = favorite.summary.distanceCm; movingDurationMs = favorite.summary.movingDurationMs
    avgSpeedCentiKmh = favorite.summary.avgSpeedCentiKmh
    maxSpeedCentiKmh = favorite.summary.maxSpeedCentiKmh
    batteryUsedWhMilli = favorite.summary.batteryUsedWhMilli
  }

  enum CodingKeys: String, CodingKey {
    case id, name
    case boardId = "board_id", startMs = "start_ms", endMs = "end_ms"
    case createdAt = "created_at", updatedAt = "updated_at"
    case sampleCount = "sample_count", gpsPointCount = "gps_point_count"
    case distanceCm = "distance_cm", movingDurationMs = "moving_duration_ms"
    case avgSpeedCentiKmh = "avg_speed_centi_kmh", maxSpeedCentiKmh = "max_speed_centi_kmh"
    case batteryUsedWhMilli = "battery_used_wh_milli"
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt `persistFavorite`
internal func persistFavorite(
  store: FavoriteStore,
  existingId: String?,
  range: TelemetryTimeRange,
  boardId: String?,
  name: String?,
  nowMs: Int64,
  newId: () -> String,
  loadSummary: (TelemetryTimeRange, String?) throws -> FavoriteSummary
) throws -> Favorite? {
  let existing = try existingId.flatMap { id in try store.list().first { $0.id == id } }
  if existingId != nil, existing == nil { return nil }
  let resolvedBoardId = existing == nil ? boardId : existing!.boardId
  let favorite = Favorite(
    id: existing?.id ?? newId(), boardId: resolvedBoardId, name: name,
    startMs: range.startMs, endMs: range.endMs,
    createdAtMs: existing?.createdAtMs ?? nowMs, updatedAtMs: nowMs,
    summary: try loadSummary(range, resolvedBoardId)
  )
  if existing == nil { try store.insert(favorite); return favorite }
  return try store.update(favorite)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt `buildFavoriteSummary`
/// @platform-diff Distance uses the odometer delta only. iOS never fills `gps_distance_cm` (its
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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
struct FavoriteStore {
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = FavoriteStore { VescapeDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `FavoriteEntity`
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createFavorites(db)
  }

  func list() throws -> [Favorite] {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    return try writer.read { db in
      try Row.fetchAll(db, sql: "SELECT * FROM favorites ORDER BY start_ms DESC").map(Self.favorite)
    }
  }

  func insert(_ favorite: Favorite) throws {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    try writer.write { db in try FavoriteRecord(favorite).insert(db) }
  }

  func update(_ favorite: Favorite) throws -> Favorite? {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    return try writer.write { db -> Favorite? in
      guard try FavoriteRecord.fetchOne(db, key: favorite.id) != nil else { return nil }
      try FavoriteRecord(favorite).update(db)
      return try Row.fetchOne(
        db,
        sql: "SELECT * FROM favorites WHERE id = ?",
        arguments: [favorite.id]
      )
        .map(Self.favorite)
    }
  }

  @discardableResult
  func delete(_ id: String) throws -> Bool {
    guard let writer = resolveWriter() else { throw FavoriteMediaStoreError.manifestWriteFailed }
    return try writer.write { db in
      try db.execute(sql: "DELETE FROM favorite_media WHERE favorite_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM favorites WHERE id = ?", arguments: [id])
      return db.changesCount > 0
    }
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
