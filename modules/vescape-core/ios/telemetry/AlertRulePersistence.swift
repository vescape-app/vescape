import Foundation
import GRDB

struct PersistedAlertRule: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "alerts"
  let boardId: String
  let id: String
  let controlId: String
  let threshold: Double
  let thresholdMax: Double?
  let enabled: Bool
  let soundType: String
  let createdAt: Int64
  let repeatEverySeconds: Int64?
  let beepCount: Int
  let source: String?
  let thresholdKind: String
  let configFieldId: String?
  let thresholdOffset: Double?
  let thresholdMaxOffset: Double?

  enum CodingKeys: String, CodingKey {
    case boardId = "board_id", id, controlId = "control_id", threshold
    case thresholdMax = "threshold_max", enabled, soundType = "sound_type", createdAt = "created_at"
    case repeatEverySeconds = "repeat_every_seconds", beepCount = "beep_count", source
    case thresholdKind = "threshold_kind", configFieldId = "config_field_id"
    case thresholdOffset = "threshold_offset", thresholdMaxOffset = "threshold_max_offset"
  }
}

/// Production Alert Rule CRUD shared by the app repository and host persistence contract.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct AlertRulePersistence {
  let writer: any DatabaseWriter

  func rules(boardId: String) throws -> [PersistedAlertRule] {
    try writer.read { db in
      try PersistedAlertRule
        .filter(Column("board_id") == boardId)
        .order(Column("created_at"))
        .fetchAll(db)
    }
  }

  func save(_ rule: PersistedAlertRule) throws {
    try writer.write { db in try rule.save(db) }
  }

  func setEnabled(boardId: String, id: String, enabled: Bool) throws {
    _ = try writer.write { db in
      try PersistedAlertRule
        .filter(Column("board_id") == boardId && Column("id") == id)
        .updateAll(db, Column("enabled").set(to: enabled))
    }
  }

  func delete(boardId: String, id: String) throws {
    try writer.write { db in
      _ = try PersistedAlertRule
        .filter(Column("board_id") == boardId && Column("id") == id)
        .deleteAll(db)
    }
  }
}
