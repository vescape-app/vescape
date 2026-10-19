import XCTest
@testable import VescapeCore

final class WatchLastBatteryTests: XCTestCase {
  func testPayloadRoundTripUnknownClearAndInvalidReading() throws {
    let known = WatchLastBattery(boardId: "a", boardName: "GT Beast", percent: 78.5, at: 1_000)
    XCTAssertEqual(WatchLastBattery.decode(known.payload), known)
    XCTAssertEqual(known.text, "79%")
    let unknown = WatchLastBattery(boardId: "b", boardName: "New board", percent: nil, at: nil)
    XCTAssertEqual(WatchLastBattery.decode(unknown.payload), unknown)
    XCTAssertNil(unknown.payload["percent"])
    XCTAssertNil(WatchLastBattery.decode([:]))
    XCTAssertNil(WatchLastBattery.decode(["boardId": "a", "boardName": "A", "percent": Double.nan, "at": 1])?.percent)
    XCTAssertNoThrow(try PropertyListSerialization.data(fromPropertyList: unknown.payload, format: .binary, options: 0))
  }
  func testTimelineAdvancesAgeAtReadingBoundariesAfterPhoneStops() {
    let origin = Date(timeIntervalSince1970: 1000)
    let battery = WatchLastBattery(boardId: "a", boardName: "A", percent: 78, at: 1_000_000)
    let now = origin.addingTimeInterval(3599)
    XCTAssertNil(battery.age(now: now))
    let dates = battery.timelineDates(now: now)
    XCTAssertEqual(dates[1], origin.addingTimeInterval(3600))
    XCTAssertEqual(battery.age(now: dates[1]), "1h")
    XCTAssertEqual(battery.age(now: dates[24]), "1d")
  }
  func testDelayedWakesReadLatestBoardAndClearAcrossReceiverRestart() throws {
    let suite = "WatchLastBatteryTests.\(UUID().uuidString)"
    let store = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { store.removePersistentDomain(forName: suite) }
    let a = WatchLastBattery(boardId: "a", boardName: "A", percent: 78.2, at: 1000)
    let b = WatchLastBattery(boardId: "b", boardName: "B", percent: 42, at: 2000)
    var latest: [String: Any] = [watchLastBatteryChannel: a.payload]
    let receive = { WatchBatteryDefaults.receiveLatestContext({ latest }, store: store) }
    XCTAssertTrue(receive())
    // A's wake is still queued when selected B's context arrives.
    latest[watchLastBatteryChannel] = b.payload
    XCTAssertTrue(receive())
    XCTAssertFalse(receive(), "Delayed A wake rereads B, rather than applying its A snapshot")
    XCTAssertEqual(WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)), b)
    // A newer same-percent reading must retain its source timestamp despite wake deduplication.
    let newer = WatchLastBattery(boardId: "b", boardName: "B", percent: 42.1, at: 3000)
    latest[watchLastBatteryChannel] = newer.payload
    XCTAssertTrue(receive())
    XCTAssertFalse(receive())
    XCTAssertEqual(WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)), newer)
    latest[watchLastBatteryChannel] = [:] as [String: Any]
    XCTAssertTrue(receive())
    let restartedStore = try XCTUnwrap(UserDefaults(suiteName: suite))
    XCTAssertFalse(WatchBatteryDefaults.receiveLatestContext({ latest }, store: restartedStore))
    XCTAssertNil(WatchLastBattery.decode(restartedStore.dictionary(forKey: watchLastBatteryChannel)))
    // A context from a phone build without this channel cannot undo the persisted clear.
    latest = [:]
    XCTAssertFalse(receive())
    XCTAssertNil(WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)))
  }

  func testOfflineRenamePersistsAndWakesWithoutChangingReadingAge() throws {
    let suite = "WatchLastBatteryTests.\(UUID().uuidString)"
    let store = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { store.removePersistentDomain(forName: suite) }
    var gate = WatchBatteryWakeGate()
    let before = WatchLastBattery(boardId: "a", boardName: "Old name", percent: 78.2, at: 1000)
    let after = WatchLastBattery(boardId: "a", boardName: "New name", percent: 78.2, at: 1000)
    XCTAssertTrue(gate.shouldSend(before, remaining: 50))
    XCTAssertTrue(WatchBatteryDefaults.receiveLatestContext({ [watchLastBatteryChannel: before.payload] }, store: store))
    XCTAssertTrue(gate.shouldSend(after, remaining: 49))
    XCTAssertTrue(WatchBatteryDefaults.receiveLatestContext({ [watchLastBatteryChannel: after.payload] }, store: store))
    XCTAssertEqual(WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)), after)
    XCTAssertFalse(gate.shouldSend(after, remaining: 48))
  }

  func testWakeBudgetReserveDoesNotConsumeChangeAndRetriesAfterReset() {
    let battery = WatchLastBattery(boardId: "a", boardName: "A", percent: 78.2, at: 1)
    var gate = WatchBatteryWakeGate()
    XCTAssertFalse(gate.shouldSend(battery, remaining: 5))
    XCTAssertTrue(gate.shouldSend(battery, remaining: 50))
    XCTAssertFalse(gate.shouldSend(WatchLastBattery(boardId: "a", boardName: "A", percent: 78.4, at: 2), remaining: 49))
    XCTAssertTrue(gate.shouldSend(WatchLastBattery(boardId: "b", boardName: "B", percent: 78.4, at: 2), remaining: 49))
    XCTAssertTrue(gate.shouldSend(nil, remaining: 48))
  }
}
