import Foundation
import GRDB

struct PersistedBoard: Decodable, FetchableRecord, TableRecord {
  static let databaseTableName = "boards"
  let id: String
  let name: String
  let bleId: String?
  let createdAt: Int64
  let deletedAt: Int64?
  var key: Int64? = nil

  enum CodingKeys: String, CodingKey {
    case id, name, key
    case bleId = "ble_id"
    case createdAt = "created_at"
    case deletedAt = "deleted_at"
  }

  static func fetch(_ db: Database, id: String) throws -> PersistedBoard? {
    try PersistedBoard.filter(Column("id") == id).fetchOne(db)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `saveBoardRow`
  func saveBoardRow(_ db: Database) throws {
    try db.execute(
      sql: "UPDATE boards SET name = ?, ble_id = ?, created_at = ?, deleted_at = ? WHERE id = ?",
      arguments: [name, bleId, createdAt, deletedAt, id]
    )
    guard db.changesCount == 0 else { return }
    try db.execute(
      sql: "INSERT INTO boards (id, name, ble_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?)",
      arguments: [id, name, bleId, createdAt, deletedAt]
    )
  }
}

struct PersistedBoardSetting: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_settings"
  let boardId: String
  let key: String
  let valueJson: String
  let updatedAt: Int64

  enum CodingKeys: String, CodingKey {
    case key
    case boardId = "board_id"
    case valueJson = "value_json"
    case updatedAt = "updated_at"
  }
}

struct PersistedAppSetting: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "app_settings"
  let key: String
  let valueJson: String
  let updatedAt: Int64

  enum CodingKeys: String, CodingKey {
    case key
    case valueJson = "value_json"
    case updatedAt = "updated_at"
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BoardSettingsPersistence.kt
final class BoardSettingsPersistence {
  private let writer: any DatabaseWriter

  init(writer: any DatabaseWriter) { self.writer = writer }

  func liveBoards() throws -> [PersistedBoard] {
    try writer.read { db in
      try PersistedBoard.filter(Column("deleted_at") == nil).order(Column("created_at")).fetchAll(db)
    }
  }

  func board(id: String) throws -> PersistedBoard? {
    try writer.read { db in try PersistedBoard.fetch(db, id: id) }
  }

  func boardSettings(ids: [String]) throws -> [PersistedBoardSetting] {
    guard !ids.isEmpty else { return [] }
    return try writer.read { db in
      try PersistedBoardSetting.filter(ids.contains(Column("board_id"))).fetchAll(db)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `upsertBoardWithSettings`
  func upsertBoard(_ board: PersistedBoard, settings: [PersistedBoardSetting], deletedKeys: [String], alerts: [PersistedAlertRule] = []) throws {
    try writer.write { db in
      let tombstone = try PersistedBoard.fetch(db, id: board.id)?.deletedAt
      try PersistedBoard(
        id: board.id, name: board.name, bleId: board.bleId,
        createdAt: board.createdAt, deletedAt: tombstone ?? board.deletedAt
      ).saveBoardRow(db)
      for key in deletedKeys {
        _ = try PersistedBoardSetting
          .filter(Column("board_id") == board.id && Column("key") == key)
          .deleteAll(db)
      }
      for setting in settings { try setting.save(db) }
      guard !alerts.isEmpty else { return }
      guard tombstone == nil && board.deletedAt == nil else { throw AlertPresetPersistence.InvalidPreset.missingBoard }
      for alert in alerts { try alert.save(db) }
    }
  }

  func tombstoneBoard(id: String, deletedAt: Int64) throws {
    try writer.write { db in
      guard var board = try PersistedBoard.fetch(db, id: id), board.deletedAt == nil else { return }
      _ = try PersistedBoardSetting.filter(Column("board_id") == id).deleteAll(db)
      try db.execute(sql: "DELETE FROM board_warnings WHERE board_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM alerts WHERE board_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM board_config_values WHERE board_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM board_config_change_notices WHERE board_id = ?", arguments: [id])
      board = PersistedBoard(id: board.id, name: board.name, bleId: board.bleId, createdAt: board.createdAt, deletedAt: deletedAt)
      try board.saveBoardRow(db)
    }
  }

  func settings() throws -> [PersistedAppSetting] {
    try writer.read { db in try PersistedAppSetting.fetchAll(db) }
  }

  func setting(_ key: String) throws -> PersistedAppSetting? {
    try writer.read { db in try PersistedAppSetting.fetchOne(db, key: key) }
  }

  func settings(defaults: [String: Any]) throws -> [String: Any] {
    var merged = defaults
    for setting in try settings() {
      let value = try JSONSerialization.jsonObject(with: Data(setting.valueJson.utf8), options: [.fragmentsAllowed])
      merged[setting.key] = value
    }
    return merged
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `updateDistanceUnit`
  func updateDistanceUnit(_ units: String) throws {
    precondition(["km", "mi"].contains(units))
    try writer.write { db in
      let json = String(decoding: try JSONSerialization.data(withJSONObject: units, options: [.fragmentsAllowed]), as: UTF8.self)
      try PersistedAppSetting(key: "distanceUnit", valueJson: json, updatedAt: Int64(Date().timeIntervalSince1970 * 1000)).save(db)
    }
  }

  func saveSetting(_ setting: PersistedAppSetting) throws {
    try writer.write { db in try setting.save(db) }
  }

  func saveBoardSetting(_ setting: PersistedBoardSetting) throws {
    try writer.write { db in try setting.save(db) }
  }

  func saveSettings(_ settings: [PersistedAppSetting]) throws {
    try writer.write { db in for setting in settings { try setting.save(db) } }
  }

  func replaceSettings(_ settings: [PersistedAppSetting?], keys: [String]) throws {
    precondition(settings.count == keys.count)
    try writer.write { db in
      for (setting, key) in zip(settings, keys) {
        if let setting { try setting.save(db) }
        else { _ = try PersistedAppSetting.deleteOne(db, key: key) }
      }
    }
  }

  func deleteSetting(_ key: String) throws {
    try writer.write { db in _ = try PersistedAppSetting.deleteOne(db, key: key) }
  }
}
