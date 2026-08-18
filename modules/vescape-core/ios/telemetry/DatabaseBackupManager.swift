import Foundation
import GRDB

/// Schema generation stamped into backup manifests, and the ceiling a restore accepts. Shared with
/// Android: the migrators move together, and the number is what tells a restore which migrations
/// the incoming database already satisfies. It must match the newest migration in
/// `TelemetryDatabase.migrator`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt `TELEMETRY_DATABASE_VERSION`
internal let TELEMETRY_SCHEMA_VERSION = 33

private let MANIFEST_ENTRY = "manifest.json"
private let DATABASE_ENTRY = "db.sqlite"

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

    let dbData = try Data(contentsOf: sqliteExport)
    let manifestData = try manifest(dbSizeBytes: Int64(dbData.count), sourceURL: dbURL)
    let zipData = ZipArchive.archive(entries: [
      ZipArchive.Entry(name: MANIFEST_ENTRY, data: manifestData),
      ZipArchive.Entry(name: DATABASE_ENTRY, data: dbData),
    ])
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
    let entries = try ZipArchive.entries(from: zipData)

    guard let manifestData = entries[MANIFEST_ENTRY] else {
      throw BackupError.invalidBackup("Backup missing \(MANIFEST_ENTRY)")
    }
    guard let dbData = entries[DATABASE_ENTRY], !dbData.isEmpty else {
      throw BackupError.invalidBackup("Backup missing \(DATABASE_ENTRY)")
    }
    let schemaVersion = try validateManifest(manifestData)

    let workDir = fm.temporaryDirectory.appendingPathComponent("db-restore-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: workDir, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: workDir) }
    let restoredDb = workDir.appendingPathComponent("restored.sqlite")
    try dbData.write(to: restoredDb, options: .atomic)
    try validateDatabase(restoredDb)

    try TelemetryDatabase.replaceDatabase(withFileAt: restoredDb, schemaVersion: schemaVersion)
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
  private static func validateManifest(_ data: Data) throws -> Int {
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw BackupError.invalidBackup("Unreadable manifest") }
    guard (object["format"] as? String) == "vesc-db-backup" else {
      throw BackupError.invalidBackup("Unsupported backup format")
    }
    let schemaVersion = (object["schemaVersion"] as? NSNumber)?.intValue ?? -1
    guard (1...TELEMETRY_SCHEMA_VERSION).contains(schemaVersion) else {
      throw BackupError.invalidBackup(
        "Backup schema version \(schemaVersion) is newer than app schema \(TELEMETRY_SCHEMA_VERSION)"
      )
    }
    return schemaVersion
  }

  /// Integrity-check the incoming database before it replaces the live one.
  private static func validateDatabase(_ url: URL) throws {
    let queue = try DatabaseQueue(path: url.path)
    let ok = try queue.read { db -> Bool in
      let result = try String.fetchOne(db, sql: "PRAGMA integrity_check")
      return result == "ok"
    }
    guard ok else { throw BackupError.invalidBackup("Backup database integrity check failed") }
  }

  private static func manifest(dbSizeBytes: Int64, sourceURL: URL) throws -> Data {
    let manifest: [String: Any] = [
      "format": "vesc-db-backup",
      "createdAt": Int64(Date().timeIntervalSince1970 * 1000.0),
      "schemaVersion": TELEMETRY_SCHEMA_VERSION,
      "appVersion": appVersion(),
      "platform": "ios",
      "dbSizeBytes": dbSizeBytes,
    ]
    return try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
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
