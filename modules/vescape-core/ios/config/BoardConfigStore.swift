import Foundation
import GRDB

enum ConfigStorageError: Error { case databaseNotOpen, invalidCachedJSON }
private struct BoardConfigRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_config_values"
  let boardId: String; let refloatBaseVersion: String; let valuesJson: String; let capturedAt: Int64
  enum CodingKeys: String, CodingKey { case boardId = "board_id"; case refloatBaseVersion = "refloat_base_version"; case valuesJson = "values_json"; case capturedAt = "captured_at" }
}
struct ConfigNoticeRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_config_change_notices"
  let boardId: String; let detectedAt: Int64; let diffsJson: String
  enum CodingKeys: String, CodingKey { case boardId = "board_id"; case detectedAt = "detected_at"; case diffsJson = "diffs_json" }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt
struct BoardConfigChangeDiff: Codable {
  let fieldId: String; let label: String; let unit: String?
  let oldValue: ConfigNoticeValue?; let newValue: ConfigNoticeValue?
}
enum ConfigNoticeValue: Codable, Equatable {
  case number(Double), bool(Bool)
  init?(_ value: Any?) { if let v = value as? Bool { self = .bool(v) } else if let v = value as? Double { self = .number(v) } else { return nil } }
  func toBridge() -> Any { switch self { case .number(let v): v; case .bool(let v): v } }
}
struct BoardConfigChangeNotice {
  let boardId: String; let detectedAtMs: Int64; let diffs: [BoardConfigChangeDiff]
  func toMap() -> [String: Any] { ["boardId": boardId, "detectedAtMs": detectedAtMs, "diffs": diffs.map { ["fieldId": $0.fieldId, "label": $0.label, "unit": $0.unit, "oldValue": $0.oldValue?.toBridge(), "newValue": $0.newValue?.toBridge()] as [String: Any?] }] }
  func diffsJson() -> String { String(data: try! JSONEncoder().encode(diffs), encoding: .utf8)! }
  static func from(boardId: String, detectedAtMs: Int64, diffsJson: String) throws -> Self {
    guard let data = diffsJson.data(using: .utf8) else { throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Notice is not UTF-8")) }
    return .init(boardId: boardId, detectedAtMs: detectedAtMs, diffs: try JSONDecoder().decode([BoardConfigChangeDiff].self, from: data))
  }
  /// Relative tolerance for number fields. Two decodes of the same board bytes can differ by a few
  /// ULP once a value has been through the cache JSON or the `float32_auto` reconstruction, and a
  /// rider must never be told `0.026 -> 0.026`. Well below the smallest step any Refloat field
  /// exposes, so a real edit still diffs.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `NUMBER_TOLERANCE`
  static let numberTolerance = 1e-6

  static func changed(_ a: ConfigNoticeValue?, _ b: ConfigNoticeValue?) -> Bool {
    if case .number(let x) = a, case .number(let y) = b { return abs(x - y) > numberTolerance * max(1, max(abs(x), abs(y))) }
    return a != b
  }

  /// Fold new diffs into an undismissed notice rather than replacing it: a Refloat change and a motor
  /// config change found in the same session are one piece of news to the rider. A field that diffs
  /// twice keeps the newer comparison, in its original position.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `mergeDiffs`
  static func mergeDiffs(previous: [BoardConfigChangeDiff], incoming: [BoardConfigChangeDiff]) -> [BoardConfigChangeDiff] {
    var order: [String] = []
    var byId: [String: BoardConfigChangeDiff] = [:]
    for diff in previous + incoming {
      if byId[diff.fieldId] == nil { order.append(diff.fieldId) }
      byId[diff.fieldId] = diff
    }
    return order.compactMap { byId[$0] }
  }

  static func diff(old: [String: Any], new: [String: Any], schema: RefloatConfigSchema?) -> [BoardConfigChangeDiff] {
    let metadata = Dictionary(uniqueKeysWithValues: (schema?.fields ?? []).map { ($0.id, ($0.label, $0.unit)) })
    return Set(old.keys).union(new.keys).sorted().compactMap { id in let a = ConfigNoticeValue(old[id]), b = ConfigNoticeValue(new[id]); guard changed(a, b) else { return nil }; let meta = metadata[id]; return .init(fieldId: id, label: meta?.0 ?? id, unit: meta?.1, oldValue: a, newValue: b) }
  }
}

/// DB-backed Last Known Board Config Values, one row per Board and Refloat base
/// version — the same scoping Tune Compatibility uses (ADR 0022), because field offsets only mean
/// anything against the firmware they were read from.
///
/// A restored row comes back `lastKnown`: displayable, never a write base. The row is kept while
/// link integrity is `outdated` and deleted for the whole Board when it goes `mismatched`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getBoardConfigValues`
struct BoardConfigStore {
  static var onNoticeChanged: ((BoardConfigChangeNotice?) -> Void)?
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

  /// Create the Last Known Board Config Values table. Called from the app-data `DatabaseMigrator` and
  /// reused by tests so the schema stays single-source. Mirrors Android `BoardConfigValuesEntity`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createBoardConfig(db)
  }

  /// Last Known values for this Board + Refloat base version. Nil when none exist for that scope.
  func load(boardId: String, refloatBaseVersion: String) throws -> BoardConfigValues? {
    guard !boardId.isEmpty, !refloatBaseVersion.isEmpty else { return nil }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    guard let row = try writer.read({ db in try BoardConfigRecord.fetchOne(db, key: ["board_id": boardId, "refloat_base_version": refloatBaseVersion]) }) else { return nil }
    return try BoardConfigValues.lastKnown(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: row.capturedAt, valuesJson: row.valuesJson
    )
  }

