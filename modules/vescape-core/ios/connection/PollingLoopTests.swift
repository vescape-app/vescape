import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/PollingLoopTest.kt
final class PollingLoopTests: XCTestCase {
  func testResponsePacingAndSafetyRetryUseVirtualTime() {
    let scheduler = TestScheduler()
    let session = BoardSession(id: 1)
    var current: BoardSession? = session
    let box = ValueBox([[UInt8]]())
    let loop = PollingLoop(
      scheduler: scheduler,
      isCurrentSession: { $0 === current },
      sendPayload: { payload, _ in box.value.append(payload); return true },
      nowMs: { scheduler.currentTimeMs }
    )

    loop.start(session: session, pollPayload: [1], bmsPayload: nil, pollIntervalMs: 50)
    XCTAssertEqual(box.value, [[1]])
    scheduler.advance(20)
    loop.onResponse()
    scheduler.advance(29)
    XCTAssertEqual(box.value.count, 1)
    scheduler.advance(1)
    XCTAssertEqual(box.value.count, 2)

    scheduler.advance(999)
    XCTAssertEqual(box.value.count, 2)
    scheduler.advance(1)
    XCTAssertEqual(box.value.count, 3)
    current = nil
  }

  func testInvalidatedOrReplacedSessionRejectsScheduledPoll() {
    for invalidate in [true, false] {
      let scheduler = TestScheduler()
      let session = BoardSession(id: 1)
      var current: BoardSession? = session
      let sent = ValueBox([[UInt8]]())
      let loop = PollingLoop(
        scheduler: scheduler,
        isCurrentSession: { $0 === current },
        sendPayload: { payload, _ in sent.value.append(payload); return true },
        nowMs: { scheduler.currentTimeMs }
      )
      loop.start(session: session, pollPayload: [1], bmsPayload: nil, pollIntervalMs: 50)
      scheduler.advance(20)
      loop.onResponse()
      if invalidate { session.invalidate() } else { current = BoardSession(id: 2) }
      scheduler.advance(30)
      XCTAssertEqual(sent.value.count, 1)
    }
  }

  func testRateIsUnknownUntilSecondPollThenTracksCadence() {
    let scheduler = TestScheduler()
    let session = BoardSession(id: 1)
    let sent = ValueBox([[UInt8]]())
    let loop = PollingLoop(
      scheduler: scheduler,
      isCurrentSession: { $0 === session },
      sendPayload: { payload, _ in sent.value.append(payload); return true },
      nowMs: { scheduler.currentTimeMs }
    )
    XCTAssertNil(loop.measuredRateHz())
    loop.start(session: session, pollPayload: [1], bmsPayload: nil, pollIntervalMs: 50)
    XCTAssertNil(loop.measuredRateHz())
    for _ in 0..<10 {
      scheduler.advance(20)
      loop.onResponse()
      scheduler.advance(30)
    }
    XCTAssertEqual(loop.measuredRateHz()!, 20, accuracy: 0.001)
  }
}

private final class ValueBox<Value> {
  var value: Value
  init(_ value: Value) { self.value = value }
}
