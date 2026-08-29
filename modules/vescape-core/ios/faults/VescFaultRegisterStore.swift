import Foundation
import GRDB

/// Narrow durable persistence for retained controller register reads.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegisterCoordinator.kt `VescFaultRegisterSnapshotStore`
protocol VescFaultRegisterStoring {
  @discardableResult func insert(_ snapshot: VescFaultRegisterSnapshot) -> Bool
  func getForBoard(_ boardId: String, limit: Int) -> [VescFaultRegisterSnapshot]
  func get(_ id: String) -> VescFaultRegisterSnapshot?
  /// Newest snapshot that finished cleanly — the comparison point for "what is new".
  func latestComplete(_ boardId: String) -> VescFaultRegisterSnapshot?
  /// True once this Board has a link baseline, so later reads are discoveries and not baselines.
  func hasBaseline(_ boardId: String) -> Bool
}

/// DB-backed storage for retained controller fault-register reads.
///
/// `raw` is stored as a BLOB and is the authority: `text` and `entries_json` are projections, and a
/// parser change must be able to re-read the original bytes. Like occurrences, snapshots are
/// deliberately absent from Board deletion — the evidence outlives the Board record.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct VescFaultRegisterStore: VescFaultRegisterStoring {
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = VescFaultRegisterStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  // MARK: - Schema

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `VescFaultRegisterSnapshotEntity`
  static func createTables(_ db: Database) throws {
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS vesc_fault_register_snapshots (
        id TEXT NOT NULL PRIMARY KEY,
        board_id TEXT NOT NULL,
        read_at INTEGER NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        raw BLOB NOT NULL,
        text TEXT NOT NULL,
        entries_json TEXT
      )
      """)
    try db.execute(sql: """
      CREATE INDEX IF NOT EXISTS index_vesc_fault_register_snapshots_board_id_read_at
      ON vesc_fault_register_snapshots(board_id, read_at)
      """)
  }

  // MARK: - Reads

  func getForBoard(_ boardId: String, limit: Int) -> [VescFaultRegisterSnapshot] {
    read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM vesc_fault_register_snapshots WHERE board_id = ?
          ORDER BY read_at DESC, rowid DESC LIMIT ?
          """,
        arguments: [boardId, limit]
      ).map(Self.snapshot)
    } ?? []
  }

  func get(_ id: String) -> VescFaultRegisterSnapshot? {
    read { db in
      try Row.fetchOne(
        db, sql: "SELECT * FROM vesc_fault_register_snapshots WHERE id = ? LIMIT 1", arguments: [id]
      ).map(Self.snapshot)
    } ?? nil
  }

  func latestComplete(_ boardId: String) -> VescFaultRegisterSnapshot? {
    read { db in
      try Row.fetchOne(
        db,
        sql: """
          SELECT * FROM vesc_fault_register_snapshots
          WHERE board_id = ? AND status = 'complete'
          ORDER BY read_at DESC, rowid DESC LIMIT 1
          """,
        arguments: [boardId]
      ).map(Self.snapshot)
    } ?? nil
  }

  func hasBaseline(_ boardId: String) -> Bool {
    (read { db in
      try Int.fetchOne(
        db,
        sql: "SELECT COUNT(*) FROM vesc_fault_register_snapshots WHERE board_id = ? AND reason = 'baseline'",
        arguments: [boardId]
      ) ?? 0
    } ?? 0) > 0
  }

  // MARK: - Writes

  @discardableResult
  func insert(_ snapshot: VescFaultRegisterSnapshot) -> Bool {
    guard let writer = resolveWriter() else { return false }
    do {
      try writer.write { db in
        try db.execute(
          sql: """
            INSERT OR IGNORE INTO vesc_fault_register_snapshots
              (id, board_id, read_at, reason, status, raw, text, entries_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
          arguments: [
            snapshot.id, snapshot.boardId, snapshot.readAtMs, snapshot.reason.rawValue,
            snapshot.status.rawValue, snapshot.raw, snapshot.text,
            encodeRegisterEntries(snapshot.entries),
          ]
        )
      }
      return true
    } catch {
      return false
    }
  }

  private func read<T>(_ body: @escaping (Database) throws -> T) -> T? {
    guard let writer = resolveWriter() else { return nil }
    return try? writer.read(body)
  }

  private static func snapshot(_ row: Row) -> VescFaultRegisterSnapshot {
    VescFaultRegisterSnapshot(
      id: row["id"] as String,
      boardId: row["board_id"] as String,
      readAtMs: row["read_at"] as Int64,
      reason: VescFaultRegisterReason(rawValue: row["reason"] as String) ?? .idle,
      status: VescFaultRegisterStatus(rawValue: row["status"] as String) ?? .incomplete,
      raw: row["raw"] as Data,
      text: row["text"] as String,
      entries: decodeRegisterEntries(row["entries_json"] as String?)
    )
  }
}
