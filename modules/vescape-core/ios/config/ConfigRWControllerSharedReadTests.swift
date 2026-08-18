import XCTest
@testable import VescapeCore

/// Shared read (#393): the post-trust background read serves every consumer that asks for config
/// while it is on the wire, instead of rejecting the second caller with `CONFIG_REQUEST_IN_FLIGHT`.
/// A write in flight is still exclusive.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/config/ConfigRWControllerSharedReadTest.kt
final class ConfigRWControllerSharedReadTests: XCTestCase {
  func testSecondReaderJoinsTheInFlightRead() {
    let controller = ConfigRWController()
    var errors: [String] = []

    controller.consumeRead(connection: connection(), onSuccess: { _ in }, onError: { code, _ in errors.append(code) })
    controller.consumeRead(connection: connection(), onSuccess: { _ in }, onError: { code, _ in errors.append(code) })

    XCTAssertTrue(controller.isInFlight)
    XCTAssertEqual(errors, [])
  }

  func testReadDuringWriteStillRejects() {
    let controller = ConfigRWController()
    var errors: [String] = []

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(),
      onSuccess: { _ in },
      onError: { code, _ in errors.append(code) }
    )
    XCTAssertTrue(controller.isInFlight)

    controller.consumeRead(connection: connection(), onSuccess: { _ in }, onError: { code, _ in errors.append(code) })

    XCTAssertEqual(errors, [RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.rawValue])
  }

  private func connection() -> ConfigRWConnection {
    ConfigRWConnection(
      phase: .connected,
      appBoardId: "board-1",
      transport: .direct,
      fwVersion: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7",
      linkIntegrity: .trusted,
      boardConfigValues: nil,
      isPollingActive: { false },
      stopPolling: {},
      startPolling: {},
      sendPayload: { _ in true },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in ["boardId": "board-1", "refloatBaseVersion": "3.0.7", "fields": [String: Any]()] },
      onBoardConfigValues: { _ in }
    )
  }
}
