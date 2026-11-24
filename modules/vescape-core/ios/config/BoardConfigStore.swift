import Foundation
import GRDB

enum ConfigStorageError: Error { case databaseNotOpen, invalidCachedJSON }
private struct BoardConfigRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_config_values"
  let boardId: String; let refloatBaseVersion: String; let valuesJson: String; let capturedAt: Int64; let schemaHash: String?
  enum CodingKeys: String, CodingKey {
    case boardId = "board_id"
    case refloatBaseVersion = "refloat_base_version"
    case valuesJson = "values_json"
    case capturedAt = "captured_at"
    case schemaHash = "schema_hash"
  }
}
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `BoardConfigSchemaEntity`
struct BoardConfigSchemaRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_config_schemas"
  let schemaHash: String; let rawXml: String; let createdAt: Int64
  enum CodingKeys: String, CodingKey {
    case schemaHash = "schema_hash"
    case rawXml = "raw_xml"
    case createdAt = "created_at"
  }
}
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `BoardConfigRevisionEntity`
struct BoardConfigRevisionRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_config_revisions"
  var id: Int64?
  let boardId: String
  let refloatVersion: String
  let schemaHash: String
  let packageSignature: Int64
  let rawConfig: Data
  let source: String
  let changesJson: String
  let tuneProfileId: String?
  let createdAt: Int64
  enum CodingKeys: String, CodingKey {
    case id
    case boardId = "board_id"
    case refloatVersion = "refloat_version"
    case schemaHash = "schema_hash"
    case packageSignature = "package_signature"
    case rawConfig = "raw_config"
    case source
    case changesJson = "changes_json"
    case tuneProfileId = "tune_profile_id"
    case createdAt = "created_at"
  }
}
struct ConfigNoticeRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "board_config_change_notices"
  let boardId: String; let detectedAt: Int64; let diffsJson: String
  enum CodingKeys: String, CodingKey { case boardId = "board_id"; case detectedAt = "detected_at"; case diffsJson = "diffs_json" }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `BoardConfigRevisionSource`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigRevisionSource`
enum BoardConfigRevisionSource: String, Codable, Equatable {
  case app
  case external
  case revert
  case `import`
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `BoardConfigRevision`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigRevision`
struct BoardConfigRevision {
  let id: Int64
  let boardId: String
  let refloatVersion: String
  let schemaHash: String
  let packageSignature: Int64
  let source: BoardConfigRevisionSource
  let changes: [BoardConfigChangeDiff]
  let tuneProfileId: String?
  let createdAtMs: Int64

  func toBridgeMap() -> [String: Any?] {
    [
      "id": id,
      "boardId": boardId,
      "refloatVersion": refloatVersion,
      "schemaHash": schemaHash,
      "packageSignature": packageSignature,
      "source": source.rawValue,
      "changes": changes.map {
        [
          "fieldId": $0.fieldId,
          "label": $0.label,
          "unit": $0.unit,
          "oldValue": $0.oldValue?.toBridge(),
          "newValue": $0.newValue?.toBridge(),
        ] as [String: Any?]
      },
      "tuneProfileId": tuneProfileId,
      "createdAtMs": createdAtMs,
    ]
  }
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

