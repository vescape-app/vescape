import XCTest
@testable import VescapeCore

final class ConfigRWControllerLinkIntegrityTests: XCTestCase {
  private var stoppedPolling = false
  private var sentPayload = false
  private var loadedProfile = false

  func testReadFailsClosedWhenLinkIsChecking() {
    assertReadFailsClosed(.checking)
  }

  func testReadFailsClosedWhenLinkIsOutdated() {
    assertReadFailsClosed(.outdated)
  }

  func testReadFailsClosedWhenLinkIsMismatched() {
    assertReadFailsClosed(.mismatched)
  }

  func testWriteFailsClosedWhenLinkIsChecking() {
    assertWriteFailsClosed(.checking)
  }

  func testWriteFailsClosedWhenLinkIsOutdated() {
    assertWriteFailsClosed(.outdated)
  }

  func testWriteFailsClosedWhenLinkIsMismatched() {
    assertWriteFailsClosed(.mismatched)
  }

  private func assertReadFailsClosed(_ linkIntegrity: LinkIntegrity) {
    let controller = ConfigRWController()
    var errors: [(String, String)] = []

    controller.consumeRead(
      connection: connection(linkIntegrity),
      onSuccess: { _ in XCTFail("read should not succeed") },
      onError: { code, message in errors.append((code, message)) }
    )

    XCTAssertEqual(errors.map(\.0), [RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue])
    XCTAssertEqual(errors.map(\.1), ["Trusted board link required before reading Refloat config"])
    XCTAssertFalse(stoppedPolling)
    XCTAssertFalse(sentPayload)
  }

  private func assertWriteFailsClosed(_ linkIntegrity: LinkIntegrity) {
    let controller = ConfigRWController()
    var errors: [(String, String)] = []

    controller.consumeWrite(
      profileId: "profile-1",
      connection: connection(linkIntegrity),
      onSuccess: { _ in XCTFail("write should not succeed") },
      onError: { code, message in errors.append((code, message)) }
    )

    XCTAssertEqual(errors.map(\.0), [RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue])
    XCTAssertEqual(errors.map(\.1), ["Trusted board link required before pushing config"])
    XCTAssertFalse(stoppedPolling)
    XCTAssertFalse(sentPayload)
    XCTAssertFalse(loadedProfile)
  }

  private func connection(_ linkIntegrity: LinkIntegrity) -> ConfigRWConnection {
    ConfigRWConnection(
      phase: .connected,
      appBoardId: "board-1",
      transport: .direct,
      fwVersion: "FW 6.05",
      refloatBaseVersion: "3.0.7",
      linkIntegrity: linkIntegrity,
      isPollingActive: { true },
      stopPolling: { self.stoppedPolling = true },
      startPolling: {},
      sendPayload: { _ in self.sentPayload = true; return true },
      captureDiagnostic: { _, _ in },
      loadProfile: { _ in self.loadedProfile = true; return nil },
      onBoardConfigValues: { _ in }
    )
  }
}
