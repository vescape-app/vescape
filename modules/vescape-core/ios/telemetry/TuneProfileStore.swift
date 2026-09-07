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

private struct TuneHistoryRecord: Codable, PersistableRecord {
  static let databaseTableName = "tune_history_entries"
  var id: Int64?
  let profileId: String, fieldsJson: String, createdAt: Int64
  enum CodingKeys: String, CodingKey {
    case id, profileId = "profile_id", fieldsJson = "fields_json", createdAt = "created_at"
  }
}

/// Android-matching error vocabulary for Tune Profile mutations. Messages are byte-for-byte the same
/// as Android so JS surfaces identical text, and the JS `errorMessage()` helper reads `message`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
enum TuneProfileError: LocalizedError, Equatable {
  case profileNotFound(String)
  case cannotDeleteLast
  case historyEntryNotFound(Int64)
  case historyEntryWrongProfile
  case sourceProfileNotFound(String)
  case disappearedDuringRollback(String)
  case disappearedDuringSave(String)
  case missingRefloatCompatibility
  case databaseUnavailable

  var errorDescription: String? {
    switch self {
    case .profileNotFound(let id): return "Tune Profile not found: \(id)"
    case .cannotDeleteLast: return "Cannot delete the last profile for a board"
    case .historyEntryNotFound(let id): return "History entry not found: \(id)"
    case .historyEntryWrongProfile: return "History entry does not belong to this profile"
    case .sourceProfileNotFound(let id): return "Source profile not found: \(id)"
    case .disappearedDuringRollback(let id): return "Tune Profile disappeared during rollback: \(id)"
    case .disappearedDuringSave(let id): return "Tune Profile disappeared during save: \(id)"
    case .missingRefloatCompatibility: return "Missing Refloat Tune Compatibility"
    case .databaseUnavailable: return "Tune Profile database is unavailable"
    }
  }
}

/// DB-backed storage for Tune Profiles (per-board VESC tune configs) and their Tune History. Mirrors
/// the Android `AppDataRepository` tune methods plus the transactional DAO bodies in `TelemetryDao`.
/// Native owns durable truth; JS renders state and sends intents. Values cross the bridge as
/// `[String: Any?]` bags to match the JS contract, using the same `tune_profiles` /
/// `tune_history_entries` table shapes as Android Room.
///
/// A `Tune History` entry snapshots the profile fields at a point in time. `saveProfile` and
/// `rollbackProfile` append a history entry (the pre-change fields) before mutating so every edit is
/// reversible; `deleteProfile` refuses to remove a board's last Tune Profile.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt
struct TuneProfileStore {
  /// Bridge rejection code for Tune Profile mutation failures. JS reads the message, not the code.
  static let errorCode = "ERR_TUNE_PROFILE"

  /// Resolves the shared GRDB writer at call time so it always sees the current pool (which is
  /// swapped on database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  /// Bound to the single app-data database. Mirrors Android routing tune ops through the singleton
  /// `AppDataRepository`.
  static let shared = TuneProfileStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  // MARK: - Schema

