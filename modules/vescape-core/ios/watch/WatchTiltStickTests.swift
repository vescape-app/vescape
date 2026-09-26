import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/test/java/app/vescape/wear/TiltStickTest.kt
final class WatchTiltStickTests: XCTestCase {
  private func rate(_ deflection: Double, ratePercent: Int = 10) -> Double {
    WatchTiltStick.ratePercentPerSecond(deflection: deflection, deadzone: 8, full: 60, ratePercent: ratePercent)
  }

  func testARestingThumbInsideTheDeadzoneChangesNothing() {
    XCTAssertEqual(rate(8), 0)
    XCTAssertEqual(rate(-5), 0)
  }

  func testRateRisesWithTheSquareOfDeflectionAndCapsAtTheRidersRate() {
    // Halfway between the deadzone and full deflection is a quarter of the rate.
    XCTAssertEqual(rate(34), 2.5, accuracy: 1e-9)
    XCTAssertEqual(rate(60), 10, accuracy: 1e-9)
    XCTAssertEqual(rate(500), 10, accuracy: 1e-9)
    XCTAssertEqual(rate(-90, ratePercent: 40), -40, accuracy: 1e-9)
  }

  func testIntegrationFollowsElapsedTimeAndStopsAtFullTilt() {
    XCTAssertEqual(WatchTiltStick.integrate(percent: 0, ratePercentPerSecond: 10, elapsedMs: 50), 0.5, accuracy: 1e-9)
    XCTAssertEqual(WatchTiltStick.integrate(percent: 99.5, ratePercentPerSecond: 40, elapsedMs: 50), 100)
    XCTAssertEqual(WatchTiltStick.integrate(percent: -99.5, ratePercentPerSecond: -40, elapsedMs: 50), -100)
    // A stalled clock cannot jump the tilt.
    XCTAssertEqual(WatchTiltStick.integrate(percent: 0, ratePercentPerSecond: 40, elapsedMs: 5_000), 2, accuracy: 1e-9)
    XCTAssertEqual(WatchTiltStick.integrate(percent: 10, ratePercentPerSecond: 40, elapsedMs: -16), 10)
  }

  func testPercentMapsOntoThePhonePadsWireScaleAroundNeutral() {
    XCTAssertEqual(WatchTiltStick.value(percent: 0), WatchTiltStick.center)
    XCTAssertEqual(WatchTiltStick.value(percent: 100), 255)
    XCTAssertEqual(WatchTiltStick.value(percent: 150), 255)
    XCTAssertEqual(WatchTiltStick.value(percent: -100), 1)
    XCTAssertEqual(WatchTiltStick.percent(value: 255), 100, accuracy: 1e-9)
    XCTAssertEqual(WatchTiltStick.percent(value: WatchTiltStick.center), 0)
    for value in 1...255 {
      XCTAssertEqual(WatchTiltStick.value(percent: WatchTiltStick.percent(value: value)), value)
    }
  }

  func testReadoutIsASignedWholePercent() {
    XCTAssertEqual(WatchTiltStick.format(12.4), "+12%")
    XCTAssertEqual(WatchTiltStick.format(-0.3), "0%")
    XCTAssertEqual(WatchTiltStick.format(-4), "-4%")
  }

  /// The phone and the wrist are one binary's worth of constants apart; neutral must not drift.
  func testNeutralIsTheBoardProtocolsNeutral() {
    XCTAssertEqual(WatchTiltStick.center, REMOTE_TILT_CENTER)
  }
}
