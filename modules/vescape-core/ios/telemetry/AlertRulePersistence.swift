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
  var spec: String
  let createdAt: Int64
  let repeatEverySeconds: Int64?
  let thresholdKind: String
  let configFieldId: String?
  let thresholdOffset: Double?
  let thresholdMaxOffset: Double?

  enum CodingKeys: String, CodingKey {
    case boardId = "board_id", id, controlId = "control_id", threshold
    case thresholdMax = "threshold_max", enabled, spec, createdAt = "created_at"
    case repeatEverySeconds = "repeat_every_seconds"
    case thresholdKind = "threshold_kind", configFieldId = "config_field_id"
    case thresholdOffset = "threshold_offset", thresholdMaxOffset = "threshold_max_offset"
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
struct AlertRulePersistence {
  let writer: any DatabaseWriter

  enum PresetRuleEdit: Error { case notEditable }

  func rules(boardId: String, reportPresetFailure: (Error) -> Void) throws -> [PersistedAlertRule] {
    try writer.read { db in try AlertPresetPersistence.expandedRules(db, boardId: boardId, reportFailure: reportPresetFailure) }
  }

  func presets(boardId: String) throws -> [String: String] {
    try writer.read { db in try AlertPresetPersistence.specs(db, boardId: boardId) }
  }

  func save(_ rule: PersistedAlertRule) throws {
    try Self.requireRiderRule(rule)
    try writer.write { db in try rule.save(db) }
  }

  static func requireRiderRule(_ rule: PersistedAlertRule) throws {
    try requireRider(rule.id)
    guard AlertPresetSpec.parse(rule.spec) == nil else { throw PresetRuleEdit.notEditable }
  }

  private static func requireRider(_ id: String) throws {
    guard !AlertPresetPersistence.isPresetId(id) else { throw PresetRuleEdit.notEditable }
  }

  func setEnabled(boardId: String, id: String, enabled: Bool) throws {
    try Self.requireRider(id)
    _ = try writer.write { db in
      try PersistedAlertRule
        .filter(Column("board_id") == boardId && Column("id") == id)
        .updateAll(db, Column("enabled").set(to: enabled))
    }
  }

  func delete(boardId: String, id: String) throws {
    try Self.requireRider(id)
    try writer.write { db in
      _ = try PersistedAlertRule
        .filter(Column("board_id") == boardId && Column("id") == id)
        .deleteAll(db)
    }
  }
}
