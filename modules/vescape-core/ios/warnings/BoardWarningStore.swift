import Foundation
import GRDB

/// One current Board Warning, as it crosses the bridge and lives in the durable store. Mirrors the
/// Android `BoardWarning` model + `board_warnings` Room table.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt `BoardWarning`
/// @parity /modules/vescape-core/src/index.ts `BoardWarning`
struct BoardWarning {
  let boardId: String
  let kind: String
  /// Two-level severity, fixed at detection time: `warn` or `critical`.
  let severity: String
  let firstDetectedAtMs: Int64
  let lastDetectedAtMs: Int64
  let payloadJson: String

  func toMap() -> [String: Any?] {
    [
      "boardId": boardId,
      "kind": kind,
      "severity": severity,
      "firstDetectedAtMs": firstDetectedAtMs,
      "lastDetectedAtMs": lastDetectedAtMs,
      "payloadJson": payloadJson,
    ]
  }
}

/// DB-backed storage for Board Warnings, upsert-keyed by (board_id, kind). Not a time series — one
/// row per active warning per Board. Lifecycle rules live on `BoardWarningRegistry`; this struct is
/// pure CRUD. Mirrors the Android Room DAO methods behind `BoardWarningStore`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct BoardWarningStore {
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  /// Bound to the single app-data database. Mirrors Android routing warning ops through the
  /// singleton Room DAO.
  static let shared = BoardWarningStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  // MARK: - Schema

  /// Create the Board Warnings table. Called from the app-data `DatabaseMigrator` and reused by
  /// tests so the schema stays single-source. Mirrors Android `BoardWarningEntity`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt
  static func createTables(_ db: Database) throws {
    try db.execute(sql: """
      CREATE TABLE board_warnings (
        board_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        first_detected_at INTEGER NOT NULL,
        last_detected_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        sync_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (board_id, kind)
      )
      """)
    try db.execute(sql: "CREATE INDEX index_board_warnings_board_id ON board_warnings(board_id)")
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_board_warnings_sync_seq ON board_warnings(sync_seq)")
    try createSyncSequencesTable(db)
    try createSyncActionsTable(db)
  }

  /// The shared pool failed to open — findings are dropped / reads come back empty, so leave the
  /// same `board_warning_failure` breadcrumb a throwing GRDB call would.
  private struct WriterUnavailableError: Error, LocalizedError {
    var errorDescription: String? { "database writer unavailable" }
  }

  private func reportWriterUnavailable(_ site: String) {
    BoardWarningFailureReporter.shared.report(site: site, error: WriterUnavailableError())
  }

  // MARK: - Reads

  func get(_ boardId: String, _ kind: String) -> BoardWarning? {
    guard let writer = resolveWriter() else {
      reportWriterUnavailable("store_get")
      return nil
    }
    do {
      return try writer.read { db in
        try Row.fetchOne(
          db,
          sql: "SELECT * FROM board_warnings WHERE board_id = ? AND kind = ? LIMIT 1",
          arguments: [boardId, kind]
        ).map { Self.warning($0) }
      }
    } catch {
      BoardWarningFailureReporter.shared.report(site: "store_get", error: error)
      return nil
    }
  }

  func getForBoard(_ boardId: String) -> [BoardWarning] {
    guard let writer = resolveWriter() else {
      reportWriterUnavailable("store_get_for_board")
      return []
    }
    do {
      return try writer.read { db in
        try Row.fetchAll(
          db,
          sql: "SELECT * FROM board_warnings WHERE board_id = ? ORDER BY first_detected_at ASC",
          arguments: [boardId]
        ).map { Self.warning($0) }
      }
    } catch {
      BoardWarningFailureReporter.shared.report(site: "store_get_for_board", error: error)
      return []
    }
  }

  func getAll() -> [BoardWarning] {
    guard let writer = resolveWriter() else {
      reportWriterUnavailable("store_get_all")
      return []
    }
    do {
      return try writer.read { db in
        try Row.fetchAll(
          db,
          sql: "SELECT * FROM board_warnings ORDER BY board_id ASC, first_detected_at ASC"
        ).map { Self.warning($0) }
      }
    } catch {
      BoardWarningFailureReporter.shared.report(site: "store_get_all", error: error)
      return []
    }
  }

  // MARK: - Writes

  func upsert(_ warning: BoardWarning) {
    guard let writer = resolveWriter() else {
      reportWriterUnavailable("store_upsert")
      return
    }
    do {
      try writer.write { db in
        try db.execute(
          sql: """
            INSERT INTO board_warnings
              (board_id, kind, severity, first_detected_at, last_detected_at, payload_json,
               updated_at, sync_seq)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(board_id, kind) DO UPDATE SET
              severity = excluded.severity,
              last_detected_at = excluded.last_detected_at,
              payload_json = excluded.payload_json,
              updated_at = MAX(board_warnings.updated_at + 1, excluded.updated_at),
              sync_seq = excluded.sync_seq
            """,
          arguments: [
            warning.boardId, warning.kind, warning.severity,
            warning.firstDetectedAtMs, warning.lastDetectedAtMs, warning.payloadJson,
            warning.lastDetectedAtMs, try nextSyncSeq(db, syncSeqBoardWarnings),
          ]
        )
      }
    } catch {
      BoardWarningFailureReporter.shared.report(site: "store_upsert", error: error)
    }
  }

  /// Semantic removal, whether the Rider cleared the warning or a detector evaluated the kind with
  /// real data and found the condition gone — an automatic clear is still a durable state transition
  /// the server has to make (#282).
  ///
  /// Stamped from `last_detected_at` rather than `updated_at`: it is the warning's own change clock,
  /// and it is what the row's `updated_at` was written from.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `deleteBoardWarning`
  @discardableResult
  func delete(_ boardId: String, _ kind: String) -> Bool {
    guard let writer = resolveWriter() else {
      reportWriterUnavailable("store_delete")
      return false
    }
    do {
      return try writer.write { db in
        try deleteForSync(
          db,
          target: .boardWarning,
          boardId: boardId,
          key: kind,
          whereClause: "board_id = ? AND kind = ?",
          keys: [boardId, kind],
          stampColumn: "last_detected_at"
        )
      }
    } catch {
      BoardWarningFailureReporter.shared.report(site: "store_delete", error: error)
      return false
    }
  }

  /// The Rider cleared every warning on one Board: one action per removed row, because each row is
  /// a separate piece of current state. Distinct from the Board delete's cascade, which is raw and
  /// covered by the Board's own action.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `deleteBoardWarnings`
  @discardableResult
  func deleteForBoard(_ boardId: String) -> Bool {
    guard let writer = resolveWriter() else {
      reportWriterUnavailable("store_delete_for_board")
      return false
    }
    do {
      return try writer.write { db in
        let kinds = try String.fetchAll(
          db,
          sql: "SELECT kind FROM board_warnings WHERE board_id = ?",
          arguments: [boardId]
        )
        var removed = false
        for kind in kinds {
          removed = try deleteForSync(
            db,
            target: .boardWarning,
            boardId: boardId,
            key: kind,
            whereClause: "board_id = ? AND kind = ?",
            keys: [boardId, kind],
            stampColumn: "last_detected_at"
          ) || removed
        }
        return removed
      }
    } catch {
      BoardWarningFailureReporter.shared.report(site: "store_delete_for_board", error: error)
      return false
    }
  }

  private static func warning(_ row: Row) -> BoardWarning {
    BoardWarning(
      boardId: row["board_id"] as String,
      kind: row["kind"] as String,
      severity: row["severity"] as String,
      firstDetectedAtMs: row["first_detected_at"] as Int64,
      lastDetectedAtMs: row["last_detected_at"] as Int64,
      payloadJson: row["payload_json"] as String
    )
  }
}

