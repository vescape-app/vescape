import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchLightsRelayTest.kt
final class WatchBoardTests: XCTestCase {
  func testRoundTripsBothSwitchesAndTheWriteGate() {
    let state = WatchBoardLights(lightsEnabled: true, headlightsEnabled: false, lightsControllable: true)
    XCTAssertEqual(WatchBoardLights.decode(state.payload), state)
  }

  func testUnknownSwitchesAreOmittedRatherThanSentAsFalse() {
    let payload = WatchBoardLights(lightsControllable: true).payload
    XCTAssertNil(payload[watchBoardLightsEnabledKey])
    XCTAssertNil(payload[watchBoardHeadlightsEnabledKey])
    let decoded = WatchBoardLights.decode(payload)
    XCTAssertNil(decoded.lightsEnabled)
    XCTAssertNil(decoded.headlightsEnabled)
    XCTAssertFalse(decoded.known)
    XCTAssertTrue(decoded.lightsControllable)
  }

  func testAnAbsentOrUnreadableChannelIsUnknownAndNotControllable() {
    for decoded in [
      WatchBoardLights.decode(context: [:]),
      WatchBoardLights.decode(context: [watchBoardChannel: "not a bag"]),
      WatchBoardLights.decode([:]),
    ] {
      XCTAssertNil(decoded.lightsEnabled)
      XCTAssertNil(decoded.headlightsEnabled)
      XCTAssertFalse(decoded.lightsControllable)
    }
  }

  func testReadsItsOwnChannelOutOfAMergedContext() {
    let context: [String: Any] = [
      watchSettingsChannel: ["navArrowEnabled": true],
      watchBoardChannel: WatchBoardLights(
        lightsEnabled: false,
        headlightsEnabled: true,
        lightsControllable: true
      ).payload,
    ]
    let decoded = WatchBoardLights.decode(context: context)
    XCTAssertEqual(decoded.lightsEnabled, false)
    XCTAssertEqual(decoded.headlightsEnabled, true)
    XCTAssertTrue(decoded.known)
  }

  private final class Harness {
    var current: BoardLightsState? = BoardLightsState(enabled: false, headlightsEnabled: false)
    var writes: [(Bool, Bool)] = []
    var accept = true
    var events: [String] = []

    func relay() -> WatchLightsRelay {
      WatchLightsRelay(
        currentLights: { self.current },
        setLights: { enabled, headlights in
          self.writes.append((enabled, headlights))
          return self.accept
        },
        record: { name, _ in self.events.append(name) }
      )
    }
  }

  private func assertWrites(_ writes: [(Bool, Bool)], _ expected: [(Bool, Bool)]) {
    XCTAssertEqual(writes.map { [$0.0, $0.1] }, expected.map { [$0.0, $0.1] })
  }

  func testAnEditKeepsTheOtherSwitchAtThePhonesOwnValue() {
    let harness = Harness()
    harness.current = BoardLightsState(enabled: false, headlightsEnabled: true)
    harness.relay().accept(.leds, on: true)
    assertWrites(harness.writes, [(true, true)])

    harness.current = BoardLightsState(enabled: true, headlightsEnabled: true)
    harness.relay().accept(.headlight, on: false)
    assertWrites(harness.writes, [(true, true), (true, false)])
  }

  func testAnEditWithNoKnownLightsIsDropped() {
    let harness = Harness()
    harness.current = nil
    harness.relay().accept(.leds, on: true)
    XCTAssertTrue(harness.writes.isEmpty)
    XCTAssertEqual(harness.events, ["watch_lights_dropped"])
  }

  func testASecondEditBeforeTheEchoKeepsTheFirst() {
    let harness = Harness()
    let relay = harness.relay()
    relay.accept(.leds, on: true)
    relay.accept(.headlight, on: true)
    assertWrites(harness.writes, [(true, false), (true, true)])
  }

  func testAPhoneSideChangeReplacesThePendingPair() {
    let harness = Harness()
    let relay = harness.relay()
    relay.accept(.leds, on: true)
    harness.current = BoardLightsState(enabled: false, headlightsEnabled: true)
    relay.accept(.leds, on: true)
    assertWrites(harness.writes, [(true, false), (true, true)])
  }

  func testARefusedWriteLeavesNoPendingPair() {
    let harness = Harness()
    harness.accept = false
    let relay = harness.relay()
    relay.accept(.leds, on: true)
    relay.accept(.headlight, on: true)
    assertWrites(harness.writes, [(true, false), (false, true)])
  }

  func testLightsCommandCarriesOneSwitchAndItsTargetState() {
    for `switch` in [WatchLightsSwitch.leds, .headlight] {
      for on in [true, false] {
        let encoded = WatchCommandCodec.encode(.lights(`switch`, on))
        XCTAssertEqual(encoded.count, 2)
        XCTAssertEqual(encoded[0], WatchCommandKind.lights)
        XCTAssertEqual(WatchCommandCodec.decode(encoded), .lights(`switch`, on))
      }
    }
  }

  func testLightsWireValuesMatchAndroid() {
    XCTAssertEqual(WatchCommandKind.lights, 3)
    XCTAssertEqual(WatchLightsSwitch.leds.rawValue, 0)
    XCTAssertEqual(WatchLightsSwitch.headlight.rawValue, 1)
    XCTAssertEqual(Array(WatchCommandCodec.encode(.lights(.leds, true))), [3, 0b01])
    XCTAssertEqual(Array(WatchCommandCodec.encode(.lights(.headlight, false))), [3, 0b10])
  }

  func testLightsValuesAboveTheDefinedBitsAreIgnored() {
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.lights, 0b100])))
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.lights])))
  }

  func testMoveDecodesOnItsOwnKind() {
    XCTAssertEqual(WatchCommandCodec.decode(Data([WatchCommandKind.move, 1])), .move(1))
  }
}
