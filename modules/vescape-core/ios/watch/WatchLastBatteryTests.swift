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
