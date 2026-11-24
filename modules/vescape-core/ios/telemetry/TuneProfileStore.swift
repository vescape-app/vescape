import Foundation
import GRDB

private struct TuneProfileRecord: Codable, FetchableRecord, PersistableRecord {
  static let databaseTableName = "tune_profiles"
  let id: String, boardId: String, refloatBaseVersion: String, name: String, icon: String, color: String, fieldsJson: String
  let createdAt: Int64, updatedAt: Int64
  enum CodingKeys: String, CodingKey {
    case id, boardId = "board_id", refloatBaseVersion = "refloat_base_version", name, icon, color
    case fieldsJson = "fields_json", createdAt = "created_at", updatedAt = "updated_at"
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt
enum TuneProfileError: LocalizedError, Equatable {
  case profileNotFound(String)
  case cannotDeleteLast
  case sourceProfileNotFound(String)
  case disappearedDuringSave(String)
  case missingRefloatCompatibility
  case databaseUnavailable

  var errorDescription: String? {
    switch self {
    case .profileNotFound(let id): return "Tune Profile not found: \(id)"
    case .cannotDeleteLast: return "Cannot delete the last profile for a board"
    case .sourceProfileNotFound(let id): return "Source profile not found: \(id)"
    case .disappearedDuringSave(let id): return "Tune Profile disappeared during save: \(id)"
    case .missingRefloatCompatibility: return "Missing Refloat Tune Compatibility"
    case .databaseUnavailable: return "Tune Profile database is unavailable"
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt
struct TuneProfileStore {
  static let errorCode = "ERR_TUNE_PROFILE"

  private let resolveWriter: () -> DatabaseWriter?

  static let shared = TuneProfileStore { VescapeDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createTuneProfiles(db)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getTuneProfiles`
  func getTuneProfiles(_ boardId: String, refloatBaseVersion: String?) throws -> [[String: Any?]] {
    guard let compatibility = Self.validRefloatBaseVersion(refloatBaseVersion) else { return [] }
    let writer = try requireWriter()
    return try writer.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM tune_profiles WHERE board_id = ? ORDER BY created_at ASC",
        arguments: [boardId]
      ).filter { Self.validRefloatBaseVersion($0["refloat_base_version"] as String) == compatibility }.map { try Self.profileMap($0) }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getTuneProfile`
  func getTuneProfile(_ id: String) throws -> [String: Any?]? {
    try requireWriter().read { db in try Self.fetchProfileMap(db, id) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `createProfile`
  func createProfile(
    boardId: String,
    name: String,
    icon: String = "sliders-horizontal",
    color: String = "purple",
    fields: [String: Any],
    refloatBaseVersion: String
  ) throws -> [String: Any?] {
    guard let compatibility = Self.validRefloatBaseVersion(refloatBaseVersion) else {
      throw TuneProfileError.missingRefloatCompatibility
    }
    let now = Self.nowMs()
    let fieldsJson = try Self.encodeFields(fields)
    let id = Self.newId()
    return try inWrite { db in
      try TuneProfileRecord(id: id, boardId: boardId, refloatBaseVersion: compatibility, name: name, icon: icon, color: color, fieldsJson: fieldsJson, createdAt: now, updatedAt: now).insert(db)
      return try Self.requireProfileMap(db, id)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `renameProfile`
  func renameProfile(
    profileId: String,
    name: String,
    icon: String = "sliders-horizontal",
    color: String = "purple"
  ) throws -> [String: Any?] {
    let now = Self.nowMs()
    return try inWrite { db in
      guard let current = try TuneProfileRecord.fetchOne(db, key: profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      try TuneProfileRecord(id: current.id, boardId: current.boardId, refloatBaseVersion: current.refloatBaseVersion, name: name, icon: icon, color: color, fieldsJson: current.fieldsJson, createdAt: current.createdAt, updatedAt: now).update(db)
      guard let map = try Self.fetchProfileMap(db, profileId) else { throw TuneProfileError.profileNotFound(profileId) }
      return map
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `deleteTuneProfileSafe`
  func deleteProfile(profileId: String) throws {
    _ = try inWrite { db -> Bool in
      guard let row = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      let boardId: String = row["board_id"]
      let compatibility = Self.validRefloatBaseVersion(row["refloat_base_version"] as String)
      let count = try Row.fetchAll(db, sql: "SELECT * FROM tune_profiles WHERE board_id = ?", arguments: [boardId])
        .filter { compatibility != nil && Self.validRefloatBaseVersion($0["refloat_base_version"] as String) == compatibility }.count
      if count <= 1 { throw TuneProfileError.cannotDeleteLast }
      try db.execute(sql: "DELETE FROM tune_profiles WHERE id = ?", arguments: [profileId])
      return true
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `copyProfileToBoard`
  func copyProfileToBoard(profileId: String, targetBoardId: String, newName: String) throws -> [String: Any?] {
    let now = Self.nowMs()
    let copyId = Self.newId()
    return try inWrite { db in
      guard let source = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.sourceProfileNotFound(profileId)
      }
      let fieldsJson: String = source["fields_json"]
      let icon: String = source["icon"]
      let color: String = source["color"]
      try TuneProfileRecord(id: copyId, boardId: targetBoardId, refloatBaseVersion: source["refloat_base_version"], name: newName, icon: icon, color: color, fieldsJson: fieldsJson, createdAt: now, updatedAt: now).insert(db)
      return try Self.requireProfileMap(db, copyId)
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `saveTuneProfile`
  func saveProfile(profileId: String, fields: [String: Any]) throws -> [String: Any?] {
    let now = Self.nowMs()
    let fieldsJson = try Self.encodeFields(fields)
    return try inWrite { db in
      guard let current = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      try TuneProfileRecord(id: profileId, boardId: current["board_id"], refloatBaseVersion: current["refloat_base_version"], name: current["name"], icon: current["icon"], color: current["color"], fieldsJson: fieldsJson, createdAt: current["created_at"], updatedAt: now).update(db)
      guard let map = try Self.fetchProfileMap(db, profileId) else {
        throw TuneProfileError.disappearedDuringSave(profileId)
      }
      return map
    }
  }

  private func inWrite<T>(_ body: @escaping (Database) throws -> T) throws -> T {
    try requireWriter().write(body)
  }

  private func requireWriter() throws -> DatabaseWriter {
    guard let writer = resolveWriter() else { throw TuneProfileError.databaseUnavailable }
    return writer
  }

  private static func fetchProfileRow(_ db: Database, _ id: String) throws -> Row? {
    try Row.fetchOne(db, sql: "SELECT * FROM tune_profiles WHERE id = ? LIMIT 1", arguments: [id])
  }

  private static func fetchProfileMap(_ db: Database, _ id: String) throws -> [String: Any?]? {
    try fetchProfileRow(db, id).map { try profileMap($0) }
  }

  private static func requireProfileMap(_ db: Database, _ id: String) throws -> [String: Any?] {
    guard let map = try fetchProfileMap(db, id) else { throw TuneProfileError.profileNotFound(id) }
    return map
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `TuneProfileEntity.toMap`
  private static func profileMap(_ row: Row) throws -> [String: Any?] {
    [
      "id": row["id"] as String,
      "boardId": row["board_id"] as String,
      "refloatBaseVersion": row["refloat_base_version"] as String,
      "name": row["name"] as String,
      "icon": row["icon"] as String,
      "color": row["color"] as String,
      "fields": try decodeFields(row["fields_json"]),
      "createdAt": row["created_at"] as Int64,
      "updatedAt": row["updated_at"] as Int64,
    ]
  }

  private static func encodeFields(_ fields: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: fields)
    guard let json = String(data: data, encoding: .utf8) else { throw TuneProfileError.databaseUnavailable }
    return json
  }

  private static func decodeFields(_ json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8) else { throw TuneProfileError.databaseUnavailable }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw TuneProfileError.databaseUnavailable
    }
    return object
  }

  private static func newId() -> String { UUID().uuidString.lowercased() }

  private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TuneAlertPersistence.kt `tuneCompatibilityVersion`
  // @parity /src/modules/tune/lib/tuneCompatibility.ts `tuneCompatibilityVersion`
  static func validRefloatBaseVersion(_ value: String?) -> String? {
    guard let value, value.range(of: #"^\d+\.\d+(?:\.\d+)?(?:[-+].*)?$"#, options: .regularExpression) != nil else {
      return nil
    }
    return String(value.prefix { $0 != "-" && $0 != "+" }.split(separator: ".").prefix(2).joined(separator: "."))
  }
}