  private static func normalizeForField(_ value: ConfigNoticeValue?, _ field: RefloatConfigSchemaField?) -> ConfigNoticeValue? {
    guard field?.type == .bool, let value else { return value }
    switch value {
    case .bool: return value
    case .number(0): return .bool(false)
    case .number(1): return .bool(true)
    case .number: return value
    }
  }

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
    let metadata = Dictionary(uniqueKeysWithValues: (schema?.fields ?? []).map { ($0.id, $0) })
    return Set(old.keys).union(new.keys).sorted().compactMap { id in
      guard !ignoredFields.contains(id) else { return nil }
      let field = metadata[id]
      let a = normalizeForField(ConfigNoticeValue(old[id]), field)
      let b = normalizeForField(ConfigNoticeValue(new[id]), field)
      guard changed(a, b) else { return nil }
      return .init(fieldId: id, label: field?.label ?? id, unit: field?.unit, oldValue: a, newValue: b)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigChangeNotice.kt `decodeIgnoredFields`
  static func decodeIgnoredFields(_ json: String?, onInvalid: ((Error) -> Void)? = nil) -> [String] {
    guard let json, !json.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
    guard let data = json.data(using: .utf8) else {
      onInvalid?(DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Ignored fields setting is not UTF-8")))
      return []
    }
    let decoded: Any
    do {
      decoded = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    } catch {
      onInvalid?(error)
      return []
    }
    guard let raw = decoded as? [Any] else {
      onInvalid?(DecodingError.typeMismatch([String].self, .init(codingPath: [], debugDescription: "Ignored fields setting is not a JSON array")))
      return []
    }
    var seen = Set<String>()
    return raw.compactMap { $0 as? String }.filter { !$0.isEmpty && seen.insert($0).inserted }
  }

  static func loadIgnoredFields(_ db: Database, boardId: String, onInvalid: ((Error) -> Void)? = nil) throws -> [String] {
    let json = try String.fetchOne(
      db,
      sql: "SELECT value_json FROM board_settings WHERE board_id = ? AND key = ?",
      arguments: [boardId, ignoredFieldsSettingKey]
    )
    return decodeIgnoredFields(json, onInvalid: onInvalid)
  }

  static func filterDiffs(_ diffs: [BoardConfigChangeDiff], excludedFields: Set<String>) -> [BoardConfigChangeDiff] {
    diffs.filter { !excludedFields.contains($0.fieldId) }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getBoardConfigValues`
struct BoardConfigStore {
  static var onNoticeChanged: ((BoardConfigChangeNotice?) -> Void)?
  static var onInvalidIgnoredFields: ((Error) -> Void)?
  static var onInvalidSchemaXml: ((Error) -> Void)?
  private static let schemaCacheLock = NSLock()
  private static var parsedSchemaCache: [String: RefloatConfigSchema] = [:]
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
    return try writer.read { db in
      guard let row = try BoardConfigRecord.fetchOne(db, key: ["board_id": boardId, "refloat_base_version": refloatBaseVersion]) else { return nil }
      let schema = try Self.loadSchema(db, schemaHash: row.schemaHash)
      return try BoardConfigValues.lastKnown(
        boardId: boardId,
        refloatBaseVersion: refloatBaseVersion,
        capturedAtMs: row.capturedAt,
        valuesJson: row.valuesJson,
        schemaHash: row.schemaHash,
        schema: schema
      )
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getLatestBoardConfigValues`
  func loadLatest(boardId: String) throws -> BoardConfigValues? {
    guard !boardId.isEmpty else { return nil }; guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    return try writer.read { db in
      guard let row = try BoardConfigRecord.filter(Column("board_id") == boardId).order(Column("captured_at").desc).fetchOne(db) else { return nil }
      let schema = try Self.loadSchema(db, schemaHash: row.schemaHash)
      return try BoardConfigValues.lastKnown(
        boardId: boardId,
        refloatBaseVersion: row.refloatBaseVersion,
        capturedAtMs: row.capturedAt,
        valuesJson: row.valuesJson,
        schemaHash: row.schemaHash,
        schema: schema
      )
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `loadSchema`
  func loadSchema(schemaHash: String) throws -> RefloatConfigSchema? {
    guard !schemaHash.isEmpty else { return nil }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    return try writer.read { db in try Self.loadSchema(db, schemaHash: schemaHash) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `saveSchema`
  func saveSchema(_ schema: RefloatConfigSchema, createdAt: Int64) throws {
    guard !schema.hash.isEmpty, !schema.rawXml.isEmpty else { return }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    try writer.write { db in try Self.insertSchemaIfAbsent(db, schema: schema, createdAt: createdAt) }
  }

  private static func loadSchema(_ db: Database, schemaHash: String?) throws -> RefloatConfigSchema? {
    guard let schemaHash, !schemaHash.isEmpty else { return nil }
    if let cached = cachedSchema(for: schemaHash) { return cached }
    guard let record = try BoardConfigSchemaRecord.fetchOne(db, key: schemaHash) else { return nil }
    do {
      let parsed = try RefloatConfigSchemaParser.parse(Array(record.rawXml.utf8))
      cacheSchema(parsed, for: schemaHash)
      return parsed
    } catch {
      Self.onInvalidSchemaXml?(error)
      return nil
    }
  }

  private static func cachedSchema(for schemaHash: String) -> RefloatConfigSchema? {
    schemaCacheLock.lock()
    defer { schemaCacheLock.unlock() }
    return parsedSchemaCache[schemaHash]
  }

  private static func cacheSchema(_ schema: RefloatConfigSchema, for schemaHash: String) {
    schemaCacheLock.lock()
    defer { schemaCacheLock.unlock() }
    parsedSchemaCache[schemaHash] = schema
  }

  private static func insertSchemaIfAbsent(_ db: Database, schema: RefloatConfigSchema?, createdAt: Int64) throws {
    guard let schema, !schema.hash.isEmpty, !schema.rawXml.isEmpty else { return }
    try db.execute(
      sql: "INSERT OR IGNORE INTO board_config_schemas (schema_hash, raw_xml, created_at) VALUES (?, ?, ?)",
      arguments: [schema.hash, schema.rawXml, createdAt]
    )
  }

  static let defaultRevisionsLimit = 200

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `saveBoardWrite`
  func saveWrite(
    _ values: BoardConfigValues,
    source: BoardConfigRevisionSource = .app,
    tuneProfileId: String? = nil
  ) throws {
    guard
      let boardId = values.boardId, !boardId.isEmpty,
      let refloatBaseVersion = values.refloatBaseVersion, !refloatBaseVersion.isEmpty,
      let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    let json = try values.valuesJson()
    let schema = values.schema ?? values.writeBase?.schema
    let schemaHash = (values.schemaHash ?? schema?.hash).flatMap { $0.isEmpty ? nil : $0 }
    let refloatVersion = values.refloatVersion.flatMap { $0.isEmpty ? nil : $0 } ?? refloatBaseVersion
    try writer.write { db in
      try Self.insertSchemaIfAbsent(db, schema: schema, createdAt: values.capturedAtMs)
      try BoardConfigRecord(boardId: boardId, refloatBaseVersion: refloatBaseVersion, valuesJson: json, capturedAt: values.capturedAtMs, schemaHash: schemaHash).save(db)
      try Self.appendRevisionIfNeeded(
        db,
        boardId: boardId,
        refloatVersion: refloatVersion,
        schema: schema,
        writeBase: values.writeBase,
        values: values.values,
        source: source,
        tuneProfileId: tuneProfileId,
        createdAt: values.capturedAtMs
      )
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `loadRevisions`
  func loadRevisions(boardId: String, limit: Int = defaultRevisionsLimit) throws -> [BoardConfigRevision] {
    guard !boardId.isEmpty, limit > 0 else { return [] }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    return try writer.read { db in
      let rows = try BoardConfigRevisionRecord
        .filter(Column("board_id") == boardId)
        .order(Column("created_at").desc, Column("id").desc)
        .limit(limit)
        .fetchAll(db)
      return try rows.map { row in
        let changes = try BoardConfigChangeNotice.from(
          boardId: row.boardId,
          detectedAtMs: row.createdAt,
          diffsJson: row.changesJson
        ).diffs
        return BoardConfigRevision(
          id: row.id ?? 0,
          boardId: row.boardId,
          refloatVersion: row.refloatVersion,
          schemaHash: row.schemaHash,
          packageSignature: row.packageSignature,
          source: BoardConfigRevisionSource(rawValue: row.source) ?? .app,
          changes: changes,
          tuneProfileId: row.tuneProfileId,
          createdAtMs: row.createdAt
        )
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `planRevert`
  func planRevert(
    boardId: String,
    current: BoardConfigValues?,
    revisionId: Int64,
    overlay: RefloatFieldOverlay = .shared
  ) throws -> BoardConfigRevertPlan {
    guard
      let current,
      current.freshness == .fresh,
      current.boardId == boardId,
      let writeBase = current.writeBase
    else {
      throw RefloatConfigEncodeException(
        .BOARD_NOT_CONNECTED,
        "Connect to this board to plan a config revert"
      )
    }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    return try writer.read { db in
      guard
        let record = try BoardConfigRevisionRecord.fetchOne(db, key: revisionId),
        record.boardId == boardId
      else {
        throw RefloatConfigEncodeException(.REVISION_NOT_FOUND, "Config revision not found")
      }
      let targetSchema: RefloatConfigSchema
      if record.schemaHash == writeBase.schema.hash {
        targetSchema = writeBase.schema
      } else {
        guard let loaded = try Self.loadSchema(db, schemaHash: record.schemaHash) else {
          throw RefloatConfigEncodeException(
            .SCHEMA_NOT_FOUND,
            "Schema for revision \(revisionId) is unavailable"
          )
        }
        targetSchema = loaded
      }
      return BoardConfigRevertPlanner.plan(
        boardId: boardId,
        currentSchema: writeBase.schema,
        currentRawConfig: writeBase.rawConfig,
        targetRevisionId: record.id ?? revisionId,
        targetCreatedAtMs: record.createdAt,
        targetRefloatVersion: record.refloatVersion,
        targetSchema: targetSchema,
        targetRawConfig: Array(record.rawConfig),
        overlay: overlay
      )
    }
  }

  private static func appendRevisionIfNeeded(
    _ db: Database,
    boardId: String,
    refloatVersion: String,
    schema: RefloatConfigSchema?,
    writeBase: BoardConfigWriteBase?,
    values: [String: Any],
    source: BoardConfigRevisionSource,
    tuneProfileId: String?,
    createdAt: Int64
  ) throws {
    guard let schema, !schema.hash.isEmpty, !schema.rawXml.isEmpty, let writeBase else { return }
    let rawData = Data(writeBase.rawConfig)
    let latest = try BoardConfigRevisionRecord
      .filter(Column("board_id") == boardId)
      .order(Column("created_at").desc, Column("id").desc)
      .fetchOne(db)
    let signature = Int64(writeBase.packageSignature)
    let changesJson: String
    if let latest {
      if latest.schemaHash == schema.hash,
         latest.packageSignature == signature,
         normalizeRevisionRawBytes(schema, Array(latest.rawConfig)) == normalizeRevisionRawBytes(schema, writeBase.rawConfig) {
        return
      }
      let previousSchema = latest.schemaHash == schema.hash ? schema : try Self.loadSchema(db, schemaHash: latest.schemaHash)
      if let previousSchema {
        let previousValues = RefloatConfigFieldDecoder.decodeFieldMap(schema: previousSchema, rawConfig: Array(latest.rawConfig))
        let diffs = BoardConfigChangeNotice.diff(
          old: previousValues,
          new: values,
          schema: schema,
          ignoredFields: BoardConfigChangeNotice.volatileMotorFields
        )
        changesJson = BoardConfigChangeNotice(boardId: boardId, detectedAtMs: createdAt, diffs: diffs).diffsJson()
      } else {
        changesJson = "[]"
      }
    } else {
      changesJson = "[]"
    }
    var record = BoardConfigRevisionRecord(
      id: nil,
      boardId: boardId,
      refloatVersion: refloatVersion,
      schemaHash: schema.hash,
      packageSignature: signature,
      rawConfig: rawData,
      source: source.rawValue,
      changesJson: changesJson,
      tuneProfileId: tuneProfileId,
      createdAt: createdAt
    )
    try record.insert(db)
  }

  private static func normalizeRevisionRawBytes(_ schema: RefloatConfigSchema, _ rawConfig: [UInt8]) -> [UInt8] {
    guard let metaField = schema.fields.first(where: { $0.id == "meta.is_default" }) else { return rawConfig }
    let end = metaField.offset + metaField.type.byteSize
    guard metaField.offset >= 0, rawConfig.count >= end else { return rawConfig }
    var normalized = rawConfig
    for i in metaField.offset..<end { normalized[i] = 0 }
    return normalized
  }

  func save(_ values: BoardConfigValues) throws {
    guard
      let boardId = values.boardId, !boardId.isEmpty,
      let refloatBaseVersion = values.refloatBaseVersion, !refloatBaseVersion.isEmpty,
      let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    let json = try values.valuesJson()
    let schema = values.schema ?? values.writeBase?.schema
    let schemaHash = (values.schemaHash ?? schema?.hash).flatMap { $0.isEmpty ? nil : $0 }
    try writer.write { db in
      try Self.insertSchemaIfAbsent(db, schema: schema, createdAt: values.capturedAtMs)
      try BoardConfigRecord(boardId: boardId, refloatBaseVersion: refloatBaseVersion, valuesJson: json, capturedAt: values.capturedAtMs, schemaHash: schemaHash).save(db)
    }
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
        valuesJson: json,
        schemaHash: row.schemaHash
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
    let schema = values.schema ?? values.writeBase?.schema
    let schemaHash = (values.schemaHash ?? schema?.hash).flatMap { $0.isEmpty ? nil : $0 }
    try writer.write { db in
      try Self.insertSchemaIfAbsent(db, schema: schema, createdAt: values.capturedAtMs)
      let oldRow = try Row.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id = ? AND refloat_base_version = ?", arguments: [boardId, base])
      if let oldJson: String = oldRow?["values_json"] {
        let old = try BoardConfigValues.lastKnown(boardId: boardId, refloatBaseVersion: base, capturedAtMs: 0, valuesJson: oldJson)
        let ignored = Set(try BoardConfigChangeNotice.loadIgnoredFields(db, boardId: boardId, onInvalid: Self.onInvalidIgnoredFields))
        let diffs = BoardConfigChangeNotice.diff(old: old.values, new: values.values, schema: schema, ignoredFields: ignored)
        if !diffs.isEmpty {
          let existing = try ConfigNoticeRecord.fetchOne(db, key: boardId)
          let previous = try existing.map {
            try BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: $0.detectedAt, diffsJson: $0.diffsJson).diffs
          } ?? []
          let excluded = ignored.union(BoardConfigChangeNotice.volatileMotorFields)
          let merged = BoardConfigChangeNotice.mergeDiffs(
            previous: BoardConfigChangeNotice.filterDiffs(previous, excludedFields: excluded),
            incoming: diffs
          )
          notice = BoardConfigChangeNotice(boardId: boardId, detectedAtMs: values.capturedAtMs, diffs: merged)
          try ConfigNoticeRecord(boardId: boardId, detectedAt: values.capturedAtMs, diffsJson: notice!.diffsJson()).save(db)
        }
      }
      try BoardConfigRecord(boardId: boardId, refloatBaseVersion: base, valuesJson: try values.valuesJson(), capturedAt: values.capturedAtMs, schemaHash: schemaHash).save(db)
      let refloatVersion = values.refloatVersion.flatMap { $0.isEmpty ? nil : $0 } ?? base
      try Self.appendRevisionIfNeeded(
        db,
        boardId: boardId,
        refloatVersion: refloatVersion,
        schema: schema,
        writeBase: values.writeBase,
        values: values.values,
        source: .external,
        tuneProfileId: nil,
        createdAt: values.capturedAtMs
      )
      committed = true
    }
    if committed, let notice { Self.onNoticeChanged?(notice) }
  }

  func loadNotice(boardId: String) throws -> BoardConfigChangeNotice? {
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    return try writer.read { db in
      guard let row = try ConfigNoticeRecord.fetchOne(db, key: boardId) else { return nil }
      let loaded = try BoardConfigChangeNotice.from(boardId: boardId, detectedAtMs: row.detectedAt, diffsJson: row.diffsJson)
      let ignored = Set(try BoardConfigChangeNotice.loadIgnoredFields(db, boardId: boardId, onInvalid: Self.onInvalidIgnoredFields))
      let filtered = BoardConfigChangeNotice.filterDiffs(loaded.diffs, excludedFields: ignored.union(BoardConfigChangeNotice.volatileMotorFields))
      guard !filtered.isEmpty else { return nil }
      return BoardConfigChangeNotice(boardId: loaded.boardId, detectedAtMs: loaded.detectedAtMs, diffs: filtered)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `setFieldIgnored`
  func setFieldIgnored(boardId: String, fieldId: String, ignored: Bool) throws {
    guard !boardId.isEmpty, !fieldId.isEmpty else { return }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    try writer.write { db in
      var current = try BoardConfigChangeNotice.loadIgnoredFields(db, boardId: boardId, onInvalid: Self.onInvalidIgnoredFields)
      if ignored {
        if !current.contains(fieldId) { current.append(fieldId) }
      } else {
        current.removeAll { $0 == fieldId }
      }
      if current.isEmpty {
        try db.execute(
          sql: "DELETE FROM board_settings WHERE board_id = ? AND key = ?",
          arguments: [boardId, BoardConfigChangeNotice.ignoredFieldsSettingKey]
        )
      } else {
        let data = try JSONSerialization.data(withJSONObject: current, options: [])
        let json = String(decoding: data, as: UTF8.self)
        try db.execute(
          sql: "INSERT OR REPLACE INTO board_settings (board_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
          arguments: [boardId, BoardConfigChangeNotice.ignoredFieldsSettingKey, json, now]
        )
      }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/ConfigPersistence.kt `clearIgnoredFields`
  func clearIgnoredFields(boardId: String) throws {
    guard !boardId.isEmpty else { return }
    guard let writer = resolveWriter() else { throw ConfigStorageError.databaseNotOpen }
    try writer.write { db in
      try db.execute(
        sql: "DELETE FROM board_settings WHERE board_id = ? AND key = ?",
        arguments: [boardId, BoardConfigChangeNotice.ignoredFieldsSettingKey]
      )
    }
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
