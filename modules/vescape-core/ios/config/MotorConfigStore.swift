import Foundation
import GRDB

/// DB-backed Last Known Motor Config Values, one row per Board and MCCONF signature — the signature
/// is the layout identity, so values only mean anything against the one they were read under
/// (ADR 0036).
///
/// A restored row comes back `lastKnown`: displayable, and never a write base — motor config is
/// read-only permanently. Rows are deleted for the whole Board when link integrity goes `mismatched`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getLatestMotorConfigValues`
struct MotorConfigStore {
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = MotorConfigStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// Create the Last Known Motor Config Values table. Called from the app-data `DatabaseMigrator`
  /// and reused by tests so the schema stays single-source.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt
  static func createTables(_ db: Database) throws {
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS motor_config_values (
        board_id TEXT NOT NULL,
        mcconf_signature INTEGER NOT NULL,
        firmware TEXT NOT NULL,
        values_json TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        PRIMARY KEY (board_id, mcconf_signature)
      )
      """)
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_motor_config_values_board_id ON motor_config_values(board_id)")
  }

  /// The Board's most recently captured values, whatever signature they were read under. The live
  /// board's signature is unknown until it answers, so the caller restores optimistically and lets
  /// the session's own read replace this.
  func loadLatest(boardId: String) -> MotorConfigValues? {
    guard !boardId.isEmpty, let writer = resolveWriter() else { return nil }
    let row = try? writer.read { db in
      try Row.fetchOne(
        db,
        sql: """
          SELECT mcconf_signature, firmware, values_json, captured_at FROM motor_config_values
          WHERE board_id = ? ORDER BY captured_at DESC LIMIT 1
          """,
        arguments: [boardId]
      )
    }
    guard let row = row ?? nil else { return nil }
    let signature: Int64 = row["mcconf_signature"]
    return MotorConfigValues.lastKnown(
      boardId: boardId,
      signature: UInt32(truncatingIfNeeded: signature),
      firmware: row["firmware"],
      capturedAtMs: row["captured_at"],
      valuesJson: row["values_json"]
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `saveMotorConfigValues`
  func save(_ values: MotorConfigValues) {
    guard let boardId = values.boardId, !boardId.isEmpty, let writer = resolveWriter() else { return }
    try? writer.write { db in
      try db.execute(
        sql: """
          INSERT INTO motor_config_values (board_id, mcconf_signature, firmware, values_json, captured_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(board_id, mcconf_signature) DO UPDATE SET
            firmware = excluded.firmware,
            values_json = excluded.values_json,
            captured_at = excluded.captured_at
          """,
        arguments: [boardId, Int64(values.signature), values.firmware, values.valuesJson(), values.capturedAtMs]
      )
    }
  }

  /// Drop every stored signature for a Board. Called when link integrity goes `mismatched`.
  func clear(boardId: String) {
    guard !boardId.isEmpty, let writer = resolveWriter() else { return }
    try? writer.write { db in
      try db.execute(sql: "DELETE FROM motor_config_values WHERE board_id = ?", arguments: [boardId])
    }
  }
}
