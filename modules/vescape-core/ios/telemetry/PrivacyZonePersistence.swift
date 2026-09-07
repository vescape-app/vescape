import GRDB

struct PersistedPrivacyZone: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "privacy_zones"
  let id: String
  let preset: String
  let name: String
  let enabled: Bool
  let centerLatitudeE7: Int64
  let centerLongitudeE7: Int64
  let radiusMeters: Int64
  let createdAt: Int64
  let updatedAt: Int64

  enum CodingKeys: String, CodingKey {
    case id, preset, name, enabled
    case centerLatitudeE7 = "center_latitude_e7"
    case centerLongitudeE7 = "center_longitude_e7"
    case radiusMeters = "radius_meters"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }
}

/// Production Privacy Zone operations shared by the app adapter and host persistence contract.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct PrivacyZonePersistence {
  let writer: any DatabaseWriter

  func zones(enabledOnly: Bool = false) throws -> [PersistedPrivacyZone] {
    try writer.read { db in
      var request = PersistedPrivacyZone.order(Column("created_at").asc)
      if enabledOnly { request = request.filter(Column("enabled") == true) }
      return try request.fetchAll(db)
    }
  }

  func save(_ zone: PersistedPrivacyZone) throws {
    try writer.write { db in try zone.save(db) }
  }

  func setEnabled(id: String, enabled: Bool, updatedAt: Int64) throws {
    try writer.write { db in
      try db.execute(sql: "UPDATE privacy_zones SET enabled = ?, updated_at = ? WHERE id = ?", arguments: [enabled, updatedAt, id])
    }
  }

  func delete(id: String) throws {
    _ = try writer.write { db in try PersistedPrivacyZone.deleteOne(db, key: id) }
  }
}
