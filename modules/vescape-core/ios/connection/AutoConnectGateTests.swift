import XCTest
@testable import VescapeCore

final class AutoConnectGateTests: XCTestCase {
  private func decide(
    settings: [String: Any] = ["autoConnect": true, "selectedBoardId": "board-1"],
    suppressedBoardId: String? = nil,
    hasLiveSession: Bool = false,
    resumePending: Bool = false
  ) -> String? {
    AutoConnectGate.boardToAutoConnect(
      settings: settings,
      suppressedBoardId: suppressedBoardId,
      hasLiveSession: hasLiveSession,
      resumePending: resumePending
    )
  }

  func testConnectsSelectedBoardOnAPlainLaunch() {
    XCTAssertEqual(decide(), "board-1")
  }

  func testDefaultsToOnWhenTheSettingWasNeverWritten() {
    XCTAssertEqual(decide(settings: ["selectedBoardId": "board-1"]), "board-1")
  }

  func testNoOpsWhenAutoConnectIsOff() {
    XCTAssertNil(decide(settings: ["autoConnect": false, "selectedBoardId": "board-1"]))
  }

  func testNoOpsWithoutASelectedBoard() {
    XCTAssertNil(decide(settings: ["autoConnect": true]))
    XCTAssertNil(decide(settings: ["autoConnect": true, "selectedBoardId": ""]))
  }

  func testNoOpsWhenTheSelectedBoardIsTombstonedByAManualStop() {
    XCTAssertNil(decide(suppressedBoardId: "board-1"))
  }

  func testATombstoneOnAnotherBoardDoesNotGateTheSelectedOne() {
    XCTAssertEqual(decide(suppressedBoardId: "board-2"), "board-1")
  }

  /// Restoration adoption decides first (ADR 0034): a launch that is resuming a live session must
  /// not start a second one alongside it.
  func testStandsDownWhileStateRestorationIsPending() {
    XCTAssertNil(decide(resumePending: true))
  }

  func testStandsDownWhenASessionIsAlreadyLive() {
    XCTAssertNil(decide(hasLiveSession: true))
  }
}
