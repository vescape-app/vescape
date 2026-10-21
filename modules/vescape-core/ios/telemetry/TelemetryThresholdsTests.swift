import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/TelemetryThresholdsTest.kt
final class TelemetryThresholdsTests: XCTestCase {
  func testBatteryIsFlaggedStrictlyBelow30And10Percent() {
    XCTAssertEqual(TelemetryThresholds.batteryLevel(0.3), .normal)
    XCTAssertEqual(TelemetryThresholds.batteryLevel(0.2999), .warning)
    XCTAssertEqual(TelemetryThresholds.batteryLevel(0.1), .warning)
    XCTAssertEqual(TelemetryThresholds.batteryLevel(0.0999), .critical)
    XCTAssertEqual(TelemetryThresholds.batteryLevel(nil), .normal)
  }

  func testTemperatureIsFlaggedStrictlyAbove70And80Degrees() {
    XCTAssertEqual(TelemetryThresholds.tempLevel(70), .normal)
    XCTAssertEqual(TelemetryThresholds.tempLevel(70.01), .warning)
    XCTAssertEqual(TelemetryThresholds.tempLevel(80), .warning)
    XCTAssertEqual(TelemetryThresholds.tempLevel(80.01), .critical)
    XCTAssertEqual(TelemetryThresholds.tempLevel(nil), .normal)
  }

  func testHeatIsTheWorseOfMotorAndController() {
    XCTAssertEqual(TelemetryThresholds.heatLevel(motorTempC: 85, ctrlTempC: 75), .critical)
    XCTAssertEqual(TelemetryThresholds.heatLevel(motorTempC: 40, ctrlTempC: 75), .warning)
    XCTAssertEqual(TelemetryThresholds.heatLevel(motorTempC: 75, ctrlTempC: nil), .warning)
    XCTAssertEqual(TelemetryThresholds.heatLevel(motorTempC: nil, ctrlTempC: nil), .normal)
  }
}
