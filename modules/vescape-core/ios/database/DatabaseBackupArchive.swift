import Foundation

internal let backupManifestEntry = "manifest.json"
internal let backupDatabaseEntry = "db.sqlite"

/// Production backup container codec, independent of the iOS file-picker and live database pool.
enum DatabaseBackupArchive {
  static func manifest(
    platform: String,
    schemaVersion: Int,
    appVersion: String,
    dbSizeBytes: Int64,
    createdAt: Int64
  ) throws -> Data {
    try JSONSerialization.data(withJSONObject: [
      "format": "vesc-db-backup",
      "createdAt": createdAt,
      "schemaVersion": schemaVersion,
      "appVersion": appVersion,
      "platform": platform,
      "dbSizeBytes": dbSizeBytes,
    ], options: [.sortedKeys])
  }

  static func archive(database: Data, manifest: Data, sounds: [String: Data] = [:]) -> Data {
    ZipArchive.archive(entries: [
      .init(name: backupManifestEntry, data: manifest),
      .init(name: backupDatabaseEntry, data: database),
    ] + sounds.map { .init(name: "custom-app-sounds/\($0.key)", data: $0.value) })
  }

  static func extract(_ archive: Data) throws -> (manifest: Data, database: Data, sounds: [String: Data]) {
    let entries = try ZipArchive.entries(from: archive)
    guard let manifest = entries[backupManifestEntry] else {
      throw DatabaseBackupManager.BackupError.invalidBackup("Backup missing \(backupManifestEntry)")
    }
    guard let database = entries[backupDatabaseEntry], !database.isEmpty else {
      throw DatabaseBackupManager.BackupError.invalidBackup("Backup missing \(backupDatabaseEntry)")
    }
    let sounds = entries.filter { $0.key.hasPrefix("custom-app-sounds/") }.reduce(into: [String: Data]()) { result, entry in
      result[String(entry.key.dropFirst("custom-app-sounds/".count))] = entry.value
    }
    return (manifest, database, sounds)
  }
}
