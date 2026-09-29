import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/TelemetryLevelTest.kt
final class TelemetryLevelTests: XCTestCase {
  func testAnUnknownWireLevelReadsAsNormal() {
    for level in [TelemetryLevel.normal, .warning, .critical] {
      XCTAssertEqual(TelemetryLevel(wire: level.rawValue), level)
    }
    XCTAssertEqual(TelemetryLevel(wire: 9), .normal)
  }
}
