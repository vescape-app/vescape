import GRDB

struct PersistedDiagnosticEvent: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "diagnostic_events"
  var id: Int64?
  let occurredAtMs: Int64
  let elapsedRealtimeMs: Int64
  let eventName: String
  let operation: String?
  let phase: String?
  let boardId: String?
  let message: String?
  let propertiesJson: String

  enum CodingKeys: String, CodingKey {
    case id, operation, phase, message
    case occurredAtMs = "occurred_at_ms"
    case elapsedRealtimeMs = "elapsed_realtime_ms"
    case eventName = "event_name"
    case boardId = "board_id"
    case propertiesJson = "properties_json"
  }
}

/// Local Diagnostic Event SQL. Its failure reporter must never call this store recursively.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `insertDiagnosticEvent`
struct DiagnosticEventPersistence {
  let writer: any DatabaseWriter

  func insert(_ event: PersistedDiagnosticEvent) throws {
    try writer.write { db in try event.insert(db) }
  }

  func events(fromMs: Int64, toMs: Int64, boardId: String?, limit: Int) throws -> [PersistedDiagnosticEvent] {
    try writer.read { db in
      var request = PersistedDiagnosticEvent
        .filter(Column("occurred_at_ms") >= fromMs && Column("occurred_at_ms") <= toMs)
        .order(Column("occurred_at_ms").desc)
        .limit(limit)
      if let boardId { request = request.filter(Column("board_id") == boardId) }
      return try request.fetchAll(db)
    }
  }

  func clear() throws {
    _ = try writer.write { db in try PersistedDiagnosticEvent.deleteAll(db) }
  }

  func delete(beforeMs: Int64) throws {
    _ = try writer.write { db in
      try PersistedDiagnosticEvent.filter(Column("occurred_at_ms") < beforeMs).deleteAll(db)
    }
  }
}
