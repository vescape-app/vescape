import Foundation
import GRDB

/// DB-backed cache of the last decoded Board Config Values, one row per Board and Refloat base
/// version — the same scoping Tune Compatibility uses (ADR 0022), because field offsets only mean
/// anything against the firmware they were read from.
///
/// A restored row comes back `provisional`: displayable, never a write base. The row is kept while
/// link integrity is `outdated` and deleted for the whole Board when it goes `mismatched`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getBoardConfigValues`
struct BoardConfigStore {
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = BoardConfigStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// Create the Board Config Values cache table. Called from the app-data `DatabaseMigrator` and
  /// reused by tests so the schema stays single-source. Mirrors Android `BoardConfigValuesEntity`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt
  static func createTables(_ db: Database) throws {
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS board_config_values (
        board_id TEXT NOT NULL,
        refloat_base_version TEXT NOT NULL,
        values_json TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        PRIMARY KEY (board_id, refloat_base_version)
      )
      """)
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_board_config_values_board_id ON board_config_values(board_id)")
  }

  /// The cached values for this Board + Refloat base version, as `provisional`. Nil when nothing is
  /// cached for that scope.
  func load(boardId: String, refloatBaseVersion: String) -> BoardConfigValues? {
    guard !boardId.isEmpty, !refloatBaseVersion.isEmpty, let writer = resolveWriter() else { return nil }
    let row = try? writer.read { db in
      try Row.fetchOne(
        db,
        sql: "SELECT values_json, captured_at FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?",
        arguments: [boardId, refloatBaseVersion]
      )
    }
    guard let row = row ?? nil else { return nil }
    return BoardConfigValues.provisional(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: row["captured_at"],
      valuesJson: row["values_json"]
    )
  }

  /// Cache the values just read from the board. Rows without a Board or Refloat base version are not
  /// cacheable — there is no scope to restore them into.
  func save(_ values: BoardConfigValues) {
    guard
      let boardId = values.boardId, !boardId.isEmpty,
      let refloatBaseVersion = values.refloatBaseVersion, !refloatBaseVersion.isEmpty,
      let writer = resolveWriter()
    else { return }
    try? writer.write { db in
      try db.execute(
        sql: """
          INSERT INTO board_config_values (board_id, refloat_base_version, values_json, captured_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(board_id, refloat_base_version) DO UPDATE SET
            values_json = excluded.values_json,
            captured_at = excluded.captured_at
          """,
        arguments: [boardId, refloatBaseVersion, values.valuesJson(), values.capturedAtMs]
      )
    }
  }

  /// Drop every cached scope for a Board. Called when link integrity goes `mismatched`: the firmware
  /// behind the link is not the one those offsets were decoded against.
  func clear(boardId: String) {
    guard !boardId.isEmpty, let writer = resolveWriter() else { return }
    try? writer.write { db in
      try db.execute(sql: "DELETE FROM board_config_values WHERE board_id = ?", arguments: [boardId])
    }
  }
}
