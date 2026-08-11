import Foundation
import GRDB

/// Android-matching error vocabulary for Tune Profile mutations. Messages are byte-for-byte the same
/// as Android so JS surfaces identical text, and the JS `errorMessage()` helper reads `message`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
enum TuneProfileError: LocalizedError {
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
    try db.execute(sql: """
      CREATE TABLE tune_profiles (
        id TEXT NOT NULL PRIMARY KEY,
        board_id TEXT NOT NULL,
        refloat_base_version TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'sliders-horizontal',
        color TEXT NOT NULL DEFAULT 'purple',
        fields_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
      """)
    try db.execute(sql: "CREATE INDEX index_tune_profiles_board_id ON tune_profiles(board_id)")
    try db.execute(sql: "CREATE INDEX index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)")

    try db.execute(sql: """
      CREATE TABLE tune_history_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        profile_id TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
      """)
    try db.execute(sql: "CREATE INDEX index_tune_history_entries_profile_id ON tune_history_entries(profile_id)")
    try db.execute(sql: "CREATE INDEX index_tune_history_entries_created_at ON tune_history_entries(created_at)")
  }

  // MARK: - Reads

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getTuneProfiles`
  func getTuneProfiles(_ boardId: String, refloatBaseVersion: String?) -> [[String: Any?]] {
    guard let compatibility = Self.validRefloatBaseVersion(refloatBaseVersion) else { return [] }
    guard let writer = resolveWriter() else { return [] }
    return (try? writer.read { db in
      try Row.fetchAll(
        db,
        sql: "SELECT * FROM tune_profiles WHERE board_id = ? AND refloat_base_version = ? ORDER BY created_at ASC",
        arguments: [boardId, compatibility]
      ).map { Self.profileMap($0) }
    }) ?? []
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getTuneProfile`
  func getTuneProfile(_ id: String) -> [String: Any?]? {
    guard let writer = resolveWriter() else { return nil }
    return (try? writer.read { db in try Self.fetchProfileMap(db, id) }).flatMap { $0 }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `getProfileHistory`
  func getProfileHistory(_ profileId: String) -> [[String: Any?]] {
    guard let writer = resolveWriter() else { return [] }
    return (try? writer.read { db in
      try Row.fetchAll(
        db,
        // `id` breaks ties: a save and a rollback can land in the same millisecond, and without a
        // monotonic tiebreaker `created_at DESC` alone returns them in insertion order — oldest
        // first — which is the opposite of what Tune History shows.
        sql: "SELECT * FROM tune_history_entries WHERE profile_id = ? ORDER BY created_at DESC, id DESC",
        arguments: [profileId]
      ).map { Self.historyMap($0) }
    }) ?? []
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
    let fieldsJson = Self.encodeFields(fields)
    let id = Self.newId()
    return try inWrite { db in
      try db.execute(
        sql: """
          INSERT INTO tune_profiles (id, board_id, refloat_base_version, name, icon, color, fields_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
        arguments: [id, boardId, compatibility, name, icon, color, fieldsJson, now, now]
      )
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
      try db.execute(
        sql: "UPDATE tune_profiles SET name = ?, icon = ?, color = ?, updated_at = ? WHERE id = ?",
        arguments: [name, icon, color, now, profileId]
      )
      guard let map = try Self.fetchProfileMap(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
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
      try db.execute(
        sql: "UPDATE tune_profiles SET fields_json = ?, updated_at = ? WHERE id = ?",
        arguments: [entry["fields_json"] as String, now, profileId]
      )
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
      try db.execute(
        sql: """
          INSERT INTO tune_profiles (id, board_id, refloat_base_version, name, icon, color, fields_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
        arguments: [copyId, targetBoardId, source["refloat_base_version"] as String, newName, icon, color, fieldsJson, now, now]
      )
      try Self.insertHistory(db, profileId: copyId, fieldsJson: fieldsJson, createdAt: now)
      return try Self.requireProfileMap(db, copyId)
    }
  }

  /// Save new fields onto a Tune Profile, first snapshotting the current fields as a Tune History
  /// entry so the edit is reversible.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt `saveTuneProfile`
  func saveProfile(profileId: String, fields: [String: Any]) throws -> [String: Any?] {
    let now = Self.nowMs()
    let fieldsJson = Self.encodeFields(fields)
    return try inWrite { db in
      guard let current = try Self.fetchProfileRow(db, profileId) else {
        throw TuneProfileError.profileNotFound(profileId)
      }
      try Self.insertHistory(db, profileId: profileId, fieldsJson: current["fields_json"], createdAt: now)
      try db.execute(
        sql: "UPDATE tune_profiles SET fields_json = ?, updated_at = ? WHERE id = ?",
        arguments: [fieldsJson, now, profileId]
      )
      guard let map = try Self.fetchProfileMap(db, profileId) else {
        throw TuneProfileError.disappearedDuringSave(profileId)
      }
      return map
    }
  }

  // MARK: - Private helpers

  private func inWrite<T>(_ body: @escaping (Database) throws -> T) throws -> T {
    guard let writer = resolveWriter() else { throw TuneProfileError.databaseUnavailable }
    return try writer.write(body)
  }

  private static func insertHistory(
    _ db: Database,
    profileId: String,
    fieldsJson: String,
    createdAt: Int64
  ) throws {
    try db.execute(
      sql: "INSERT INTO tune_history_entries (profile_id, fields_json, created_at) VALUES (?, ?, ?)",
      arguments: [profileId, fieldsJson, createdAt]
    )
  }

  private static func fetchProfileRow(_ db: Database, _ id: String) throws -> Row? {
    try Row.fetchOne(db, sql: "SELECT * FROM tune_profiles WHERE id = ? LIMIT 1", arguments: [id])
  }

  private static func fetchProfileMap(_ db: Database, _ id: String) throws -> [String: Any?]? {
    try fetchProfileRow(db, id).map { profileMap($0) }
  }

  private static func requireProfileMap(_ db: Database, _ id: String) throws -> [String: Any?] {
    guard let map = try fetchProfileMap(db, id) else { throw TuneProfileError.profileNotFound(id) }
    return map
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `TuneProfileEntity.toMap`
  private static func profileMap(_ row: Row) -> [String: Any?] {
    [
      "id": row["id"] as String,
      "boardId": row["board_id"] as String,
      "refloatBaseVersion": row["refloat_base_version"] as String,
      "name": row["name"] as String,
      "icon": row["icon"] as String,
      "color": row["color"] as String,
      "fields": decodeFields(row["fields_json"]),
      "createdAt": row["created_at"] as Int64,
      "updatedAt": row["updated_at"] as Int64,
    ]
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AppDataRepository.kt `TuneHistoryEntryEntity.toMap`
  private static func historyMap(_ row: Row) -> [String: Any?] {
    [
      "id": row["id"] as Int64,
      "profileId": row["profile_id"] as String,
      "fields": decodeFields(row["fields_json"]),
      "createdAt": row["created_at"] as Int64,
    ]
  }

  /// Serialize the bridge-delivered fields (JS `null` arrives as `NSNull`, which JSONSerialization
  /// writes as `null`) into the `fields_json` column, matching Android's `toJsonObject().toString()`.
  private static func encodeFields(_ fields: [String: Any]) -> String {
    guard
      let data = try? JSONSerialization.data(withJSONObject: fields),
      let json = String(data: data, encoding: .utf8)
    else { return "{}" }
    return json
  }

  private static func decodeFields(_ json: String) -> [String: Any] {
    guard
      let data = json.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
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
