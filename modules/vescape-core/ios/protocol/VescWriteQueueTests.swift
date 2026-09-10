import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/protocol/VescWriteQueueTest.kt
final class VescWriteQueueTests: XCTestCase {
  private func isRemoteInput(_ write: VescWriteQueue.Write?) -> Bool {
    if case .remoteInput = write { return true }
    return false
  }

  func testNeutralRemoteInputReplacesStaleTiltAndPreemptsNormalTraffic() {
    let queue = VescWriteQueue()
    let inFlightPoll: [UInt8] = [1]
    let queuedPoll: [UInt8] = [2]
    let staleTilt: [UInt8] = [3]
    let neutralTilt: [UInt8] = [4]

    queue.enqueueNormal(inFlightPoll)
    XCTAssertEqual(queue.startNext()?.bytes, inFlightPoll)
    queue.enqueueNormal(queuedPoll)
    queue.replaceRemoteInput(staleTilt)
    queue.replaceRemoteInput(neutralTilt, urgent: true)

    queue.completeInFlight()
    let next = queue.startNext()
    XCTAssertTrue(isRemoteInput(next))
    XCTAssertEqual(next?.bytes, neutralTilt)

    queue.completeInFlight()
    XCTAssertEqual(queue.startNext()?.bytes, queuedPoll)
  }

  func testOnlyOneRemoteInputWriteCanWaitBehindInFlightWrite() {
    let queue = VescWriteQueue()
    let first: [UInt8] = [1]
    let latest: [UInt8] = [2]

    queue.replaceRemoteInput(first)
    XCTAssertEqual(queue.startNext()?.bytes, first)
    queue.replaceRemoteInput(latest)
    XCTAssertNil(queue.startNext())

    queue.completeInFlight()
    XCTAssertEqual(queue.startNext()?.bytes, latest)
    queue.completeInFlight()
    XCTAssertNil(queue.startNext())
  }

  func testOrdinaryRemoteInputAndNormalTrafficAlternate() {
    let queue = VescWriteQueue()
    let firstTilt: [UInt8] = [1]
    let poll: [UInt8] = [2]
    let nextTilt: [UInt8] = [3]

    queue.replaceRemoteInput(firstTilt)
    XCTAssertEqual(queue.startNext()?.bytes, firstTilt)
    queue.completeInFlight()
    queue.enqueueNormal(poll)
    queue.replaceRemoteInput(nextTilt)

    XCTAssertEqual(queue.startNext()?.bytes, poll)
    queue.completeInFlight()
    XCTAssertEqual(queue.startNext()?.bytes, nextTilt)
  }

  func testUrgentNeutralTiltPreemptsNormalTraffic() {
    let queue = VescWriteQueue()
    let heldTilt: [UInt8] = [1]
    let poll: [UInt8] = [2]
    let neutralTilt: [UInt8] = [3]

    queue.replaceRemoteInput(heldTilt)
    XCTAssertEqual(queue.startNext()?.bytes, heldTilt)
    queue.completeInFlight()
    queue.enqueueNormal(poll)
    queue.replaceRemoteInput(neutralTilt, urgent: true)

    XCTAssertEqual(queue.startNext()?.bytes, neutralTilt)
  }

  func testRoutineRemoteInputNeverSwallowsAnUnsentUrgentStop() {
    let queue = VescWriteQueue()
    let poll: [UInt8] = [1]
    let neutral: [UInt8] = [2]
    let otherFeatureTick: [UInt8] = [3]
    let newerNeutral: [UInt8] = [4]

    queue.enqueueNormal(poll)
    XCTAssertEqual(queue.startNext()?.bytes, poll)
    queue.replaceRemoteInput(neutral, urgent: true)
    // Remote Tilt and Board Move share this slot: a routine tick must not drop a pending stop.
    queue.replaceRemoteInput(otherFeatureTick)

    queue.completeInFlight()
    XCTAssertEqual(queue.startNext()?.bytes, neutral)

    // A newer stop still wins over an older one.
    queue.completeInFlight()
    queue.replaceRemoteInput(neutral, urgent: true)
    queue.replaceRemoteInput(newerNeutral, urgent: true)
    XCTAssertEqual(queue.startNext()?.bytes, newerNeutral)
  }

  func testRefusedRemoteInputWriteNeverOverwritesNewerTilt() {
    let queue = VescWriteQueue()
    let refused: [UInt8] = [1]
    let latest: [UInt8] = [2]

    queue.replaceRemoteInput(refused)
    XCTAssertEqual(queue.startNext()?.bytes, refused)
    queue.replaceRemoteInput(latest)
    queue.retryInFlight()

    XCTAssertEqual(queue.startNext()?.bytes, latest)
  }

  /// The regression this queue exists for: a held stream at its repeat cadence must not grow the
  /// backlog, or the neutral that ends the gesture lands seconds late and the board holds tilt.
  func testHeldStreamNeverAccumulatesBacklog() {
    let queue = VescWriteQueue()

    // 100 ticks arrive while a single write is in flight.
    queue.enqueueNormal([0])
    XCTAssertEqual(queue.startNext()?.bytes, [0])
    for tick in 1...100 {
      queue.replaceRemoteInput([UInt8(tick)])
    }
    queue.completeInFlight()

    // Only the newest survives; the other 99 never reach the board.
    XCTAssertEqual(queue.startNext()?.bytes, [100])
    queue.completeInFlight()
    XCTAssertNil(queue.startNext())
  }
}
