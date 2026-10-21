import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/BatterySocEstimatorTest.kt
final class BatterySocEstimatorTests: XCTestCase {
  private var estimator = BatterySocEstimator()

  override func setUpWithError() throws {
    estimator = BatterySocEstimator()
    // Load the canonical curves straight from the shared source (single source of truth), located
    // relative to this test file so no resource bundling is needed for the pure unit under test.
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent() // telemetry
      .deletingLastPathComponent() // ios
      .deletingLastPathComponent() // vescape-core
      .deletingLastPathComponent() // modules
      .deletingLastPathComponent() // repo root
    let json = try String(
      contentsOf: root.appendingPathComponent("shared/data/cell-presets.json"),
      encoding: .utf8
    )
    estimator.loadPresets(json)
  }

  func testPresetConfigEstimatesSocFromPerCellCurve() {
    let config: [String: Any] = [
      "mode": "preset", "cellPresetId": "molicel:21700:p50b", "seriesCount": 20, "parallelCount": 2,
    ]
    // 84V = 4.2V/cell = 100%, 50V = 2.5V/cell = 0%, 76V = 3.8V/cell ≈ 55%
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 84.0, config: config)!, 100.0, accuracy: 0.0)
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 50.0, config: config)!, 0.0, accuracy: 0.0)
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 76.0, config: config)!, 55.0, accuracy: 3.0)
  }

  func testManualConfigEstimatesSoc() {
    let config: [String: Any] = ["mode": "manual", "minVoltage": 60.0, "maxVoltage": 84.0]
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 84.0, config: config)!, 100.0, accuracy: 0.0)
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 60.0, config: config)!, 0.0, accuracy: 0.0)
  }

  func testReturnsNilForMissingOrUnknownPresetConfigs() {
    XCTAssertNil(estimator.estimateBatteryPercent(voltageV: 72.0, config: nil))
    XCTAssertNil(estimator.estimateBatteryPercent(
      voltageV: 72.0,
      config: ["mode": "preset", "cellPresetId": "missing", "seriesCount": 20, "parallelCount": 2]
    ))
  }

  func testFailedBundleLoadIsAttemptedOnlyOnce() {
    var attempts = 0
    let unloaded = BatterySocEstimator(presetLoader: { attempts += 1; return nil })

    unloaded.ensureLoaded()
    unloaded.ensureLoaded()

    XCTAssertEqual(attempts, 1)
    XCTAssertFalse(unloaded.isLoaded)
  }

  func testReturnsNilForInvalidManualConfig() {
    XCTAssertNil(estimator.estimateBatteryPercent(
      voltageV: 72.0,
      config: ["mode": "manual", "minVoltage": 84.0, "maxVoltage": 60.0]
    ))
  }

  func testClampsTo100WhenVoltageAboveMax() {
    let config: [String: Any] = ["mode": "manual", "minVoltage": 60.0, "maxVoltage": 84.0]
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 90.0, config: config)!, 100.0, accuracy: 0.0)
  }

  func testClampsTo0WhenVoltageBelowMin() {
    let config: [String: Any] = ["mode": "manual", "minVoltage": 60.0, "maxVoltage": 84.0]
    XCTAssertEqual(estimator.estimateBatteryPercent(voltageV: 50.0, config: config)!, 0.0, accuracy: 0.0)
  }

  func testReturnsNilForEmptyConfig() {
    XCTAssertNil(estimator.estimateBatteryPercent(voltageV: 72.0, config: [:]))
  }

  func testManualInterpolationReturnsMidRangeValue() {
    let config: [String: Any] = ["mode": "manual", "minVoltage": 50.0, "maxVoltage": 100.0]
    let mid = estimator.estimateBatteryPercent(voltageV: 75.0, config: config)
    XCTAssertNotNil(mid)
    XCTAssertTrue(mid! > 0.0 && mid! < 100.0)
  }

  func testReturnsNilForUnknownCellPreset() {
    XCTAssertNil(estimator.getCellPreset("unknown:cell:id"))
  }

  // MARK: IR compensation

  func testPresetIrCompensationBoostsSocUnderLoad() {
    let config: [String: Any] = [
      "mode": "preset", "cellPresetId": "molicel:21700:p50b", "seriesCount": 20, "parallelCount": 2,
    ]
    let noLoad = estimator.estimateBatteryPercent(voltageV: 72.0, config: config, batteryCurrentA: 0.0)!
    let withLoad = estimator.estimateBatteryPercent(voltageV: 72.0, config: config, batteryCurrentA: 30.0)!
    XCTAssertTrue(withLoad > noLoad, "IR compensation should increase SoC under load")
  }

  func testZeroCurrentSameAsDefault() {
    let config: [String: Any] = [
      "mode": "preset", "cellPresetId": "molicel:21700:p50b", "seriesCount": 20, "parallelCount": 2,
    ]
    let withDefault = estimator.estimateBatteryPercent(voltageV: 76.0, config: config)!
    let withZero = estimator.estimateBatteryPercent(voltageV: 76.0, config: config, batteryCurrentA: 0.0)!
    XCTAssertEqual(withDefault, withZero, accuracy: 0.001)
  }

  func testManualIrCompensationUsesFallbackResistance() {
    let config: [String: Any] = ["mode": "manual", "minVoltage": 60.0, "maxVoltage": 84.0]
    let noLoad = estimator.estimateBatteryPercent(voltageV: 70.0, config: config, batteryCurrentA: 0.0)!
    let withLoad = estimator.estimateBatteryPercent(voltageV: 70.0, config: config, batteryCurrentA: 20.0)!
    XCTAssertTrue(withLoad > noLoad, "Manual mode IR compensation should increase SoC under load")
  }

  func testMissingConfigReturnsNilEvenWithCurrent() {
    XCTAssertNil(estimator.estimateBatteryPercent(voltageV: 72.0, config: nil, batteryCurrentA: 30.0))
  }
}
