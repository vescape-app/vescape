import Foundation
import GRDB

private struct MotorConfigRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "motor_config_values"
  let boardId: String; let mcconfSignature: Int64; let firmware: String; let valuesJson: String; let capturedAt: Int64
  enum CodingKeys: String, CodingKey { case boardId = "board_id"; case mcconfSignature = "mcconf_signature"; case firmware; case valuesJson = "values_json"; case capturedAt = "captured_at" }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getLatestMotorConfigValues`
struct MotorConfigStore {
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = MotorConfigStore { VescapeDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createMotorConfig(db)
  }

  func loadLatest(boardId: String) throws -> MotorConfigValues? {
    guard !boardId.isEmpty else { return nil }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    guard let row = try writer.read({ db in try MotorConfigRecord.filter(Column("board_id") == boardId).order(Column("captured_at").desc).fetchOne(db) }) else { return nil }
    return try MotorConfigValues.lastKnown(
      boardId: boardId,
      signature: UInt32(truncatingIfNeeded: row.mcconfSignature), firmware: row.firmware,
      capturedAtMs: row.capturedAt, valuesJson: row.valuesJson
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `saveFreshMotorConfigValues`
  func saveFresh(_ values: MotorConfigValues) throws {
    guard let boardId = values.boardId, !boardId.isEmpty else { return }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    var notice: BoardConfigChangeNotice?
    var committed = false
    try writer.write { db in
      let oldRow = try MotorConfigRecord.filter(Column("board_id") == boardId).order(Column("captured_at").desc).fetchOne(db)
      if let oldRow, oldRow.mcconfSignature == Int64(values.signature) {
        let old = try MotorConfigValues.lastKnown(
          boardId: boardId,
          signature: values.signature,
          firmware: oldRow.firmware,
          capturedAtMs: 0,
          valuesJson: oldRow.valuesJson
        )
        let ignored = try BoardConfigChangeNotice.loadIgnoredFields(db, boardId: boardId)
          .union(BoardConfigChangeNotice.volatileMotorFields)
        let diffs = BoardConfigChangeNotice.diff(old: old.values, new: values.values, schema: nil, ignoredFields: ignored)
        if !diffs.isEmpty {
          let existing = try Row.fetchOne(
            db,
            sql: "SELECT diffs_json FROM board_config_change_notices WHERE board_id = ?",
            arguments: [boardId]
          )
          let existingDiffsJson: String? = existing?["diffs_json"]
          let previous = try existingDiffsJson
            .map { try BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: 0, diffsJson: $0).diffs } ?? []
          let merged = BoardConfigChangeNotice.mergeDiffs(previous: previous, incoming: diffs)
          let built = BoardConfigChangeNotice(boardId: boardId, detectedAtMs: values.capturedAtMs, diffs: merged)
          notice = built
          try ConfigNoticeRecord(boardId: boardId, detectedAt: values.capturedAtMs, diffsJson: built.diffsJson()).save(db)
        }
      }
      try MotorConfigRecord(boardId: boardId, mcconfSignature: Int64(values.signature), firmware: values.firmware, valuesJson: try values.valuesJson(), capturedAt: values.capturedAtMs).save(db)
      committed = true
    }
    if committed, let notice { BoardConfigStore.onNoticeChanged?(notice) }
  }

  func clear(boardId: String) throws {
    guard !boardId.isEmpty else { return }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    try writer.write { db in
      try db.execute(sql: "DELETE FROM motor_config_values WHERE board_id = ?", arguments: [boardId])
    }
  }
}
