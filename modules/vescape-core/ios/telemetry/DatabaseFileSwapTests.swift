import Foundation
import GRDB
import XCTest
import Darwin
@testable import VescapeCore

final class DatabaseFileSwapTests: XCTestCase {
  func testFailedInstallRestoresDatabaseAndSidecarsByteForByte() throws {
    let fm = FileManager.default
    let directory = fm.temporaryDirectory.appendingPathComponent("vescape-swap-\(UUID().uuidString)")
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: directory) }
    let target = directory.appendingPathComponent("vescape.db")
    let incoming = directory.appendingPathComponent("incoming.db")
    try Data("current".utf8).write(to: target)
    try Data("wal".utf8).write(to: URL(fileURLWithPath: target.path + "-wal"))
    try Data("shm".utf8).write(to: URL(fileURLWithPath: target.path + "-shm"))
    try Data("invalid".utf8).write(to: incoming)

    XCTAssertThrowsError(try replacingDatabaseFiles(source: incoming, target: target) { _ in
      throw CocoaError(.fileReadCorruptFile)
    } as Void)
    XCTAssertEqual(try Data(contentsOf: target), Data("current".utf8))
    XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: target.path + "-wal")), Data("wal".utf8))
    XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: target.path + "-shm")), Data("shm".utf8))
  }

  func testFailureAfterOpeningValidCandidateLeavesOriginalDatabaseReadable() throws {
    let fm = FileManager.default
    let directory = fm.temporaryDirectory.appendingPathComponent("vescape-db-swap-\(UUID().uuidString)")
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: directory) }
    let target = directory.appendingPathComponent("vescape.db")
    let incoming = directory.appendingPathComponent("incoming.db")
    for (url, value) in [(target, "original"), (incoming, "candidate")] {
      let queue = try DatabaseQueue(path: url.path)
      try TelemetryDatabase.migrator.migrate(queue)
      try queue.write { db in
        try db.execute(
          sql: "INSERT INTO app_settings (key, value_json, updated_at) VALUES ('sentinel', ?, 1)",
          arguments: [value]
        )
      }
      try queue.close()
    }

    XCTAssertThrowsError(try replacingDatabaseFiles(source: incoming, target: target) { installed in
      let candidate = try DatabaseQueue(path: installed.path)
      let value = try candidate.read { db in try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key = 'sentinel'") }
      XCTAssertEqual(value, "candidate")
      try candidate.close()
      throw CocoaError(.fileReadCorruptFile)
    } as Void)

    let restored = try DatabaseQueue(path: target.path)
    let value = try restored.read { db in try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key = 'sentinel'") }
    XCTAssertEqual(value, "original")
    try restored.close()
  }

  func testIncompleteRollbackPreservesRecoveryArtifactsAndBothErrors() throws {
    let fm = FileManager.default
    let directory = fm.temporaryDirectory.appendingPathComponent("vescape-rollback-failure-\(UUID().uuidString)")
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: directory) }
    let target = directory.appendingPathComponent("vescape.db")
    let incoming = directory.appendingPathComponent("incoming.db")
    try Data("original".utf8).write(to: target)
    try Data("candidate".utf8).write(to: incoming)

    XCTAssertThrowsError(try replacingDatabaseFiles(source: incoming, target: target) { installed in
      let rollback = try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        .first { $0.lastPathComponent.hasPrefix("vescape.db.rollback-") }!
      XCTAssertEqual(chmod(rollback.path, 0), 0)
      throw CocoaError(.fileReadCorruptFile)
    } as Void) { error in
      let nsError = error as NSError
      XCTAssertTrue(nsError.localizedDescription.contains("rollback was incomplete"))
      XCTAssertNotNil(nsError.userInfo[NSUnderlyingErrorKey])
      XCTAssertFalse((nsError.userInfo["rollbackErrors"] as? String ?? "").isEmpty)
    }
    let rollbackDirectories = try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("vescape.db.rollback-") }
    XCTAssertEqual(rollbackDirectories.count, 1)
    XCTAssertEqual(chmod(rollbackDirectories[0].path, S_IRWXU), 0)
    XCTAssertEqual(
      try Data(contentsOf: rollbackDirectories[0].appendingPathComponent("vescape.db")),
      Data("original".utf8)
    )
  }
}
