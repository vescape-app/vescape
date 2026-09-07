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

  static func archive(database: Data, manifest: Data) -> Data {
    ZipArchive.archive(entries: [
      .init(name: backupManifestEntry, data: manifest),
      .init(name: backupDatabaseEntry, data: database),
    ])
  }

  static func extract(_ archive: Data) throws -> (manifest: Data, database: Data) {
    let entries = try ZipArchive.entries(from: archive)
    guard let manifest = entries[backupManifestEntry] else {
      throw DatabaseBackupManager.BackupError.invalidBackup("Backup missing \(backupManifestEntry)")
    }
    guard let database = entries[backupDatabaseEntry], !database.isEmpty else {
      throw DatabaseBackupManager.BackupError.invalidBackup("Backup missing \(backupDatabaseEntry)")
    }
    return (manifest, database)
  }
}
