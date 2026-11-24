import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeRoomDatabase.kt `VESCAPE_DATABASE_VERSION`
internal let VESCAPE_DATABASE_VERSION = 58

internal let supportedAndroidDatabaseVersions: Set<Int> =
  Set(3...36).union(40...VESCAPE_DATABASE_VERSION)
internal let exportedAndroidDatabaseVersions: Set<Int> =
  Set(14...36).union(40...VESCAPE_DATABASE_VERSION)
internal let exportedIOSDatabaseVersions: Set<Int> =
  Set([1]).union(23...36).union(40...VESCAPE_DATABASE_VERSION)

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseUpgradeContract.kt `SHARED_DATABASE_TABLES`
internal let sharedDatabaseTables: Set<String> = [
  "accessories",
  "accessory_brake_light",
  "accessory_capability_settings",
  "accessory_ground_clearance",
  "alerts",
  "app_settings",
  "board_config_change_notices",
  "board_config_revisions",
  "board_config_schemas",
  "board_config_values",
  "board_settings",
  "board_warnings",
  "boards",
  "diagnostic_events",
  "favorite_media",
  "favorites",
  "metric_exclusion_ranges",
  "motor_config_values",
  "privacy_zones",
  "ride_track_points",
  "telemetry_chunks",
  "telemetry_frames",
  "telemetry_markers",
  "telemetry_minute_buckets",
  "tune_profiles",
  "vesc_fault_capture_samples",
  "vesc_fault_captures",
  "vesc_fault_occurrences",
  "weather_observations",
]

private let engineTables: Set<String> = ["room_master_table", "android_metadata", "grdb_migrations"]

