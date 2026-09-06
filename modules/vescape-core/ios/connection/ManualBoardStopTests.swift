import XCTest
@testable import VescapeCore

final class ManualBoardStopTests: XCTestCase {
  private var defaults: UserDefaults!

  override func setUp() {
    super.setUp()
    defaults = UserDefaults(suiteName: "ManualBoardStopTests")
    defaults.removePersistentDomain(forName: "ManualBoardStopTests")
  }

  override func tearDown() {
    defaults.removePersistentDomain(forName: "ManualBoardStopTests")
    defaults = nil
    super.tearDown()
  }

  func testRoutesActiveBoardStopOnceAndSuppressesAutoStart() {
    var activeBoardId: String? = "board-1"
    var stopCount = 0
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { activeBoardId },
      stop: {
        stopCount += 1
        activeBoardId = nil
        return true
      }
    )

    XCTAssertTrue(command.perform())
    XCTAssertFalse(command.perform())
    XCTAssertEqual(stopCount, 1)
    XCTAssertTrue(ManualBoardStop.isAutoStartSuppressed(boardId: "board-1", defaults: defaults))
  }

  func testIdleStopDoesNothing() {
    var stopCount = 0
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { nil },
      stop: {
        stopCount += 1
        return true
      }
    )

    XCTAssertFalse(command.perform())
    XCTAssertEqual(stopCount, 0)
    XCTAssertNil(defaults.string(forKey: ManualBoardStop.suppressedBoardKey))
  }

  func testStaleBoardIdDoesNotSuppressAutoStartWhenNoSessionStops() {
    var stopCount = 0
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { "stale-board" },
      stop: {
        stopCount += 1
        return false
      }
    )

    XCTAssertFalse(command.perform())
    XCTAssertEqual(stopCount, 1)
    XCTAssertFalse(
      ManualBoardStop.isAutoStartSuppressed(boardId: "stale-board", defaults: defaults)
    )
  }

  /// The clear a Board Session start performs (`BoardSessionController.beginSession`, mirroring
  /// Android's `connectSelectedBoard`): after a manual stop followed by a real reconnect, the next
  /// launch auto-connects again instead of staying gated forever.
  func testSessionStartClearLetsTheNextLaunchAutoConnect() {
    var activeBoardId: String? = "board-1"
    let command = ManualBoardStop(
      defaults: defaults,
      activeBoardId: { activeBoardId },
      stop: {
        activeBoardId = nil
        return true
      }
    )
    XCTAssertTrue(command.perform())
    XCTAssertEqual(
      AutoConnectGate.decide(
        settings: ["autoConnect": true, "selectedBoardId": "board-1"],
        suppressedBoardId: ManualBoardStop.suppressedBoardId(defaults: defaults),
        hasLiveSession: false,
        resumePending: false
      ),
      .skip(reason: "manual_stop_tombstone")
    )

    ManualBoardStop.clearAutoStartSuppression(defaults: defaults)

    XCTAssertEqual(
      AutoConnectGate.decide(
        settings: ["autoConnect": true, "selectedBoardId": "board-1"],
        suppressedBoardId: ManualBoardStop.suppressedBoardId(defaults: defaults),
        hasLiveSession: false,
        resumePending: false
      ),
      .connect(boardId: "board-1")
    )
  }

  func testClearAllowsAutoStartAgain() {
    defaults.set("board-1", forKey: ManualBoardStop.suppressedBoardKey)

    ManualBoardStop.clearAutoStartSuppression(defaults: defaults)

    XCTAssertFalse(ManualBoardStop.isAutoStartSuppressed(boardId: "board-1", defaults: defaults))
  }
}
