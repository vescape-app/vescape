import Foundation
import GRDB

/// Schema generation stamped into backup manifests, and the ceiling a restore accepts. Shared with
/// Android: the migrators move together, and the number is what tells a restore which migrations
/// the incoming database already satisfies. It must match the newest migration in
/// `TelemetryDatabase.migrator`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `TELEMETRY_DATABASE_VERSION`
internal let TELEMETRY_SCHEMA_VERSION = 42

/// Released schema generations that have a complete production path to the current schema.
/// 37–39 never shipped as standalone migrations: Android deliberately jumps 36→40.
/// Android backup export first shipped with database version 14 (commit dc985d80). Room can
/// upgrade older on-device databases, but those generations could never have produced an archive.
internal let supportedAndroidDatabaseVersions: Set<Int> =
  Set(3...36).union(40...TELEMETRY_SCHEMA_VERSION)
internal let exportedAndroidDatabaseVersions: Set<Int> =
  Set(14...36).union(40...TELEMETRY_SCHEMA_VERSION)
internal let exportedIOSDatabaseVersions: Set<Int> =
  Set([1]).union(23...36).union(40...TELEMETRY_SCHEMA_VERSION)

/// Exports/imports the single GRDB database as a shareable `.zip` (manifest.json + db.sqlite),
/// matching the Android backup format so the JS layer (share sheet / document picker) is identical.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseBackupManager.kt
/// @platform-diff iOS returns a `file://` URL (Android returns a content URI) and hot-swaps the
/// GRDB pool in place; there is no Room `closeAndReset`, so `TelemetryDatabase.replaceDatabase`
/// closes and reopens the pool.
enum DatabaseBackupManager {
  /// `LocalizedError`, because the bridge rejects with `error.localizedDescription`: a bare `Error`
  /// enum reaches JS as "undefined reason", which is what a failing restore used to report.
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
    guard let pool = TelemetryDatabase.pool, let dbURL = TelemetryDatabase.databaseURL else {
      throw BackupError.databaseUnavailable
    }
    // Land every buffered sample before snapshotting so the export is complete.
    TelemetryRepository.shared.flushBlocking()

    let fm = FileManager.default
    let exportDir = fm.temporaryDirectory.appendingPathComponent("db-backups", isDirectory: true)
    try fm.createDirectory(at: exportDir, withIntermediateDirectories: true)
    let stamp = utcStamp()
    let sqliteExport = exportDir.appendingPathComponent("vescape-\(stamp).sqlite")
    let zipExport = exportDir.appendingPathComponent("vesc-db-backup-\(stamp).zip")
    try? fm.removeItem(at: sqliteExport)
    try? fm.removeItem(at: zipExport)

    // VACUUM INTO produces a clean, consistent single-file snapshot (no WAL sidecars).
    let escaped = sqliteExport.path.replacingOccurrences(of: "'", with: "''")
    try pool.writeWithoutTransaction { db in
      try db.execute(sql: "VACUUM INTO '\(escaped)'")
    }

    // GRDB tracks migrations in its ledger, while Room reads SQLite's user_version. Stamp the
    // exported copy so the same artifact can be opened and schema-validated by Android.
    let exportQueue = try DatabaseQueue(path: sqliteExport.path)
    try exportQueue.writeWithoutTransaction { db in
      try db.execute(sql: "PRAGMA user_version = \(TELEMETRY_SCHEMA_VERSION)")
    }
    try exportQueue.close()

    let dbData = try Data(contentsOf: sqliteExport)
    let manifestData = try manifest(dbSizeBytes: Int64(dbData.count), sourceURL: dbURL)
    let zipData = DatabaseBackupArchive.archive(database: dbData, manifest: manifestData)
    try zipData.write(to: zipExport, options: .atomic)
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
    defer { try? fm.removeItem(at: workDir) }
    let staged = try stageBackupArchive(zipData, in: workDir)

    TelemetryRepository.shared.beginDatabaseSwap()
    defer { TelemetryRepository.shared.endDatabaseSwap() }
    try TelemetryDatabase.replaceDatabase(withFileAt: staged.database, schemaVersion: staged.roomVersion)
  }

  /// Portable archive/manifest/database validation used by restore and host contracts.
  internal static func stageBackupArchive(_ zipData: Data, in workDir: URL) throws -> (database: URL, roomVersion: Int) {
    let (manifestData, dbData) = try DatabaseBackupArchive.extract(zipData)
    let schema = try validateManifest(manifestData)
    let restoredDb = workDir.appendingPathComponent("restored.sqlite")
    try dbData.write(to: restoredDb, options: .atomic)
    let validated = try validateDatabase(restoredDb, manifest: schema)
    return (restoredDb, validated.roomVersion)
  }

  // MARK: - Helpers

  private static func fileURL(from uriString: String) -> URL {
    if let url = URL(string: uriString), url.isFileURL { return url }
    return URL(fileURLWithPath: uriString)
  }

  /// Returns the backup's schema generation, which the restore needs to reconcile a foreign
  /// database against this app's migrations.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseBackupManager.kt
  private struct BackupSchema {
    let platform: String
    let declaredVersion: Int
    let roomVersion: Int
  }

  private static func validateManifest(_ data: Data) throws -> BackupSchema {
    guard
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
        "Backup schema version \(schemaVersion) has no supported migration path to app schema \(TELEMETRY_SCHEMA_VERSION)"
      )
    }
    // iOS v1 shipped alongside Android v22. Later public schema generations use Room's number.
    return BackupSchema(
      platform: platform,
      declaredVersion: schemaVersion,
      roomVersion: platform == "ios" && schemaVersion == 1 ? 22 : schemaVersion
    )
  }

  /// Integrity-check the incoming database before it replaces the live one.
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
    let registered = TelemetryDatabase.migrator.migrations
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
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
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
