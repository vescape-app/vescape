import Foundation
import GRDB

/// Which Vescape Account this local database belongs to. One row, claimed by the first Account to
/// sign in and never rewritten in place: a different Account replaces the whole database, because
/// resetting the cursors over these rows would upload the previous Account's Boards, Ride History,
/// locations and settings to the new one.
///
/// Signing out does not clear the binding, so data recorded while signed out keeps its retention
/// protection for the same Account.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `SyncBindingEntity`
internal func createSyncBindingTable(_ db: Database) throws {
  try db.execute(
    sql: """
      CREATE TABLE IF NOT EXISTS sync_binding (
        id INTEGER PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        bound_at INTEGER NOT NULL
      )
      """
  )
}

/// The database went away underneath the uploader — a swap, or a pool that failed to open.
enum SyncStoreError: Error {
  case databaseUnavailable
}

/// How far a table has been accepted. A table with no committed cursor has delivered nothing.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `cursorOf`
internal func syncCursor(_ db: Database, _ name: String) throws -> Int64 {
  try Int64.fetchOne(
    db,
    sql: "SELECT last_value FROM sync_sequences WHERE name = ?",
    arguments: [name]
  ) ?? 0
}

/// Checkpoint how far a table has been accepted. Run after the response and never alongside the
/// rows: a cursor advanced past rows the server did not take is unrecoverable, whereas a cursor left
/// behind is a re-send the server upserts idempotently. Never moves backwards.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `commitSyncCursor`
internal func commitSyncCursor(_ db: Database, _ name: String, _ throughValue: Int64) throws {
  try db.execute(
    sql: """
      INSERT OR REPLACE INTO sync_sequences (name, last_value)
      VALUES (?, MAX(?, COALESCE((SELECT last_value FROM sync_sequences WHERE name = ?), 0)))
      """,
    arguments: [name, throughValue, name]
  )
}

/// The database side of the uploader: the forward scan, the cursor commit and the failure record.
///
/// Encoding happens here rather than in the engine, so the pure batch builder measures the exact
/// bytes that will be sent. Rows are read in `SyncTable` order and the scan stops once the row limit
/// is reached — a table further down waits for the next batch, which is what keeps parents ahead of
/// children.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncStore.kt `SyncStore`
final class SyncStore: SyncSource {
  private let generationProvider: () -> Int64
  private let onPermanentFailure: (SyncPauseReason, String) -> Void
  private let database: () -> (any DatabaseWriter)?

  init(
    generation: @escaping () -> Int64,
    onPermanentFailure: @escaping (SyncPauseReason, String) -> Void,
    // Injected so the scan and the cursor commit can be run against a real database in a test. The
    // default is the shared pool, which is what production always passes.
    // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncStore.kt `database`
    database: @escaping () -> (any DatabaseWriter)? = { TelemetryDatabase.pool }
  ) {
    self.generationProvider = generation
    self.onPermanentFailure = onPermanentFailure
    self.database = database
  }

  /// Resolved per call: an Account reset replaces the whole database under this object.
  private var pool: (any DatabaseWriter)? { database() }

  /// Rows that name no Board are not offered: the server keys these tables on the Board and has
  /// nowhere to put a row that belongs to none (ADR-0028). They are unowned local rows, not rows a
  /// Rider is waiting to see backed up.
  ///
  /// An Exclusion Range is filtered for the same reason a bucket is, and it is not optional: the
  /// sanitizers write `UNKNOWN_TELEMETRY_BOARD_ID` — the empty string — on a range recorded with no
  /// Board connected, and an unattributed range names no Board for the server to hang it off. Its
  /// composite foreign key refuses that row, which refuses the whole Sync Batch, and since the row is
  /// retained the same batch retries forever: backup wedges permanently on one unowned range.
  ///
  /// The consequence is deliberate: a later owned row carries the cursor past a skipped one, so
  /// cursor-gated retention prunes unowned telemetry on age alone, exactly as it did before the
  /// Account binding existed. Holding it forever would be the only alternative, because no future
  /// upload can ever accept it.
  private func scanPredicate(_ table: SyncTable) -> String {
    switch table {
    case .telemetryFrames: return " AND board_id IS NOT NULL"
    case .telemetryMinuteBuckets, .metricExclusionRanges: return " AND board_id != ''"
    default: return ""
    }
  }

  func pending(rowLimit: Int) throws -> [SyncPendingTable] {
    guard let pool else { return [] }
    var tables: [SyncPendingTable] = []
    var budget = rowLimit
    var encodeError: Error?

    try pool.read { db in
      for table in SyncTable.allCases {
        if budget <= 0 { break }
        let cursor = try syncCursor(db, table.cursorKey)
        let rows = try Row.fetchAll(
          db,
          sql: """
            SELECT * FROM \(table.table)
            WHERE \(table.cursorColumn) > ?\(scanPredicate(table))
            ORDER BY \(table.cursorColumn) ASC
            LIMIT ?
            """,
          arguments: [cursor, budget]
        )
        if rows.isEmpty { continue }
        do {
          let encoded = try rows.map { row in
            SyncPendingRow(
              cursor: row[table.cursorColumn] as Int64? ?? 0,
              json: try SyncWire.encode(table, row)
            )
          }
          tables.append(SyncPendingTable(table: table, rows: encoded))
          budget -= encoded.count
        } catch {
          encodeError = error
          return
        }
      }
    }

    if let encodeError { throw encodeError }
    return tables
  }

