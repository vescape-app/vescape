import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/LegacyLightsConfigGateTest.kt
final class LegacyLightsConfigGateTests: XCTestCase {
  func testRejectsConfigMutatingLightsWhileConfigWriteIsInFlight() {
    let gate = LegacyLightsConfigGate(scheduler: TestScheduler(), onEchoTimeout: {})

    XCTAssertFalse(gate.canSendLights(refloatBaseVersion: "1.2.1", configWriteInFlight: true))
    XCTAssertTrue(gate.canSendLights(refloatBaseVersion: "1.2.1", configWriteInFlight: false))
    XCTAssertTrue(gate.canSendLights(refloatBaseVersion: "1.2.2", configWriteInFlight: true))
    XCTAssertTrue(gate.canSendLights(refloatBaseVersion: "3.0.7", configWriteInFlight: true))
  }

  func testTracksPendingEchoAndDemotesWriteBaseOnTimeout() {
    let scheduler = TestScheduler()
    var timeouts = 0
    let gate = LegacyLightsConfigGate(scheduler: scheduler, onEchoTimeout: { timeouts += 1 })

    gate.onLightsCommandSent(refloatBaseVersion: "1.2.2")
    XCTAssertFalse(gate.isEchoPending)

    gate.onLightsCommandSent(refloatBaseVersion: "1.2.1")
    XCTAssertTrue(gate.isEchoPending)

    scheduler.advance(LIGHTS_CONFIG_ECHO_TIMEOUT_MS - 1)
    XCTAssertTrue(gate.isEchoPending)
    XCTAssertEqual(timeouts, 0)

    scheduler.advance(1)
    XCTAssertFalse(gate.isEchoPending)
    XCTAssertEqual(timeouts, 1)
  }

  func testEchoAndResetCancelPendingTimeout() {
    let scheduler = TestScheduler()
    var timeouts = 0
    let gate = LegacyLightsConfigGate(scheduler: scheduler, onEchoTimeout: { timeouts += 1 })

    gate.onLightsCommandSent(refloatBaseVersion: "1.2.1")
    XCTAssertTrue(gate.isEchoPending)
    gate.onLightsEchoReceived()
    XCTAssertFalse(gate.isEchoPending)
    scheduler.advance(LIGHTS_CONFIG_ECHO_TIMEOUT_MS * 2)
    XCTAssertEqual(timeouts, 0)

    gate.onLightsCommandSent(refloatBaseVersion: "1.2.1")
    XCTAssertTrue(gate.isEchoPending)
    gate.reset()
    XCTAssertFalse(gate.isEchoPending)
    scheduler.advance(LIGHTS_CONFIG_ECHO_TIMEOUT_MS * 2)
    XCTAssertEqual(timeouts, 0)
  }
}
