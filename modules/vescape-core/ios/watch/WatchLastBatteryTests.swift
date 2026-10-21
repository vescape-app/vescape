import XCTest
@testable import VescapeCore

final class WatchLastBatteryTests: XCTestCase {
  func testPayloadRoundTripUnknownClearAndInvalidReading() throws {
    let known = WatchLastBattery(boardId: "a", boardName: "X7", percent: 78.5, at: 1_000)
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
    XCTAssertTrue(gate.shouldSend(before))
    XCTAssertTrue(WatchBatteryDefaults.receiveLatestContext({ [watchLastBatteryChannel: before.payload] }, store: store))
    XCTAssertTrue(gate.shouldSend(after))
    XCTAssertTrue(WatchBatteryDefaults.receiveLatestContext({ [watchLastBatteryChannel: after.payload] }, store: store))
    XCTAssertEqual(WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)), after)
    XCTAssertFalse(gate.shouldSend(after))
  }

  func testWakeGateSendsOnlyVisibleChanges() {
    var gate = WatchBatteryWakeGate()
    XCTAssertTrue(gate.shouldSend(WatchLastBattery(boardId: "a", boardName: "A", percent: 78.2, at: 1)))
    XCTAssertFalse(gate.shouldSend(WatchLastBattery(boardId: "a", boardName: "A", percent: 78.4, at: 2)))
    XCTAssertTrue(gate.shouldSend(WatchLastBattery(boardId: "b", boardName: "B", percent: 78.4, at: 2)))
    XCTAssertTrue(gate.shouldSend(nil))
    XCTAssertFalse(gate.shouldSend(nil))
  }

  func testSelectedReadsStoredBoardAndDropsIncompleteOrDeletedBoards() {
    let stored: [String: Any?] = ["percent": 78.0, "voltage": nil, "at": Int64(1000)]
    let board: [String: Any?] = ["name": "X7", "lastBattery": stored, "deletedAt": nil]
    XCTAssertEqual(WatchLastBattery.selected(boardId: "a", board: board),
      WatchLastBattery(boardId: "a", boardName: "X7", percent: 78, at: 1000))
    var neverSeen = board
    neverSeen.removeValue(forKey: "lastBattery")
    XCTAssertEqual(WatchLastBattery.selected(boardId: "a", board: neverSeen),
      WatchLastBattery(boardId: "a", boardName: "X7", percent: nil, at: nil))
    var invalid = board
    invalid["lastBattery"] = ["percent": Double.nan, "at": Int64(1)] as [String: Any?]
    XCTAssertNil(WatchLastBattery.selected(boardId: "a", board: invalid)?.percent)
    var deleted = board
    deleted["deletedAt"] = Int64(5)
    XCTAssertNil(WatchLastBattery.selected(boardId: "a", board: deleted))
    XCTAssertNil(WatchLastBattery.selected(boardId: nil, board: board))
  }
}
