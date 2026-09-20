import XCTest
@testable import VescapeCore

/// The merge is the whole point: watchOS has one Application Context for every channel, so a
/// settings push that replaced the dictionary would delete the route.
final class WatchColdStateTests: XCTestCase {
  private final class Wire {
    var context: [String: Any] = [:]
    var writes = 0
    var failWith: Error?
    var events: [String] = []

    func coldState() -> WatchColdState {
      WatchColdState(
        context: { self.context },
        write: { merged in
          if let failure = self.failWith { throw failure }
          self.writes += 1
          self.context = merged
        },
        record: { name, _ in self.events.append(name) }
      )
    }
  }

  func testOfflinePreferenceChangesFlushLatestUnitsOnReconnectAndSurviveRestart() {
    let wire = Wire()
    let state = wire.coldState()
    wire.failWith = WatchColdStateError.sessionNotActivated
    state.put(channel: watchSettingsChannel, payload: WatchSettings(unitSystem: "metric").payload)
    state.put(channel: watchSettingsChannel, payload: WatchSettings(unitSystem: "imperial").payload)
    XCTAssertEqual(wire.writes, 0)
    wire.failWith = nil
    state.flush()
    XCTAssertEqual(WatchSettings.decode(context: wire.context).unitSystem, "imperial")
    let restarted = wire.coldState()
    restarted.put(channel: watchSettingsChannel, payload: WatchSettings(unitSystem: "imperial").payload)
    XCTAssertEqual(wire.writes, 1)
    XCTAssertEqual(WatchSettings.decode(context: wire.context).unitSystem, "imperial")
  }

  func testWritingOneChannelPreservesTheOthersAndUnrelatedKeys() {
    let wire = Wire()
    wire.context = ["route": ["points": 3], "schemaVersion": 1]
    wire.coldState().put(channel: watchSettingsChannel, payload: ["navArrowEnabled": true])

    XCTAssertEqual((wire.context["route"] as? [String: Any])?["points"] as? Int, 3)
    XCTAssertEqual(wire.context["schemaVersion"] as? Int, 1)
    XCTAssertEqual((wire.context[watchSettingsChannel] as? [String: Any])?["navArrowEnabled"] as? Bool, true)
  }

  func testAnUnchangedPayloadIsNotWorthARoundTrip() {
    let wire = Wire()
    let coldState = wire.coldState()
    coldState.put(channel: watchSettingsChannel, payload: ["navArrowEnabled": true])
    coldState.put(channel: watchSettingsChannel, payload: ["navArrowEnabled": true])
    XCTAssertEqual(wire.writes, 1)
  }

  func testAChangedPayloadReplacesTheChannelWholesale() {
    let wire = Wire()
    let coldState = wire.coldState()
    coldState.put(channel: watchSettingsChannel, payload: ["riderColor": "#FF0000", "navArrowEnabled": true])
    coldState.put(channel: watchSettingsChannel, payload: ["riderColor": "", "navArrowEnabled": false])
    XCTAssertEqual(wire.writes, 2)
    let settings = wire.context[watchSettingsChannel] as? [String: Any]
    XCTAssertEqual(settings?["riderColor"] as? String, "")
    XCTAssertEqual(settings?["navArrowEnabled"] as? Bool, false)
  }

  func testAFailedWriteIsRecordedAndRetriedByTheNextFlush() {
    let wire = Wire()
    let coldState = wire.coldState()
    wire.failWith = WatchColdStateError.sessionNotActivated
    coldState.put(channel: watchSettingsChannel, payload: ["navArrowEnabled": true])
    XCTAssertEqual(wire.writes, 0)
    XCTAssertEqual(wire.events, ["watch_cold_state_push_failed"])

    wire.failWith = nil
    coldState.flush()
    XCTAssertEqual(wire.writes, 1)
    XCTAssertEqual((wire.context[watchSettingsChannel] as? [String: Any])?["navArrowEnabled"] as? Bool, true)
  }

  func testFlushIsANoOpOnceTheWristHoldsEveryChannel() {
    let wire = Wire()
    let coldState = wire.coldState()
    coldState.put(channel: watchSettingsChannel, payload: ["navArrowEnabled": true])
    coldState.flush()
    XCTAssertEqual(wire.writes, 1)
  }
}
