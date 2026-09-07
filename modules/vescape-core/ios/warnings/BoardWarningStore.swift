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
  private struct InvalidSeverity: Error {}
  private struct WriterUnavailable: Error {}
  private let resolveWriter: () -> DatabaseWriter?
  static let shared = BoardWarningStore { TelemetryDatabase.pool }
  init(_ resolveWriter: @escaping () -> DatabaseWriter?) { self.resolveWriter = resolveWriter }
  init(dbWriter: DatabaseWriter) { self.resolveWriter = { dbWriter } }

  private struct Record: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "board_warnings"
    let boardId: String; let kind: String; let severity: String
    let firstDetectedAt: Int64; let lastDetectedAt: Int64; let payloadJson: String
    enum CodingKeys: String, CodingKey {
      case boardId = "board_id", kind, severity
      case firstDetectedAt = "first_detected_at", lastDetectedAt = "last_detected_at", payloadJson = "payload_json"
    }
    func warning() throws -> BoardWarning {
      guard severity == "warn" || severity == "critical" else { throw InvalidSeverity() }
      return .init(boardId: boardId, kind: kind, severity: severity, firstDetectedAtMs: firstDetectedAt, lastDetectedAtMs: lastDetectedAt, payloadJson: payloadJson)
    }
  }

  static func createTables(_ db: Database) throws { try PersistenceSchema.createBoardWarnings(db) }
  private func writer() throws -> DatabaseWriter {
    guard let writer = resolveWriter() else { throw WriterUnavailable() }
    return writer
  }
  func get(_ boardId: String, _ kind: String) throws -> BoardWarning? {
    try writer().read { db in try Record.fetchOne(db, key: ["board_id": boardId, "kind": kind]).map { try $0.warning() } }
  }
  func getForBoard(_ boardId: String) throws -> [BoardWarning] {
    try writer().read { db in try Record.filter(Column("board_id") == boardId).order(Column("first_detected_at")).fetchAll(db).map { try $0.warning() } }
  }
  func getAll() throws -> [BoardWarning] {
    try writer().read { db in try Record.order(Column("board_id"), Column("first_detected_at")).fetchAll(db).map { try $0.warning() } }
  }
  func upsert(_ warning: BoardWarning) throws {
    try writer().write { db in try Record(boardId: warning.boardId, kind: warning.kind, severity: warning.severity, firstDetectedAt: warning.firstDetectedAtMs, lastDetectedAt: warning.lastDetectedAtMs, payloadJson: warning.payloadJson).save(db) }
  }
  @discardableResult func delete(_ boardId: String, _ kind: String) throws -> Bool {
    try writer().write { db in try Record.deleteOne(db, key: ["board_id": boardId, "kind": kind]) }
  }
  @discardableResult func deleteForBoard(_ boardId: String) throws -> Bool {
    try writer().write { db in try Record.filter(Column("board_id") == boardId).deleteAll(db) > 0 }
  }
}
