import XCTest
@testable import VescapeCore

/// The rider stop command: idempotent on the active Board id, and the only path that turns a stop
/// into an Automatic Connection Pause (ADR 0035, #406).
final class ManualBoardStopTests: XCTestCase {
  func testStopArmsAPauseForTheStoppedBoard() {
    var paused: [String] = []
    let command = ManualBoardStop(
      activeBoardId: { "board-1" },
      stop: { true },
      armPause: { paused.append($0); return true }
    )

    XCTAssertTrue(command.perform())
    XCTAssertEqual(paused, ["board-1"])
  }

  func testRefusedStopArmsNothing() {
    var paused: [String] = []
    let command = ManualBoardStop(
      activeBoardId: { "board-1" },
      stop: { false },
      armPause: { paused.append($0); return true }
    )

    // A stop no session accepted is a ghost surface: it must not pause automatic connection.
    XCTAssertFalse(command.perform())
    XCTAssertTrue(paused.isEmpty)
  }

  func testStopWithoutAnActiveBoardIsANoOp() {
    var paused: [String] = []
    var stopped = false
    let command = ManualBoardStop(
      activeBoardId: { nil },
      stop: { stopped = true; return true },
      armPause: { paused.append($0); return true }
    )

    XCTAssertFalse(command.perform())
    XCTAssertFalse(stopped)
    XCTAssertTrue(paused.isEmpty)
  }
}
