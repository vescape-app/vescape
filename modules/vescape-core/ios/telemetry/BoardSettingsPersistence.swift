import Foundation
import GRDB

struct PersistedBoard: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "boards"
  let id: String
  let name: String
  let bleId: String?
  let transport: String?
  let createdAt: Int64
  let deletedAt: Int64?

  enum CodingKeys: String, CodingKey {
    case id, name, transport
    case bleId = "ble_id"
    case createdAt = "created_at"
    case deletedAt = "deleted_at"
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

/// Production Board/settings GRDB operations. The app adapter and macOS contract call this exact code.
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
    try writer.read { db in try PersistedBoard.fetchOne(db, key: id) }
  }

  func boardSettings(ids: [String]) throws -> [PersistedBoardSetting] {
    guard !ids.isEmpty else { return [] }
    return try writer.read { db in
      try PersistedBoardSetting.filter(ids.contains(Column("board_id"))).fetchAll(db)
    }
  }

  func upsertBoard(_ board: PersistedBoard, settings: [PersistedBoardSetting], deletedKeys: [String]) throws {
    try writer.write { db in
      let tombstone = try PersistedBoard.fetchOne(db, key: board.id)?.deletedAt
      try PersistedBoard(
        id: board.id, name: board.name, bleId: board.bleId, transport: board.transport,
        createdAt: board.createdAt, deletedAt: tombstone ?? board.deletedAt
      ).save(db)
      for key in deletedKeys {
        _ = try PersistedBoardSetting
          .filter(Column("board_id") == board.id && Column("key") == key)
          .deleteAll(db)
      }
      for setting in settings { try setting.save(db) }
    }
  }

  func tombstoneBoard(id: String, deletedAt: Int64) throws {
    try writer.write { db in
      guard var board = try PersistedBoard.fetchOne(db, key: id), board.deletedAt == nil else { return }
      _ = try PersistedBoardSetting.filter(Column("board_id") == id).deleteAll(db)
      try db.execute(sql: "DELETE FROM board_warnings WHERE board_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM alerts WHERE board_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM board_config_values WHERE board_id = ?", arguments: [id])
      try db.execute(sql: "DELETE FROM board_config_change_notices WHERE board_id = ?", arguments: [id])
      board = PersistedBoard(id: board.id, name: board.name, bleId: board.bleId, transport: board.transport, createdAt: board.createdAt, deletedAt: deletedAt)
      try board.update(db)
    }
  }

  func settings() throws -> [PersistedAppSetting] {
    try writer.read { db in try PersistedAppSetting.fetchAll(db) }
  }

  func settings(defaults: [String: Any]) throws -> [String: Any] {
    var merged = defaults
    for setting in try settings() {
      let value = try JSONSerialization.jsonObject(with: Data(setting.valueJson.utf8), options: [.fragmentsAllowed])
      merged[setting.key] = value
    }
    return merged
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

  func deleteSetting(_ key: String) throws {
    try writer.write { db in _ = try PersistedAppSetting.deleteOne(db, key: key) }
  }
}
