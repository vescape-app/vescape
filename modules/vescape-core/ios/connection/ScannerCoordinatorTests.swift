import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/ScannerCoordinatorTest.kt
final class ScannerCoordinatorTests: XCTestCase {
  private func granted(_ coordinator: ScannerCoordinator, _ purpose: ScanPurpose) -> ScanOperation? {
    guard case let .granted(operation) = coordinator.acquire(purpose) else {
      XCTFail("expected \(purpose.wireValue) to be granted")
      return nil
    }
    return operation
  }

  func testAddBoardScanCannotBePreemptedByPresenceScan() {
    let coordinator = ScannerCoordinator()
    _ = granted(coordinator, .addBoard)

    guard case let .denied(reason, heldBy) = coordinator.acquire(.presence) else {
      return XCTFail("expected presence to be denied")
    }
    XCTAssertEqual(ConnectionTraceReason.scannerBusy, reason)
    XCTAssertEqual(ScanPurpose.addBoard, heldBy)
  }

  func testBoardProbeCannotBePreemptedByPresenceScan() {
    let coordinator = ScannerCoordinator()
    _ = granted(coordinator, .boardProbe)

    guard case .denied = coordinator.acquire(.presence) else {
      return XCTFail("expected presence to be denied")
    }
  }

  func testHigherPriorityWorkTakesTheScannerFromPresence() {
    let coordinator = ScannerCoordinator()
    let presence = granted(coordinator, .presence)

    _ = granted(coordinator, .reconnect)

    XCTAssertFalse(coordinator.isCurrent(presence))
  }

  func testStaleCallbackTokenIsRejected() {
    let coordinator = ScannerCoordinator()
    let first = granted(coordinator, .presence)
    coordinator.release(first)
    let second = granted(coordinator, .presence)

    XCTAssertFalse(coordinator.isCurrent(first))
    XCTAssertTrue(coordinator.isCurrent(second))
  }

  func testStaleReleaseCannotStopANewerScan() {
    let coordinator = ScannerCoordinator()
    let first = granted(coordinator, .presence)
    coordinator.release(first)
    let second = granted(coordinator, .addBoard)

    XCTAssertFalse(coordinator.release(first))
    XCTAssertTrue(coordinator.isCurrent(second))

    XCTAssertTrue(coordinator.release(second))
    XCTAssertNil(coordinator.active)
  }
}

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/ConnectIntentPolicyTest.kt
final class ConnectIntentPolicyTests: XCTestCase {
  func testPersistsIndefinitelyWhenAutoCloseIsDisabled() {
    let intent = ConnectIntent(boardId: "board-1", createdAtMs: 0, autoCloseMs: nil)

    XCTAssertNil(intent.autoCloseAtMs)
    XCTAssertFalse(ConnectIntentPolicy.isExpired(intent, nowMs: Int64.max / 2))
  }

  func testEndsAtTheConfiguredAutoCloseDeadline() {
    let intent = ConnectIntent(boardId: "board-1", createdAtMs: 1_000, autoCloseMs: 30_000)

    XCTAssertEqual(31_000, intent.autoCloseAtMs)
    XCTAssertFalse(ConnectIntentPolicy.isExpired(intent, nowMs: 30_999))
    XCTAssertTrue(ConnectIntentPolicy.isExpired(intent, nowMs: 31_000))
  }

  func testOutranksAutoStartAndAutoConnectButNotABoardSession() {
    XCTAssertTrue(ConnectIntentPolicy.outranks(.autoStart))
    XCTAssertTrue(ConnectIntentPolicy.outranks(.autoConnect))
    XCTAssertTrue(ConnectIntentPolicy.outranks(.alternativeHint))
    XCTAssertFalse(ConnectIntentPolicy.outranks(.boardSession))
  }

  func testEveryEndingMapsToATerminalReason() {
    XCTAssertEqual(ConnectionTraceReason.manualDisconnect, ConnectIntentEnd.disconnect.reason)
    XCTAssertEqual(ConnectionTraceReason.appExit, ConnectIntentEnd.exit.reason)
    XCTAssertEqual(ConnectionTraceReason.taskRemoved, ConnectIntentEnd.forceQuit.reason)
    XCTAssertEqual(ConnectionTraceReason.matched, ConnectIntentEnd.connected.reason)
    XCTAssertEqual(ConnectionTraceReason.mechanicalTeardown, ConnectIntentEnd.sessionTeardown.reason)
    XCTAssertEqual(ConnectionTraceReason.autoClose, ConnectIntentEnd.autoClose.reason)
  }

  func testExclusiveScannerOwnersNeverYield() {
    XCTAssertFalse(ConnectionOwner.boardSession.outranks(.addBoardScan))
    XCTAssertFalse(ConnectionOwner.connectIntent.outranks(.boardProbe))
  }

  func testOwnershipRegistryFollowsPrecedence() {
    let ownership = ConnectionOwnership()

    XCTAssertTrue(ownership.request(.autoConnect).granted)

    let denied = ownership.request(.alternativeHint)
    XCTAssertFalse(denied.granted)
    XCTAssertEqual(ConnectionTraceReason.higherPriorityOwner, denied.reason)

    XCTAssertTrue(ownership.request(.connectIntent).granted)
    XCTAssertEqual(ConnectionOwner.connectIntent, ownership.current)

    XCTAssertFalse(ownership.release(.autoConnect))
    XCTAssertTrue(ownership.release(.connectIntent))
    XCTAssertEqual(ConnectionOwner.none, ownership.current)
  }
}