  func pendingCount() -> Int {
    guard let pool else { return 0 }
    return (try? pool.read { db in
      var total = 0
      for table in SyncTable.allCases {
        let cursor = try syncCursor(db, table.cursorKey)
        total += try Int.fetchOne(
          db,
          sql: """
            SELECT COUNT(*) FROM \(table.table)
            WHERE \(table.cursorColumn) > ?\(scanPredicate(table))
            """,
          arguments: [cursor]
        ) ?? 0
      }
      return total
    }) ?? 0
  }

  /// Cursors move only here, only after the server accepted. The accepted Sync Action cursor is also
  /// what prunes the log, so pruning can never outrun it.
  func commit(_ advances: [SyncTable: Int64]) throws {
    guard let pool else { throw SyncStoreError.databaseUnavailable }
    try pool.write { db in
      for (table, cursor) in advances {
        try commitSyncCursor(db, table.cursorKey, cursor)
      }
    }
    guard advances[.deleteActions] != nil else { return }
    // Pruning is a follow-up to the checkpoint, not part of it: a failure here leaves accepted
    // actions on disk, which re-send as no-ops, so it must not fail the commit itself.
    try? pool.write { db in
      try pruneUploadedSyncActions(db)
    }
  }

  func generation() -> Int64 { generationProvider() }

  func recordPermanentFailure(_ reason: SyncPauseReason, detail: String) {
    onPermanentFailure(reason, detail)
  }

  // Account binding.

  func boundAccountId() -> String? {
    guard let pool else { return nil }
    return try? pool.read { db in
      try String.fetchOne(db, sql: "SELECT account_id FROM sync_binding WHERE id = 0")
    }
  }

  /// Claim this database for `accountId`, or confirm it already belongs to it. False means it
  /// belongs to a different Account: the caller has to replace the database first.
  @discardableResult
  func bindAccount(_ accountId: String) -> Bool {
    guard let pool else { return false }
    return (try? pool.write { db -> Bool in
      if let bound = try String.fetchOne(db, sql: "SELECT account_id FROM sync_binding WHERE id = 0") {
        return bound == accountId
      }
      try db.execute(
        sql: "INSERT OR REPLACE INTO sync_binding (id, account_id, bound_at) VALUES (0, ?, ?)",
        arguments: [accountId, telemetryNowMs()]
      )
      return true
    }) ?? false
  }
}

/// Cursor-gated retention. A retention cutoff is only a candidate cutoff: cleanup must not remove a
/// row the uploader has not delivered. The sweep reads its table cursor and deletes in one
/// transaction, so racing an upload fails safe — before the cursor commit the rows are retained,
/// after it the server has accepted them. A missing cursor is 0, protecting every row.
///
/// Emits no Sync Actions: a retention sweep is maintenance, and `DeleteTarget` has no case that
/// could name a pruned table.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `deleteBeforeGated`
internal func deleteBeforeGated(_ db: Database, beforeMs: Int64) throws -> Int {
  let bound = try String.fetchOne(db, sql: "SELECT account_id FROM sync_binding WHERE id = 0")

  if bound == nil {
    // Never bound to an Account: the existing age-only cleanup, unchanged.
    try db.execute(sql: "DELETE FROM telemetry_frames WHERE captured_at_ms < ?", arguments: [beforeMs])
    let count = db.changesCount
    try db.execute(sql: "DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms < ?", arguments: [beforeMs])
    try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms < ?", arguments: [beforeMs])
    try db.execute(sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms < ?", arguments: [beforeMs])
    try db.execute(sql: "DELETE FROM diagnostic_events WHERE occurred_at_ms < ?", arguments: [beforeMs])
    return count
  }

  try db.execute(
    sql: "DELETE FROM telemetry_frames WHERE captured_at_ms < ? AND id <= ?",
    arguments: [beforeMs, try syncCursor(db, syncCursorFrames)]
  )
  let count = db.changesCount
  // A bucket is protected by `sync_seq`, not by a row id: one rewritten after an earlier version
  // uploaded gets a fresh position and has to survive until that one is accepted.
  try db.execute(
    sql: "DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms < ? AND sync_seq <= ?",
    arguments: [beforeMs, try syncCursor(db, syncCursorMinuteBuckets)]
  )
  try db.execute(
    sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms < ? AND id <= ?",
    arguments: [beforeMs, try syncCursor(db, syncCursorMarkers)]
  )
  try db.execute(
    sql: "DELETE FROM metric_exclusion_ranges WHERE end_ms < ? AND id <= ?",
    arguments: [beforeMs, try syncCursor(db, syncCursorExclusionRanges)]
  )
  try db.execute(
    sql: "DELETE FROM diagnostic_events WHERE occurred_at_ms < ? AND id <= ?",
    arguments: [beforeMs, try syncCursor(db, syncCursorDiagnosticEvents)]
  )
  return count
}
