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
  /// Sound string, or the `preset(<level>)…` spec of an Alert Preset row (see `AlertPresetSpec`).
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

/// Production Alert Rule CRUD shared by the app repository and host persistence contract.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct AlertRulePersistence {
  let writer: any DatabaseWriter

  enum PresetRuleEdit: Error { case notEditable }

  /// Rider rules plus expanded Alert Presets, the list every rule reader uses.
  func rules(boardId: String, reportPresetFailure: (Error) -> Void) throws -> [PersistedAlertRule] {
    try writer.read { db in try AlertPresetPersistence.expandedRules(db, boardId: boardId, reportFailure: reportPresetFailure) }
  }

  /// Each preset metric's stored `preset(…)` spec, the app default where the Board has no row.
  func presets(boardId: String) throws -> [String: String] {
    try writer.read { db in try AlertPresetPersistence.specs(db, boardId: boardId) }
  }

  /// Rider rules only: preset rows change through `applyAlertPreset`, expanded points never.
  func save(_ rule: PersistedAlertRule) throws {
    try Self.requireRiderRule(rule)
    try writer.write { db in try rule.save(db) }
  }

  /// Throws unless `rule` is a rider's rule: not a preset id and not a preset spec.
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
