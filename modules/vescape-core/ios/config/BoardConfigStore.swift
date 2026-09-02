import Foundation
import GRDB

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
  static func from(boardId: String, detectedAtMs: Int64, diffsJson: String) -> Self? { guard let data = diffsJson.data(using: .utf8), let diffs = try? JSONDecoder().decode([BoardConfigChangeDiff].self, from: data) else { return nil }; return .init(boardId: boardId, detectedAtMs: detectedAtMs, diffs: diffs) }
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
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS board_config_values (
        board_id TEXT NOT NULL,
        refloat_base_version TEXT NOT NULL,
        values_json TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        PRIMARY KEY (board_id, refloat_base_version)
      )
      """)
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_board_config_values_board_id ON board_config_values(board_id)")
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS board_config_change_notices (
        board_id TEXT NOT NULL PRIMARY KEY,
        detected_at INTEGER NOT NULL,
        diffs_json TEXT NOT NULL
      )
      """)
  }

  /// Last Known values for this Board + Refloat base version. Nil when none exist for that scope.
  func load(boardId: String, refloatBaseVersion: String) -> BoardConfigValues? {
    guard !boardId.isEmpty, !refloatBaseVersion.isEmpty, let writer = resolveWriter() else { return nil }
    let row = try? writer.read { db in
      try Row.fetchOne(
        db,
        sql: "SELECT values_json, captured_at FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?",
        arguments: [boardId, refloatBaseVersion]
      )
    }
    guard let row = row ?? nil else { return nil }
    return BoardConfigValues.lastKnown(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: row["captured_at"],
      valuesJson: row["values_json"]
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
  func loadLatest(boardId: String) -> BoardConfigValues? {
    guard !boardId.isEmpty, let writer = resolveWriter() else { return nil }
    let row = try? writer.read { db in
      try Row.fetchOne(
        db,
        sql: """
          SELECT refloat_base_version, values_json, captured_at FROM board_config_values
          WHERE board_id = ? ORDER BY captured_at DESC LIMIT 1
          """,
        arguments: [boardId]
      )
    }
    guard let row = row ?? nil else { return nil }
    return BoardConfigValues.lastKnown(
      boardId: boardId,
      refloatBaseVersion: row["refloat_base_version"],
      capturedAtMs: row["captured_at"],
      valuesJson: row["values_json"]
    )
  }

  /// Persist values just read from the board. Rows need both Board and Tune Compatibility scope.
  func save(_ values: BoardConfigValues) {
    guard
      let boardId = values.boardId, !boardId.isEmpty,
      let refloatBaseVersion = values.refloatBaseVersion, !refloatBaseVersion.isEmpty,
      let writer = resolveWriter()
    else { return }
    try? writer.write { db in
      try db.execute(
        sql: """
          INSERT INTO board_config_values (board_id, refloat_base_version, values_json, captured_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(board_id, refloat_base_version) DO UPDATE SET
            values_json = excluded.values_json,
            captured_at = excluded.captured_at
          """,
        arguments: [boardId, refloatBaseVersion, values.valuesJson(), values.capturedAtMs]
      )
    }
  }

  /// Teach the config-change baseline about fields a runtime command changed on the board, merging
  /// into whatever the stored row holds now rather than replacing it with the caller's snapshot.
  ///
  /// `captured_at` is deliberately untouched: the row still describes the read it came from, it just
  /// accounts for a change Vescape itself made since.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `patchBoardConfigValues`
  func patch(boardId: String, refloatBaseVersion: String, values patch: [String: Any]) {
    guard !boardId.isEmpty, !refloatBaseVersion.isEmpty, !patch.isEmpty, let writer = resolveWriter()
    else { return }
    try? writer.write { db in
      let row = try Row.fetchOne(
        db,
        sql:
          "SELECT values_json FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?",
        arguments: [boardId, refloatBaseVersion]
      )
      guard let json: String = row?["values_json"] else { return }
      let stored = BoardConfigValues.lastKnown(
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
        arguments: [stored.withValues(merged).valuesJson(), boardId, refloatBaseVersion]
      )
    }
  }

  /// Fresh trusted-session read: compare against Last Known, then replace notice + baseline in one
  /// transaction. No previous row means Board Probe/first-link baseline, never a notice.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `saveFreshBoardConfigValues`
  func saveFresh(_ values: BoardConfigValues) {
    guard let boardId = values.boardId, let base = values.refloatBaseVersion, let writer = resolveWriter() else { return }
    var notice: BoardConfigChangeNotice?
    var committed = false
    try? writer.write { db in
      let oldRow = try Row.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?", arguments: [boardId, base])
      if let oldJson: String = oldRow?["values_json"] {
        let old = BoardConfigValues.lastKnown(boardId: boardId, refloatBaseVersion: base, capturedAtMs: 0, valuesJson: oldJson)
        let diffs = BoardConfigChangeNotice.diff(old: old.values, new: values.values, schema: values.writeBase?.schema)
        if !diffs.isEmpty {
          notice = BoardConfigChangeNotice(boardId: boardId, detectedAtMs: values.capturedAtMs, diffs: diffs)
          try db.execute(sql: "INSERT OR REPLACE INTO board_config_change_notices (board_id, detected_at, diffs_json) VALUES (?, ?, ?)", arguments: [boardId, values.capturedAtMs, notice!.diffsJson()])
        }
      }
      try db.execute(sql: "INSERT OR REPLACE INTO board_config_values (board_id, refloat_base_version, values_json, captured_at) VALUES (?, ?, ?, ?)", arguments: [boardId, base, values.valuesJson(), values.capturedAtMs])
      committed = true
    }
    if committed, let notice { Self.onNoticeChanged?(notice) }
  }

  func loadNotice(boardId: String) -> BoardConfigChangeNotice? {
    guard let writer = resolveWriter() else { return nil }
    let row = try? writer.read { db in try Row.fetchOne(db, sql: "SELECT detected_at, diffs_json FROM board_config_change_notices WHERE board_id = ?", arguments: [boardId]) }
    guard let row = row ?? nil else { return nil }
    return BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: row["detected_at"], diffsJson: row["diffs_json"])
  }

  func dismissNotice(boardId: String) {
    guard let writer = resolveWriter() else { return }
    try? writer.write { db in try db.execute(sql: "DELETE FROM board_config_change_notices WHERE board_id = ?", arguments: [boardId]) }
    Self.onNoticeChanged?(nil)
  }

  /// Drop every Last Known scope for a Board. Called when link integrity goes `mismatched`: the firmware
  /// behind the link is not the one those offsets were decoded against.
  func clear(boardId: String) {
    guard !boardId.isEmpty, let writer = resolveWriter() else { return }
    try? writer.write { db in
      try db.execute(sql: "DELETE FROM board_config_values WHERE board_id = ?", arguments: [boardId])
      try db.execute(sql: "DELETE FROM board_config_change_notices WHERE board_id = ?", arguments: [boardId])
    }
  }
}
