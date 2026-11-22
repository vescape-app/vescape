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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `BoardConfigChangeDiff`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigChangeDiff`
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
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `IGNORED_FIELDS_SETTING_KEY`
  static let ignoredFieldsSettingKey = "ignoredConfigChangeFields"

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `VOLATILE_MOTOR_FIELDS`
  static let volatileMotorFields: Set<String> = [
    "foc_offsets_current[0]",
    "foc_offsets_current[1]",
    "foc_offsets_current[2]",
    "foc_offsets_voltage[0]",
    "foc_offsets_voltage[1]",
    "foc_offsets_voltage[2]",
    "foc_offsets_voltage_undriven[0]",
    "foc_offsets_voltage_undriven[1]",
    "foc_offsets_voltage_undriven[2]",
  ]

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `NUMBER_TOLERANCE`
  static let numberTolerance = 1e-6

  static func changed(_ a: ConfigNoticeValue?, _ b: ConfigNoticeValue?) -> Bool {
    if case .number(let x) = a, case .number(let y) = b { return abs(x - y) > numberTolerance * max(1, max(abs(x), abs(y))) }
    return a != b
  }

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

  static func diff(old: [String: Any], new: [String: Any], schema: RefloatConfigSchema?, ignoredFields: Set<String> = []) -> [BoardConfigChangeDiff] {
    let metadata = Dictionary(uniqueKeysWithValues: (schema?.fields ?? []).map { ($0.id, ($0.label, $0.unit)) })
    return Set(old.keys).union(new.keys).sorted().compactMap { id in
      guard !ignoredFields.contains(id) else { return nil }
      let a = ConfigNoticeValue(old[id]), b = ConfigNoticeValue(new[id])
      guard changed(a, b) else { return nil }
      let meta = metadata[id]
      return .init(fieldId: id, label: meta?.0 ?? id, unit: meta?.1, oldValue: a, newValue: b)
    }
  }

  static func loadIgnoredFields(_ db: Database, boardId: String) throws -> Set<String> {
    guard
      let json = try String.fetchOne(
        db,
        sql: "SELECT value_json FROM board_settings WHERE board_id = ? AND key = ?",
        arguments: [boardId, ignoredFieldsSettingKey]
      ),
      let data = json.data(using: .utf8)
    else { return [] }
    guard let raw = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [Any] else { return [] }
    return Set(raw.compactMap { $0 as? String }.filter { !$0.isEmpty })
  }

  static func pruneNotice(_ db: Database, boardId: String, ignoredFields: Set<String>) throws -> (changed: Bool, notice: BoardConfigChangeNotice?) {
    guard !ignoredFields.isEmpty, let row = try ConfigNoticeRecord.fetchOne(db, key: boardId) else { return (false, nil) }
    let current = try BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: row.detectedAt, diffsJson: row.diffsJson)
    let remaining = current.diffs.filter { !ignoredFields.contains($0.fieldId) }
    guard remaining.count != current.diffs.count else { return (false, current) }
    if remaining.isEmpty {
      _ = try ConfigNoticeRecord.deleteOne(db, key: boardId)
      return (true, nil)
    }
    let updated = BoardConfigChangeNotice(boardId: boardId, detectedAtMs: current.detectedAtMs, diffs: remaining)
    try ConfigNoticeRecord(boardId: boardId, detectedAt: updated.detectedAtMs, diffsJson: updated.diffsJson()).save(db)
    return (true, updated)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getBoardConfigValues`
struct BoardConfigStore {
  static var onNoticeChanged: ((BoardConfigChangeNotice?) -> Void)?
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = BoardConfigStore { VescapeDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createBoardConfig(db)
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getLatestBoardConfigValues`
  func loadLatest(boardId: String) throws -> BoardConfigValues? {
    guard !boardId.isEmpty else { return nil }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    guard let row = try writer.read({ db in try BoardConfigRecord.filter(Column("board_id") == boardId).order(Column("captured_at").desc).fetchOne(db) }) else { return nil }
    return try BoardConfigValues.lastKnown(
      boardId: boardId,
      refloatBaseVersion: row.refloatBaseVersion, capturedAtMs: row.capturedAt, valuesJson: row.valuesJson
    )
  }

  func save(_ values: BoardConfigValues) throws {
    guard
      let boardId = values.boardId, !boardId.isEmpty,
      let refloatBaseVersion = values.refloatBaseVersion, !refloatBaseVersion.isEmpty,
      let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    let json = try values.valuesJson()
    try writer.write { db in try BoardConfigRecord(boardId: boardId, refloatBaseVersion: refloatBaseVersion, valuesJson: json, capturedAt: values.capturedAtMs).save(db) }
  }

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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `saveFreshBoardConfigValues`
  func saveFresh(_ values: BoardConfigValues) throws {
    guard let boardId = values.boardId, let base = values.refloatBaseVersion else { return }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    var notice: BoardConfigChangeNotice?
    var committed = false
    try writer.write { db in
      let oldRow = try Row.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?", arguments: [boardId, base])
      if let oldJson: String = oldRow?["values_json"] {
        let old = try BoardConfigValues.lastKnown(boardId: boardId, refloatBaseVersion: base, capturedAtMs: 0, valuesJson: oldJson)
        let ignored = try BoardConfigChangeNotice.loadIgnoredFields(db, boardId: boardId)
        let diffs = BoardConfigChangeNotice.diff(old: old.values, new: values.values, schema: values.writeBase?.schema, ignoredFields: ignored)
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

  func clear(boardId: String) throws {
    guard !boardId.isEmpty else { return }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    try writer.write { db in
      try db.execute(sql: "DELETE FROM board_config_values WHERE board_id = ?", arguments: [boardId])
      try db.execute(sql: "DELETE FROM board_config_change_notices WHERE board_id = ?", arguments: [boardId])
    }
  }
}