  /// Create the Tune Profile tables. Called from the app-data `DatabaseMigrator` and reused by tests
  /// so the schema stays single-source. Mirrors Android `TuneProfileEntity` / `TuneHistoryEntryEntity`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createTuneProfiles(db)
  }

  // MARK: - Reads

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getTuneProfiles`
  func getTuneProfiles(_ boardId: String, refloatBaseVersion: String?) throws -> [[String: Any?]] {
    guard let compatibility = Self.validRefloatBaseVersion(refloatBaseVersion) else { return [] }
    let writer = try requireWriter()
    return try writer.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM tune_profiles WHERE board_id = ? AND refloat_base_version = ? ORDER BY created_at ASC",
        arguments: [boardId, compatibility]
      ).map { try Self.profileMap($0) }
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getTuneProfile`
  func getTuneProfile(_ id: String) throws -> [String: Any?]? {
    try requireWriter().read { db in try Self.fetchProfileMap(db, id) }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getProfileHistory`
  func getProfileHistory(_ profileId: String) throws -> [[String: Any?]] {
    try requireWriter().read { db in
      try Row.fetchAll(
        db,
        // `id` breaks ties: a save and a rollback can land in the same millisecond, and without a
        // monotonic tiebreaker `created_at DESC` alone returns them in insertion order — oldest
        // first — which is the opposite of what Tune History shows.
        sql: "SELECT * FROM tune_history_entries WHERE profile_id = ? ORDER BY created_at DESC, id DESC",
        arguments: [profileId]
      ).map { try Self.historyMap($0) }
    }
  }

  // MARK: - Mutations

  /// Create a Tune Profile plus its first Tune History entry.
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
      try Self.insertHistory(db, profileId: id, fieldsJson: fieldsJson, createdAt: now)
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

  /// Delete a Tune Profile and its Tune History, refusing to remove a board's last profile.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `deleteTuneProfileSafe`
  func deleteProfile(profileId: String) throws {
    _ = try inWrite { db -> Bool in
      guard let row = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      let boardId: String = row["board_id"]
      let count = try Int.fetchOne(
        db,
        sql: "SELECT COUNT(*) FROM tune_profiles WHERE board_id = ? AND refloat_base_version = ?",
        arguments: [boardId, row["refloat_base_version"] as String]
      ) ?? 0
      if count <= 1 { throw TuneProfileError.cannotDeleteLast }
      try db.execute(sql: "DELETE FROM tune_history_entries WHERE profile_id = ?", arguments: [profileId])
      try db.execute(sql: "DELETE FROM tune_profiles WHERE id = ?", arguments: [profileId])
      return true
    }
  }

  /// Restore a Tune Profile's fields from a Tune History entry, first snapshotting the current fields
  /// as a new history entry so the rollback is itself reversible.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `rollbackTuneProfile`
  func rollbackProfile(profileId: String, historyEntryId: Int64) throws -> [String: Any?] {
    let now = Self.nowMs()
    return try inWrite { db in
      guard let profile = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      guard let entry = try Row.fetchOne(
        db,
        sql: "SELECT * FROM tune_history_entries WHERE id = ? LIMIT 1",
        arguments: [historyEntryId]
      ) else {
        throw TuneProfileError.historyEntryNotFound(historyEntryId)
      }
      let entryProfileId: String = entry["profile_id"]
      if entryProfileId != profileId { throw TuneProfileError.historyEntryWrongProfile }

      try Self.insertHistory(db, profileId: profileId, fieldsJson: profile["fields_json"], createdAt: now)
      try TuneProfileRecord(id: profileId, boardId: profile["board_id"], refloatBaseVersion: profile["refloat_base_version"], name: profile["name"], icon: profile["icon"], color: profile["color"], fieldsJson: entry["fields_json"], createdAt: profile["created_at"], updatedAt: now).update(db)
      guard let map = try Self.fetchProfileMap(db, profileId) else {
        throw TuneProfileError.disappearedDuringRollback(profileId)
      }
      return map
    }
  }

  /// Copy a Tune Profile's fields onto another board as a new profile, seeding its Tune History.
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
      try Self.insertHistory(db, profileId: copyId, fieldsJson: fieldsJson, createdAt: now)
      return try Self.requireProfileMap(db, copyId)
    }
  }

  /// Save new fields onto a Tune Profile, first snapshotting the current fields as a Tune History
  /// entry so the edit is reversible.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `saveTuneProfile`
  func saveProfile(profileId: String, fields: [String: Any]) throws -> [String: Any?] {
    let now = Self.nowMs()
    let fieldsJson = try Self.encodeFields(fields)
    return try inWrite { db in
      guard let current = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      try Self.insertHistory(db, profileId: profileId, fieldsJson: current["fields_json"], createdAt: now)
      try TuneProfileRecord(id: profileId, boardId: current["board_id"], refloatBaseVersion: current["refloat_base_version"], name: current["name"], icon: current["icon"], color: current["color"], fieldsJson: fieldsJson, createdAt: current["created_at"], updatedAt: now).update(db)
      guard let map = try Self.fetchProfileMap(db, profileId) else {
        throw TuneProfileError.disappearedDuringSave(profileId)
      }
      return map
    }
  }

  // MARK: - Private helpers

  private func inWrite<T>(_ body: @escaping (Database) throws -> T) throws -> T {
    try requireWriter().write(body)
  }

  private func requireWriter() throws -> DatabaseWriter {
    guard let writer = resolveWriter() else { throw TuneProfileError.databaseUnavailable }
    return writer
  }

  private static func insertHistory(
    _ db: Database,
    profileId: String,
    fieldsJson: String,
    createdAt: Int64
  ) throws {
    try TuneHistoryRecord(id: nil, profileId: profileId, fieldsJson: fieldsJson, createdAt: createdAt).insert(db)
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

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `TuneHistoryEntryEntity.toMap`
  private static func historyMap(_ row: Row) throws -> [String: Any?] {
    [
      "id": row["id"] as Int64,
      "profileId": row["profile_id"] as String,
      "fields": try decodeFields(row["fields_json"]),
      "createdAt": row["created_at"] as Int64,
    ]
  }

  /// Serialize the bridge-delivered fields (JS `null` arrives as `NSNull`, which JSONSerialization
  /// writes as `null`) into the `fields_json` column, matching Android's `toJsonObject().toString()`.
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

  /// Android uses `UUID.randomUUID().toString()` (lowercase); match it so ids look identical.
  private static func newId() -> String { UUID().uuidString.lowercased() }

  private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  private static func validRefloatBaseVersion(_ value: String?) -> String? {
    guard let value, value.range(of: #"^\d+\.\d+(?:\.\d+)?$"#, options: .regularExpression) != nil else {
      return nil
    }
    return value
  }
}
