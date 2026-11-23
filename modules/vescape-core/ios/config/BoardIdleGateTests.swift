import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/BoardIdleGateTest.kt
final class BoardIdleGateTests: XCTestCase {
  private let now: Int64 = 1_000_000

  func testIdleBoardWithFreshTelemetryPasses() {
    for state in [0, 4, 5, 6, 11] {
      XCTAssertNil(BoardIdleGate.blockReason(sample(state: state), freshSinceMs: BoardIdleGate.freshSinceMs(now)), "state \(state)")
    }
  }

  func testEngagedStatesBlock() {
    for state in [1, 2, 3, 0x11] {
      XCTAssertNotNil(BoardIdleGate.blockReason(sample(state: state), freshSinceMs: BoardIdleGate.freshSinceMs(now)), "state \(state)")
    }
  }

  func testHandtestBlocks() {
    XCTAssertEqual(
      BoardIdleGate.blockReason(sample(switchState: 0x0A), freshSinceMs: BoardIdleGate.freshSinceMs(now)),
      "Board is in handtest"
    )
  }

  func testMissingOrStaleTelemetryBlocks() {
    XCTAssertNotNil(BoardIdleGate.blockReason(nil, freshSinceMs: BoardIdleGate.freshSinceMs(now)))
    XCTAssertNotNil(BoardIdleGate.blockReason(sample(receivedAtMs: now - 4_001), freshSinceMs: BoardIdleGate.freshSinceMs(now)))
    XCTAssertNil(BoardIdleGate.blockReason(sample(receivedAtMs: now - 4_000), freshSinceMs: BoardIdleGate.freshSinceMs(now)))
  }

  private func sample(state: Int = 0, switchState: Int = 2, receivedAtMs: Int64? = nil) -> BoardRideState {
    BoardRideState(state: state, switchState: switchState, receivedAtMs: receivedAtMs ?? now)
  }
}