internal func isUnknownTable(_ name: String) -> Bool {
  !sharedDatabaseTables.contains(name) && !engineTables.contains(name) && !name.hasPrefix("sqlite_")
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseBackupManager.kt
/// @platform-diff iOS returns a `file://` URL (Android returns a content URI) and hot-swaps the
/// GRDB pool in place; there is no Room `closeAndReset`, so `VescapeDatabase.replaceDatabase`
/// closes and reopens the pool.
enum DatabaseBackupManager {
  enum BackupError: LocalizedError {
    case databaseUnavailable
    case invalidBackup(String)

    var errorDescription: String? {
      switch self {
      case .databaseUnavailable: return "Database unavailable"
      case let .invalidBackup(reason): return reason
      }
    }
  }

  static func createBackup() throws -> [String: Any?] {
    guard let pool = VescapeDatabase.pool, let dbURL = VescapeDatabase.databaseURL else {
      throw BackupError.databaseUnavailable
    }
    TelemetryRepository.shared.flushBlocking()

    let fm = FileManager.default
    let exportDir = fm.temporaryDirectory.appendingPathComponent("db-backups", isDirectory: true)
    try fm.createDirectory(at: exportDir, withIntermediateDirectories: true)
    let stamp = utcStamp()
    let sqliteExport = exportDir.appendingPathComponent("vescape-\(stamp).sqlite")
    let zipExport = exportDir.appendingPathComponent("vesc-db-backup-\(stamp).zip")
    // intentional-suppression: temporary-file cleanup is best effort and invalid backup is returned explicitly
    try? fm.removeItem(at: sqliteExport)
    // intentional-suppression: temporary-file cleanup is best effort and invalid backup is returned explicitly
    try? fm.removeItem(at: zipExport)

    let escaped = sqliteExport.path.replacingOccurrences(of: "'", with: "''")
    try pool.writeWithoutTransaction { db in
      try db.execute(sql: "VACUUM INTO '\(escaped)'")
    }

    let exportQueue = try DatabaseQueue(path: sqliteExport.path)
    try exportQueue.writeWithoutTransaction { db in
      try db.execute(sql: "PRAGMA user_version = \(VESCAPE_DATABASE_VERSION)")
    }
    try exportQueue.close()

    let dbData = try Data(contentsOf: sqliteExport)
    let manifestData = try manifest(dbSizeBytes: Int64(dbData.count), sourceURL: dbURL)
    let zipData = DatabaseBackupArchive.archive(database: dbData, manifest: manifestData, sounds: MySounds.archiveEntries())
    try zipData.write(to: zipExport, options: .atomic)
    // intentional-suppression: temporary-file cleanup is best effort and invalid backup is returned explicitly
    try? fm.removeItem(at: sqliteExport)

    return [
      "uri": zipExport.absoluteString,
      "name": zipExport.lastPathComponent,
      "sizeBytes": Int64(zipData.count),
    ]
  }

  static func restoreBackup(uriString: String) throws {
    let fm = FileManager.default
    let sourceURL = fileURL(from: uriString)
    let zipData = try Data(contentsOf: sourceURL)
    let workDir = fm.temporaryDirectory.appendingPathComponent("db-restore-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: workDir, withIntermediateDirectories: true)
    // intentional-suppression: temporary-file cleanup is best effort and invalid backup is returned explicitly
    defer { try? fm.removeItem(at: workDir) }
    let staged = try stageBackupArchive(zipData, in: workDir)

    TelemetryRepository.shared.beginDatabaseSwap()
    defer { TelemetryRepository.shared.endDatabaseSwap() }
    try DatabaseReplacementFence.process.fence {
      try VescapeDatabase.replaceDatabase(withFileAt: staged.database, schemaVersion: staged.roomVersion) { _ in
        try MySounds.replaceFromBackup(staged.sounds)
      }
    }
  }

  internal static func stageBackupArchive(_ zipData: Data, in workDir: URL) throws -> (database: URL, roomVersion: Int, sounds: [String: Data]) {
    let (manifestData, dbData, sounds) = try DatabaseBackupArchive.extract(zipData)
    try MySounds.validateBackup(sounds)
    let schema = try validateManifest(manifestData)
    let restoredDb = workDir.appendingPathComponent("restored.sqlite")
    try dbData.write(to: restoredDb, options: .atomic)
    let validated = try validateDatabase(restoredDb, manifest: schema)
    return (restoredDb, validated.roomVersion, sounds)
  }

  private static func fileURL(from uriString: String) -> URL {
    if let url = URL(string: uriString), url.isFileURL { return url }
    return URL(fileURLWithPath: uriString)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseBackupManager.kt
  private struct BackupSchema {
    let platform: String
    let declaredVersion: Int
    let roomVersion: Int
  }

  private static func validateManifest(_ data: Data) throws -> BackupSchema {
    guard
      // intentional-suppression: temporary-file cleanup is best effort and invalid backup is returned explicitly
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw BackupError.invalidBackup("Unreadable manifest") }
    guard (object["format"] as? String) == "vesc-db-backup" else {
      throw BackupError.invalidBackup("Unsupported backup format")
    }
    let schemaVersion = (object["schemaVersion"] as? NSNumber)?.intValue ?? -1
    let platform = object["platform"] as? String ?? ""
    let supported = platform == "android"
      ? exportedAndroidDatabaseVersions.contains(schemaVersion)
      : platform == "ios" && exportedIOSDatabaseVersions.contains(schemaVersion)
    guard supported else {
      throw BackupError.invalidBackup(
        "Backup schema version \(schemaVersion) has no supported migration path to app schema \(VESCAPE_DATABASE_VERSION)"
      )
    }
    return BackupSchema(
      platform: platform,
      declaredVersion: schemaVersion,
      roomVersion: platform == "ios" && schemaVersion == 1 ? 22 : schemaVersion
    )
  }

  private static func validateDatabase(_ url: URL, manifest: BackupSchema) throws -> BackupSchema {
    let queue = try DatabaseQueue(path: url.path)
    let validation = try queue.read { db -> (Bool, Int, [String]) in
      let result = try String.fetchOne(db, sql: "PRAGMA integrity_check")
      let version = try Int.fetchOne(db, sql: "PRAGMA user_version") ?? 0
      let applied = try db.tableExists("grdb_migrations")
        ? String.fetchAll(db, sql: "SELECT identifier FROM grdb_migrations") : []
      return (result == "ok", version, applied)
    }
    guard validation.0 else { throw BackupError.invalidBackup("Backup database integrity check failed") }
    guard validation.1 == manifest.declaredVersion || (validation.1 == 0 && !validation.2.isEmpty && manifest.platform == "ios") else {
      throw BackupError.invalidBackup(
        "Backup manifest schema version \(manifest.declaredVersion) does not match database schema version \(validation.1)"
      )
    }
    guard manifest.platform == "ios", validation.1 == 0 else { return manifest }
    let registered = VescapeDatabase.migrator.migrations
    guard let last = registered.lastIndex(where: { validation.2.contains($0) }) else {
      throw BackupError.invalidBackup("Invalid iOS migration ledger")
    }
    let expectedPrefix = Set(registered[...last])
    guard Set(validation.2) == expectedPrefix else {
      throw BackupError.invalidBackup("iOS migration ledger is not a valid production prefix")
    }
    let identifier = registered[last]
    let effective = Int(identifier.dropFirst().prefix(while: \.isNumber)) ?? 1
    guard manifest.declaredVersion == 1 || manifest.declaredVersion == effective else {
      throw BackupError.invalidBackup(
        "Backup manifest schema version \(manifest.declaredVersion) does not match migration ledger \(identifier)"
      )
    }
    return BackupSchema(
      platform: manifest.platform,
      declaredVersion: manifest.declaredVersion,
      roomVersion: effective <= 2 ? 22 : effective
    )
  }

  private static func manifest(dbSizeBytes: Int64, sourceURL: URL) throws -> Data {
    try DatabaseBackupArchive.manifest(
      platform: "ios",
      schemaVersion: VESCAPE_DATABASE_VERSION,
      appVersion: appVersion(),
      dbSizeBytes: dbSizeBytes,
      createdAt: Int64(Date().timeIntervalSince1970 * 1000.0)
    )
  }

  private static func appVersion() -> String {
    (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "unknown"
  }

  private static func utcStamp() -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd_HHmmss"
    return formatter.string(from: Date())
  }
}
