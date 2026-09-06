import Foundation
import GRDB

enum VescFaultStoreError: Error {
  /// The shared GRDB pool is not open, so the read could not be attempted at all.
  case unavailable
}

/// DB-backed storage for VESC Fault Occurrences. Unlike Board Warnings this **is** a time series —
/// the same code activating twice is two rows, keyed by a native-minted id, never by (board, code).
/// Lifecycle rules live on `VescFaultCoordinator`; this struct is pure CRUD.
///
/// Fault rows are deliberately absent from Board deletion: the evidence outlives the Board record.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct VescFaultStore: VescFaultStoring {
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = VescFaultStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  // MARK: - Schema

  /// Create the VESC Fault Occurrence table. Called from the app-data `DatabaseMigrator` and reused
  /// by tests so the schema stays single-source.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `VescFaultOccurrenceEntity`
  static func createTables(_ db: Database) throws {
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS vesc_fault_occurrences (
        id TEXT NOT NULL PRIMARY KEY,
        board_id TEXT NOT NULL,
        code INTEGER NOT NULL,
        occurred_at INTEGER NOT NULL,
        last_observed_at INTEGER NOT NULL,
        cleared_at INTEGER,
        dismissed INTEGER NOT NULL
      )
      """)
    try db.execute(sql: """
      CREATE INDEX IF NOT EXISTS index_vesc_fault_occurrences_board_id_occurred_at
      ON vesc_fault_occurrences(board_id, occurred_at)
      """)
  }

  // MARK: - Reads

  func getForBoard(_ boardId: String) -> [VescFaultOccurrence] {
    read("store_get_for_board") { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM vesc_fault_occurrences WHERE board_id = ? ORDER BY occurred_at DESC, rowid DESC",
        arguments: [boardId]
      ).map(Self.occurrence)
    } ?? []
  }

  func getAll() -> [VescFaultOccurrence] {
    read("store_get_all") { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM vesc_fault_occurrences ORDER BY board_id ASC, occurred_at DESC, rowid DESC"
      ).map(Self.occurrence)
    } ?? []
  }

  /// Unlike the list reads this one propagates failure: the coordinator must not treat an
  /// unreadable database as proof that no fault is open, or a restart would duplicate it.
  func openLive(_ boardId: String) throws -> VescFaultOccurrence? {
    guard let writer = resolveWriter() else { throw VescFaultStoreError.unavailable }
    return try writer.read { db in
      try Row.fetchOne(
        db,
        sql: """
          SELECT * FROM vesc_fault_occurrences
          WHERE board_id = ? AND cleared_at IS NULL
          ORDER BY occurred_at DESC, rowid DESC LIMIT 1
          """,
        arguments: [boardId]
      ).map(Self.occurrence)
    }
  }

  // MARK: - Writes

  @discardableResult
  func upsert(_ occurrence: VescFaultOccurrence) -> Bool {
    guard let writer = resolveWriter() else { return false }
    do {
      try writer.write { db in
      try db.execute(
        sql: """
          INSERT INTO vesc_fault_occurrences
            (id, board_id, code, occurred_at, last_observed_at, cleared_at, dismissed)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          -- Lifecycle writes deliberately leave `dismissed` alone: a heartbeat carrying a stale
          -- in-memory snapshot must never un-dismiss what the rider just acknowledged. Dismissal
          -- has its own statement.
          ON CONFLICT(id) DO UPDATE SET
            last_observed_at = excluded.last_observed_at,
            cleared_at = excluded.cleared_at
          """,
        arguments: [
          occurrence.id, occurrence.boardId, occurrence.code, occurrence.occurredAtMs,
          occurrence.lastObservedAtMs, occurrence.clearedAtMs, occurrence.dismissed,
        ]
      )
      }
      return true
    } catch {
      return false
    }
  }

  @discardableResult
  func setDismissed(_ id: String, _ dismissed: Bool) -> Bool {
    guard let writer = resolveWriter() else { return false }
    return (try? writer.write { db -> Bool in
      try db.execute(
        sql: "UPDATE vesc_fault_occurrences SET dismissed = ? WHERE id = ?",
        arguments: [dismissed, id]
      )
      return db.changesCount > 0
    }) ?? false
  }

  private func read<T>(_ site: String, _ body: @escaping (Database) throws -> T) -> T? {
    guard let writer = resolveWriter() else { return nil }
    return try? writer.read(body)
  }

  private static func occurrence(_ row: Row) -> VescFaultOccurrence {
    VescFaultOccurrence(
      id: row["id"] as String,
      boardId: row["board_id"] as String,
      code: row["code"] as Int,
      occurredAtMs: row["occurred_at"] as Int64,
      lastObservedAtMs: row["last_observed_at"] as Int64,
      clearedAtMs: row["cleared_at"] as Int64?,
      dismissed: row["dismissed"] as Bool
    )
  }
}
