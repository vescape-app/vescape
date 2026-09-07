import Foundation
import GRDB
import XCTest
@testable import VescapeCore

final class DatabaseBackupArchiveTests: XCTestCase {
  private func archive(platform: String, database: Data, version: Int = 42) throws -> Data {
    let manifest = try JSONSerialization.data(withJSONObject: [
      "format": "vesc-db-backup",
      "platform": platform,
      "schemaVersion": version,
    ])
    return ZipArchive.archive(entries: [
      .init(name: "manifest.json", data: manifest),
      .init(name: "db.sqlite", data: database),
    ])
  }

  func testCurrentIOSArchiveStagesAndOpens() throws {
    for platform in ["ios"] {
      let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("vescape-archive-\(platform)-\(UUID().uuidString)", isDirectory: true)
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: root) }
      let source = root.appendingPathComponent("source.sqlite")
      let queue = try DatabaseQueue(path: source.path)
      try TelemetryDatabase.migrator.migrate(queue)
      try queue.write { db in
        try db.execute(sql: "INSERT INTO app_settings VALUES ('archive-sentinel', '\"\(platform)\"', 1)")
        try db.execute(sql: "PRAGMA user_version = 42")
      }
      try queue.close()

      let zip = try archive(platform: platform, database: Data(contentsOf: source))
      let stageDir = root.appendingPathComponent("stage", isDirectory: true)
      try FileManager.default.createDirectory(at: stageDir, withIntermediateDirectories: true)
      let staged = try DatabaseBackupManager.stageBackupArchive(zip, in: stageDir)
      XCTAssertEqual(staged.roomVersion, 42)
      let restored = try TelemetryDatabase.openRestoredDatabase(at: staged.database, schemaVersion: staged.roomVersion)
      XCTAssertEqual(
        try restored.read { db in try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key='archive-sentinel'") },
        "\"\(platform)\""
      )
      try restored.close()
    }
  }

  func testManifestDatabaseMismatchFailsBeforeInstallation() throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("vescape-invalid-archive-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("source.sqlite")
    let queue = try DatabaseQueue(path: source.path)
    try TelemetryDatabase.migrator.migrate(queue)
    try queue.write { db in try db.execute(sql: "PRAGMA user_version = 42") }
    try queue.close()
    XCTAssertThrowsError(
      try DatabaseBackupManager.stageBackupArchive(
        archive(platform: "android", database: Data(contentsOf: source), version: 41),
        in: root
      )
    )
  }
}
