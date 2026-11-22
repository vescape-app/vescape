import Foundation
import GRDB

enum VescFaultStoreError: Error {
  case unavailable
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
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
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = VescFaultStore { VescapeDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `VescFaultOccurrenceEntity`
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createVescFaults(db)
  }

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

  func openLive(_ boardId: String) throws -> VescFaultOccurrence? {
    try writer().read { db in
      try Record.filter(Column("board_id") == boardId && Column("cleared_at") == nil)
        .order(Column("occurred_at").desc, Column.rowID.desc).fetchOne(db)?.occurrence
    }
  }

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
