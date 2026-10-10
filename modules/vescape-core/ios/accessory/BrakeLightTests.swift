import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/BrakeLightTest.kt
final class BrakeLightTests: XCTestCase {
  func testForwardReverseAndConstantSpeed() {
    for direction in [1.0, -1.0] {
      let detector = BrakeLightDetector()
      for n in 0...10 {
        detector.sample(speedKmh: direction * 36, riding: true, at: Int64(n * 100), sensitivity: 50)
      }
      XCTAssertEqual(detector.mode, "riding")
      for n in 1...10 {
        detector.sample(
          speedKmh: direction * (36 - Double(n) * 0.72), riding: true, at: Int64(1000 + n * 100),
          sensitivity: 50)
      }
      XCTAssertEqual(detector.mode, "braking")
      for n in 1...8 {
        detector.sample(
          speedKmh: direction * (28.8 - Double(n) * 1.8), riding: true, at: Int64(2000 + n * 100),
          sensitivity: 50)
      }
      XCTAssertEqual(detector.mode, "hard_braking")
    }
  }
  func testGapsInvalidSpeedAndParkedClearHistory() {
    let detector = BrakeLightDetector()
    detector.sample(speedKmh: 36, riding: true, at: 0, sensitivity: 50)
    detector.sample(speedKmh: 0, riding: true, at: 1000, sensitivity: 50)
    XCTAssertNil(detector.mode)
    detector.sample(speedKmh: 0, riding: true, at: 1100, sensitivity: 50)
    XCTAssertEqual(detector.mode, "riding")
    detector.sample(speedKmh: .nan, riding: true, at: 1200, sensitivity: 50)
    XCTAssertNil(detector.mode)
    detector.sample(speedKmh: 0, riding: false, at: 1300, sensitivity: 50)
    XCTAssertEqual(detector.mode, "not_riding")
  }
  func testSensitivityAndPreviewRestore() {
    let gentle = BrakeLightDetector()
    let resistant = BrakeLightDetector()
    for n in 0...15 {
      gentle.sample(
        speedKmh: 36 - Double(n) * 0.36, riding: true, at: Int64(n * 100), sensitivity: 100)
      resistant.sample(
        speedKmh: 36 - Double(n) * 0.36, riding: true, at: Int64(n * 100), sensitivity: 1)
    }
    XCTAssertEqual(gentle.mode, "braking")
    XCTAssertEqual(resistant.mode, "riding")
    let controller = BrakeLightController()
    let key = BrakeLightController.Key(accessoryId: "a", capabilityId: "rear")
    controller.configure(key, .init(sensitivity: 50, parked: "glow"))
    XCTAssertTrue(controller.preview(key, mode: "hard_braking"))
    XCTAssertEqual(
      controller.command(key),
      .state(
        capabilityId: "rear", telemetry: "unavailable", mode: "hard_braking", parked: "glow",
        preview: true))
    controller.releasePreviews()
    XCTAssertEqual(
      controller.command(key),
      .state(
        capabilityId: "rear", telemetry: "unavailable", mode: nil, parked: "glow", preview: false))
    controller.sample(speed: 10, engaged: true, at: 100)
    XCTAssertFalse(controller.preview(key, mode: "braking"))
    controller.clear()
    XCTAssertEqual(
      controller.command(key),
      .state(
        capabilityId: "rear", telemetry: "unavailable", mode: nil, parked: "glow", preview: false))
  }
}
