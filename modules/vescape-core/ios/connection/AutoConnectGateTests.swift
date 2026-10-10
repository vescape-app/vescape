import XCTest
@testable import VescapeCore

final class AutoConnectGateTests: XCTestCase {
  private func decide(
    settings: [String: Any] = ["autoConnect": true, "selectedBoardId": "board-1"],
    suppressedBoardId: String? = nil,
    hasLiveSession: Bool = false,
    resumePending: Bool = false
  ) -> AutoConnectDecision {
    AutoConnectGate.decide(
      settings: settings,
      suppressedBoardId: suppressedBoardId,
      hasLiveSession: hasLiveSession,
      resumePending: resumePending
    )
  }

  func testConnectsSelectedBoardOnAPlainLaunch() {
    XCTAssertEqual(decide(), .connect(boardId: "board-1"))
  }

  func testDefaultsToOnWhenTheSettingWasNeverWritten() {
    XCTAssertEqual(decide(settings: ["selectedBoardId": "board-1"]), .connect(boardId: "board-1"))
  }

  func testNoOpsWhenAutoConnectIsOff() {
    XCTAssertEqual(decide(settings: ["autoConnect": false, "selectedBoardId": "board-1"]), .skip(reason: "auto_connect_off"))
  }

  func testNoOpsWithoutASelectedBoard() {
    XCTAssertEqual(decide(settings: ["autoConnect": true]), .skip(reason: "no_selected_board"))
    XCTAssertEqual(
      decide(settings: ["autoConnect": true, "selectedBoardId": ""]),
      .skip(reason: "no_selected_board")
    )
  }

  func testNoOpsWhenTheSelectedBoardIsTombstonedByAManualStop() {
    XCTAssertEqual(decide(suppressedBoardId: "board-1"), .skip(reason: "manual_stop_tombstone"))
  }

  func testATombstoneOnAnotherBoardDoesNotGateTheSelectedOne() {
    XCTAssertEqual(decide(suppressedBoardId: "board-2"), .connect(boardId: "board-1"))
  }

  /// Restoration adoption decides first (ADR 0034): a launch that is resuming a live session must
  /// not start a second one alongside it.
  func testStandsDownWhileStateRestorationIsPending() {
    XCTAssertEqual(decide(resumePending: true), .skip(reason: "state_restoration_pending"))
  }

  func testStandsDownWhenASessionIsAlreadyLive() {
    XCTAssertEqual(decide(hasLiveSession: true), .skip(reason: "session_already_live"))
  }
}
