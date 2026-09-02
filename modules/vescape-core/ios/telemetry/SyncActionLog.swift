import Foundation
import GRDB

/// What a Sync Action can name — and, by omission, what it cannot.
///
/// Every case is configuration or current state a Rider edits directly. Ride History is absent on
/// purpose: Telemetry Samples, markers, minute buckets, exclusion ranges and diagnostic events are
/// pruned on a retention rule, and an action naming one of those would make the server delete
/// exactly the rides the backup exists to preserve. Leaving them unnameable makes that boundary
/// structural rather than a rule someone has to remember (server ADR-0004).
///
/// `table` is the local table the case removes from, so a test can assert no retained table is ever
/// given a case.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `DeleteTarget`
/// @parity /modules/vescape-core/src/index.ts `DeleteTarget`
enum DeleteTarget: String, CaseIterable {
  case appSetting
  case board
  case boardSetting
  case boardWarning
  case alert
  case tuneProfile
  case privacyZone
  case favorite

  var table: String {
    switch self {
    case .appSetting: return "app_settings"
    case .board: return "boards"
    case .boardSetting: return "board_settings"
    case .boardWarning: return "board_warnings"
    case .alert: return "alerts"
    case .tuneProfile: return "tune_profiles"
    case .privacyZone: return "privacy_zones"
    case .favorite: return "favorites"
    }
  }
}

/// The only Sync Action type today. Named rather than implied so a later intent needs no second log.
internal let syncActionTypeDelete = "delete"

/// `sync_sequences` key holding the highest action cursor the server has accepted.
internal let syncActionsUploadedCursor = "sync_actions_uploaded"

/// The Sync Action log: an append-only record that something was semantically removed. A deleted row
/// cannot carry a Change Timestamp saying it is gone, so this log is the only signal the server can
/// apply the same durable state transition from.
///
/// Its cursor is `id` — `AUTOINCREMENT`, which SQLite guarantees monotonic and never reused — so the
/// log needs no `sync_seq` of its own. Rows are transport state, not durable truth: they are pruned
/// once the server has accepted them.
///
/// Idempotent, and called both from the migration that introduced it and from the store-level
/// `createTables` seams tests build their schema from. No database trigger writes here — intent
/// cannot be inferred from SQL alone.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `SyncActionEntity`
internal func createSyncActionsTable(_ db: Database) throws {
  try db.execute(
    sql: """
      CREATE TABLE IF NOT EXISTS sync_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        type TEXT NOT NULL,
        target TEXT NOT NULL,
        board_id TEXT,
        key TEXT NOT NULL,
        deleted_at INTEGER NOT NULL
      )
      """
  )
  try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_sync_actions_target ON sync_actions(target)")
}

/// Record that [target] identified by `boardId`/`key` was semantically removed.
///
/// `rowStamp` is the removed row's own change timestamp, read before the delete: the action is
/// stamped `max(now, rowStamp)` so a rewound device clock cannot produce an action the server reads
/// as older than the row it names — that action would be dropped as a no-op, and the phone could not
/// self-heal by re-sending, because the row is gone.
///
/// A nil `rowStamp` means there was no row to remove, so no intent to record either.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `appendDeleteAction`
internal func appendDeleteAction(
  _ db: Database,
  target: DeleteTarget,
  boardId: String?,
  key: String,
  rowStamp: Int64?,
  now: Int64 = telemetryNowMs()
) throws {
  guard let rowStamp else { return }
  try db.execute(
    sql: """
      INSERT INTO sync_actions (type, target, board_id, key, deleted_at)
      VALUES (?, ?, ?, ?, ?)
      """,
    arguments: [syncActionTypeDelete, target.rawValue, boardId, key, max(now, rowStamp)]
  )
}

/// The one semantic-removal primitive: read the row's change timestamp, append its action, delete
/// the row — all inside the caller's transaction, so the action and the delete commit together or
/// not at all.
///
/// `stampColumn` is the row's own change clock: `updated_at` everywhere except Board Warnings, whose
/// `last_detected_at` is what their `updated_at` was written from.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `appendDeleteAction`
@discardableResult
internal func deleteForSync(
  _ db: Database,
  target: DeleteTarget,
  boardId: String?,
  key: String,
  whereClause: String,
  keys: StatementArguments,
  stampColumn: String = "updated_at",
  now: Int64 = telemetryNowMs()
) throws -> Bool {
  let stamp = try Int64.fetchOne(
    db,
    sql: "SELECT \(stampColumn) FROM \(target.table) WHERE \(whereClause)",
    arguments: keys
  )
  try appendDeleteAction(db, target: target, boardId: boardId, key: key, rowStamp: stamp, now: now)
  try db.execute(sql: "DELETE FROM \(target.table) WHERE \(whereClause)", arguments: keys)
  return db.changesCount > 0
}

/// One Sync Action as it leaves the phone. The uploader (#284) owns the batching; this is the read
/// shape it pages through.
struct SyncAction {
  let id: Int64
  let type: String
  let target: String
  let boardId: String?
  let key: String
  let deletedAt: Int64
}

/// The next page of actions to upload, in cursor order.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `getSyncActionsAfter`
internal func syncActionsAfter(_ db: Database, _ afterId: Int64, limit: Int) throws -> [SyncAction] {
  try Row.fetchAll(
    db,
    sql: "SELECT * FROM sync_actions WHERE id > ? ORDER BY id ASC LIMIT ?",
    arguments: [afterId, limit]
  ).map { row in
    SyncAction(
      id: row["id"],
      type: row["type"],
      target: row["target"],
      boardId: row["board_id"],
      key: row["key"],
      deletedAt: row["deleted_at"]
    )
  }
}

/// Checkpoint the highest action cursor the server has accepted, in its own transaction, committed
/// before `pruneUploadedSyncActions` runs: a crash between the two leaves rows that will be sent
/// again — harmless, since applying an action twice is a no-op — whereas pruning first would drop an
/// action nobody has accepted. Never moves backwards.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `commitSyncActionCursor`
internal func commitSyncActionCursor(_ db: Database, throughId: Int64) throws {
  try db.execute(
    sql: """
      INSERT OR REPLACE INTO sync_sequences (name, last_value)
      VALUES (?, MAX(?, COALESCE((SELECT last_value FROM sync_sequences WHERE name = ?), 0)))
      """,
    arguments: [syncActionsUploadedCursor, throughId, syncActionsUploadedCursor]
  )
}

/// Drop what the server has already accepted. Gated on the committed cursor rather than a caller's
/// number, so pruning structurally cannot outrun the checkpoint.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `pruneUploadedSyncActions`
@discardableResult
internal func pruneUploadedSyncActions(_ db: Database) throws -> Int {
  guard let accepted = try Int64.fetchOne(
    db,
    sql: "SELECT last_value FROM sync_sequences WHERE name = ?",
    arguments: [syncActionsUploadedCursor]
  ) else { return 0 }
  try db.execute(sql: "DELETE FROM sync_actions WHERE id <= ?", arguments: [accepted])
  return db.changesCount
}
