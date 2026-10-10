import XCTest
import GRDB
@testable import VescapeCore

/// App Settings contract: the dismissed Community Message IDs default empty, keep non-empty unique
/// strings, and reject malformed values.
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/AppSettingsMapPreferencesTest.kt
final class AppDataRepositorySettingsTests: XCTestCase {
  func testInvalidRequiredJsonPreservesExistingSetting() throws {
    let queue = try DatabaseQueue()
    try queue.write { db in
      try db.execute(sql: "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)")
      try db.execute(sql: "INSERT INTO app_settings VALUES ('custom', '\"old\"', 1)")
    }
    let repository = AppDataRepository.forTesting(dbWriter: queue)

    XCTAssertThrowsError(try repository.updateSetting("custom", rawValue: Double.nan))
    let stored = try queue.read { db in
      try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key = 'custom'")
    }
    XCTAssertEqual(stored, "\"old\"")
  }
  func testDismissedCommunityMessageIdsDefaultEmpty() {
    XCTAssertEqual(AppDataRepository.defaultSettings["dismissedCommunityMessageIds"] as? [String], [])
  }

  func testThemeModeAcceptsSupportedModesOnly() {
    XCTAssertEqual(AppDataRepository.themeMode("system"), "system")
    XCTAssertEqual(AppDataRepository.themeMode("light"), "light")
    XCTAssertEqual(AppDataRepository.themeMode("dark"), "dark")
    XCTAssertEqual(AppDataRepository.themeMode("sun"), "sun")
    XCTAssertNil(AppDataRepository.themeMode("automatic"))
    XCTAssertNil(AppDataRepository.themeMode(false))
  }

  func testDismissedCommunityMessageIdsKeepsNonEmptyStringsAndDedupes() {
    XCTAssertEqual(AppDataRepository.dismissedCommunityMessageIds(["a", "b", "a"]), ["a", "b"])
    XCTAssertEqual(AppDataRepository.dismissedCommunityMessageIds(["a", "", 3, NSNull()]), ["a"])
  }

  func testDismissedCommunityMessageIdsNormalizesEmptyAndRejectsNonLists() {
    // An empty or all-invalid array normalizes to [] (never treated as corrupt).
    XCTAssertEqual(AppDataRepository.dismissedCommunityMessageIds([Any]()), [])
    XCTAssertEqual(AppDataRepository.dismissedCommunityMessageIds(["", 1]), [])
    // A non-array is malformed input and falls back to the default via normalizeSettings.
    XCTAssertNil(AppDataRepository.dismissedCommunityMessageIds("a"))
    let normalized = AppDataRepository.normalizeSettings(["dismissedCommunityMessageIds": "a"])
    XCTAssertEqual(normalized["dismissedCommunityMessageIds"] as? [String], [])
  }
}
