import Foundation
import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/TelemetryDatabaseReliabilityTest.kt
final class TelemetryDatabaseReliabilityTests: XCTestCase {
  func testFailedLegacyMovePreservesOriginalFile() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let legacy = root.appendingPathComponent("telemetry.db")
    let target = root.appendingPathComponent("missing/vescape.sqlite")
    let original = Data("original".utf8)
    try original.write(to: legacy)

    XCTAssertThrowsError(try TelemetryDatabase.moveLegacyDatabaseFile(from: legacy, to: target))
    XCTAssertEqual(try Data(contentsOf: legacy), original)
    XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
  }

  func testDatabaseSizeDistinguishesMissingFileFromMetadataFailure() throws {
    let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    XCTAssertEqual(try TelemetryDatabase.databaseSizeBytes(at: missing), 0)
    let existing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data([1]).write(to: existing)
    defer { try? FileManager.default.removeItem(at: existing) }
    XCTAssertThrowsError(try TelemetryDatabase.databaseSizeBytes(at: existing) { _ in
      throw CocoaError(.fileReadUnknown)
    })
  }
}
