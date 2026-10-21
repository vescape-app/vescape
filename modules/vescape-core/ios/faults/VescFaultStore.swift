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
  private struct Record: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "vesc_fault_occurrences"
    let id: String
    let boardId: String
    let code: Int
    let occurredAt: Int64
    let lastObservedAt: Int64
    let clearedAt: Int64?
    let dismissed: Bool

    enum CodingKeys: String, CodingKey {
      case id, code, dismissed
      case boardId = "board_id"
      case occurredAt = "occurred_at"
      case lastObservedAt = "last_observed_at"
      case clearedAt = "cleared_at"
    }

    init(_ occurrence: VescFaultOccurrence) {
      id = occurrence.id; boardId = occurrence.boardId; code = occurrence.code
      occurredAt = occurrence.occurredAtMs; lastObservedAt = occurrence.lastObservedAtMs
      clearedAt = occurrence.clearedAtMs; dismissed = occurrence.dismissed
    }

    var occurrence: VescFaultOccurrence {
      .init(id: id, boardId: boardId, code: code, occurredAtMs: occurredAt,
            lastObservedAtMs: lastObservedAt, clearedAtMs: clearedAt, dismissed: dismissed)
    }
  }
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
    try PersistenceSchema.createVescFaults(db)
  }

  // MARK: - Reads

  func getForBoard(_ boardId: String) throws -> [VescFaultOccurrence] {
    try writer().read { db in
      try Record.filter(Column("board_id") == boardId)
        .order(Column("occurred_at").desc, Column.rowID.desc).fetchAll(db).map(\.occurrence)
    }
  }

  func getAll() throws -> [VescFaultOccurrence] {
    try writer().read { db in
      try Record.order(Column("board_id"), Column("occurred_at").desc, Column.rowID.desc)
        .fetchAll(db).map(\.occurrence)
    }
  }

  /// Unlike the list reads this one propagates failure: the coordinator must not treat an
  /// unreadable database as proof that no fault is open, or a restart would duplicate it.
  func openLive(_ boardId: String) throws -> VescFaultOccurrence? {
    try writer().read { db in
      try Record.filter(Column("board_id") == boardId && Column("cleared_at") == nil)
        .order(Column("occurred_at").desc, Column.rowID.desc).fetchOne(db)?.occurrence
    }
  }

  // MARK: - Writes

  @discardableResult func upsert(_ occurrence: VescFaultOccurrence) throws -> Bool {
    try writer().write { db in
      if try Record.fetchOne(db, key: occurrence.id) == nil {
        try Record(occurrence).insert(db)
      } else {
        try Record.filter(key: occurrence.id).updateAll(
          db,
          Column("last_observed_at").set(to: occurrence.lastObservedAtMs),
          Column("cleared_at").set(to: occurrence.clearedAtMs)
        )
      }
      return true
    }
  }

  @discardableResult
  func setDismissed(_ id: String, _ dismissed: Bool) throws -> Bool {
    try writer().write { db in
      try Record.filter(key: id).updateAll(db, Column("dismissed").set(to: dismissed)) > 0
    }
  }

  private func writer() throws -> DatabaseWriter {
    guard let writer = resolveWriter() else { throw VescFaultStoreError.unavailable }
    return writer
  }
}