/// Reports Board Warning DB failures to diagnostics, throttled to once per (site, session). Board
/// Warnings are a secondary feature: a failed GRDB read/write must stay non-fatal (never crash the
/// app), but unlike the previous blanket `try?` it now leaves a breadcrumb so a broken pool is
/// visible in the field. `beginSession` clears the throttle so every Board Session gets one report
/// per failing site without per-frame spam. Mirrors the Android controller's `warningFailuresReported`
/// throttle + `board_warning_failure` capture.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `reportWarningFailure`
final class BoardWarningFailureReporter {
  static let shared = BoardWarningFailureReporter()

  private let record: (String, [String: Any?]) -> Void
  private let lock = NSLock()
  private var reportedSites = Set<String>()

  init(
    record: @escaping (String, [String: Any?]) -> Void = { name, props in
      DiagnosticsRecorder.shared.record(eventName: name, properties: props)
    }
  ) {
    self.record = record
  }

  /// Reset the per-session throttle when a new Board Session starts (mirrors Android clearing the
  /// throttle set in `beginSession`).
  func beginSession() {
    lock.lock()
    reportedSites.removeAll(keepingCapacity: true)
    lock.unlock()
  }

  func report(site: String, error: Error) {
    lock.lock()
    let isFirst = reportedSites.insert(site).inserted
    lock.unlock()
    guard isFirst else { return }
    record(
      "board_warning_failure",
      [
        "site": site,
        "message": error.localizedDescription,
        "error_type": String(describing: type(of: error)),
      ]
    )
  }
}