  /// The most recently captured Last Known scope for a Board, whichever Refloat base version it was
  /// read against.
  ///
  /// For readers with no Board Session to tell them the base version — a screen opened while the
  /// Board is off. Displayable only, exactly like `load`: the newest row is the last thing Vescape
  /// saw on that Board, and picking a scope is meaningless without a connection to say which
  /// firmware is running now.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getLatestBoardConfigValues`
  func loadLatest(boardId: String) throws -> BoardConfigValues? {
    guard !boardId.isEmpty else { return nil }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    guard let row = try writer.read({ db in try BoardConfigRecord.filter(Column("board_id") == boardId).order(Column("captured_at").desc).fetchOne(db) }) else { return nil }
    return try BoardConfigValues.lastKnown(
      boardId: boardId,
      refloatBaseVersion: row.refloatBaseVersion, capturedAtMs: row.capturedAt, valuesJson: row.valuesJson
    )
  }

  /// Persist values just read from the board. Rows need both Board and Tune Compatibility scope.
  func save(_ values: BoardConfigValues) throws {
    guard
      let boardId = values.boardId, !boardId.isEmpty,
      let refloatBaseVersion = values.refloatBaseVersion, !refloatBaseVersion.isEmpty,
      let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    let json = try values.valuesJson()
    try writer.write { db in try BoardConfigRecord(boardId: boardId, refloatBaseVersion: refloatBaseVersion, valuesJson: json, capturedAt: values.capturedAtMs).save(db) }
  }

  /// Teach the config-change baseline about fields a runtime command changed on the board, merging
  /// into whatever the stored row holds now rather than replacing it with the caller's snapshot.
  ///
  /// `captured_at` is deliberately untouched: the row still describes the read it came from, it just
  /// accounts for a change Vescape itself made since.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `patchBoardConfigValues`
  func patch(boardId: String, refloatBaseVersion: String, values patch: [String: Any]) throws {
    guard !boardId.isEmpty, !refloatBaseVersion.isEmpty, !patch.isEmpty, let writer = resolveWriter()
    else { if resolveWriter() == nil { throw ConfigStorageError.databaseNotOpen }; return }
    try writer.write { db in
      guard let row = try BoardConfigRecord.fetchOne(db, key: ["board_id": boardId, "refloat_base_version": refloatBaseVersion]) else { return }
      let json = row.valuesJson
      let stored = try BoardConfigValues.lastKnown(
        boardId: boardId,
        refloatBaseVersion: refloatBaseVersion,
        capturedAtMs: 0,
        valuesJson: json
      )
      var merged = stored.values
      for (id, value) in patch { merged[id] = value }
      try db.execute(
        sql:
          "UPDATE board_config_values SET values_json = ? WHERE board_id = ? AND refloat_base_version = ?",
        arguments: [try stored.withValues(merged).valuesJson(), boardId, refloatBaseVersion]
      )
    }
  }

  /// Fresh trusted-session read: compare against Last Known, then replace notice + baseline in one
  /// transaction. No previous row means Board Probe/first-link baseline, never a notice.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `saveFreshBoardConfigValues`
  func saveFresh(_ values: BoardConfigValues) throws {
    guard let boardId = values.boardId, let base = values.refloatBaseVersion else { return }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    var notice: BoardConfigChangeNotice?
    var committed = false
    try writer.write { db in
      let oldRow = try Row.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?", arguments: [boardId, base])
      if let oldJson: String = oldRow?["values_json"] {
        let old = try BoardConfigValues.lastKnown(boardId: boardId, refloatBaseVersion: base, capturedAtMs: 0, valuesJson: oldJson)
        let diffs = BoardConfigChangeNotice.diff(old: old.values, new: values.values, schema: values.writeBase?.schema)
        if !diffs.isEmpty {
          let existing = try ConfigNoticeRecord.fetchOne(db, key: boardId)
          let previous = try existing.map {
            try BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: $0.detectedAt, diffsJson: $0.diffsJson).diffs
          } ?? []
          let merged = BoardConfigChangeNotice.mergeDiffs(previous: previous, incoming: diffs)
          notice = BoardConfigChangeNotice(boardId: boardId, detectedAtMs: values.capturedAtMs, diffs: merged)
          try ConfigNoticeRecord(boardId: boardId, detectedAt: values.capturedAtMs, diffsJson: notice!.diffsJson()).save(db)
        }
      }
      try BoardConfigRecord(boardId: boardId, refloatBaseVersion: base, valuesJson: try values.valuesJson(), capturedAt: values.capturedAtMs).save(db)
      committed = true
    }
    if committed, let notice { Self.onNoticeChanged?(notice) }
  }

  func loadNotice(boardId: String) throws -> BoardConfigChangeNotice? {
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    guard let row = try writer.read({ db in try ConfigNoticeRecord.fetchOne(db, key: boardId) }) else { return nil }
    return try BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: row.detectedAt, diffsJson: row.diffsJson)
  }

  func dismissNotice(boardId: String) throws {
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    _ = try writer.write { db in try ConfigNoticeRecord.deleteOne(db, key: boardId) }
    Self.onNoticeChanged?(nil)
  }

  /// Drop every Last Known scope for a Board. Called when link integrity goes `mismatched`: the firmware
  /// behind the link is not the one those offsets were decoded against.
  func clear(boardId: String) throws {
    guard !boardId.isEmpty else { return }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    try writer.write { db in
      try db.execute(sql: "DELETE FROM board_config_values WHERE board_id = ?", arguments: [boardId])
      try db.execute(sql: "DELETE FROM board_config_change_notices WHERE board_id = ?", arguments: [boardId])
    }
  }
}
