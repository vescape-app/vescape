import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/runtime/BoardSessionLinkIntegrityTest.kt
final class BoardSessionLinkIntegrityTests: XCTestCase {
  private let complete = LinkIdentity(
    linkVersion: 4,
    hasBms: true,
    firmware: "FW 6.05",
    refloatVersion: "Refloat 3.0.7",
    refloatBaseVersion: "3.0.7"
  )

  func testCompleteLinkStartsChecking() {
    let session = BoardSession(id: 1)

    XCTAssertEqual(.checking, session.startLinkIntegrityCheck(expected: complete))
  }

  func testOldOrIncompleteLinkStartsOutdated() {
    let session = BoardSession(id: 1)

    let legacy = LinkIdentity(
      linkVersion: nil,
      hasBms: true,
      firmware: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7"
    )
    XCTAssertEqual(.checking, session.startLinkIntegrityCheck(expected: legacy))
    XCTAssertEqual(.outdated, session.markOutdatedIfIncomplete(expected: legacy))
    XCTAssertEqual(.outdated, session.markOutdatedIfIncomplete(expected: LinkIdentity(
      linkVersion: 3,
      hasBms: true,
      firmware: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7"
    )))
    XCTAssertEqual(.outdated, session.markOutdatedIfIncomplete(expected: LinkIdentity(
      linkVersion: 4,
      hasBms: nil,
      firmware: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7"
    )))
  }

  func testMatchingFactsBecomeTrusted() {
    let session = BoardSession(id: 1)
    session.startLinkIntegrityCheck(expected: complete)

    XCTAssertEqual(.checking, session.observeFirmware(expected: complete, firmware: "FW 6.05"))
    XCTAssertEqual(.checking, session.observeRefloat(expected: complete, refloatVersion: "Refloat 3.0.7"))
    XCTAssertEqual(.trusted, session.observeBms(expected: complete))
  }

  func testMismatchedFactsLatchForSession() {
    let session = BoardSession(id: 1)
    session.startLinkIntegrityCheck(expected: complete)

    XCTAssertEqual(.mismatched, session.observeFirmware(expected: complete, firmware: "FW 6.06"))
    XCTAssertEqual(.mismatched, session.observeFirmware(expected: complete, firmware: "FW 6.05"))
  }

  func testExpectedBmsMissingMismatchesButFalseDoesNotNeedBms() {
    let withoutBms = LinkIdentity(
      linkVersion: 4,
      hasBms: false,
      firmware: "FW 6.05",
      refloatVersion: "Refloat 3.0.7",
      refloatBaseVersion: "3.0.7"
    )
    let trusted = BoardSession(id: 1)
    trusted.startLinkIntegrityCheck(expected: withoutBms)
    trusted.observeFirmware(expected: withoutBms, firmware: "FW 6.05")
    XCTAssertEqual(.trusted, trusted.observeRefloat(expected: withoutBms, refloatVersion: "Refloat 3.0.7"))
    XCTAssertEqual(.mismatched, trusted.observeBms(expected: withoutBms))

    let missingBms = BoardSession(id: 2)
    missingBms.startLinkIntegrityCheck(expected: complete)
    missingBms.observeFirmware(expected: complete, firmware: "FW 6.05")
    missingBms.observeRefloat(expected: complete, refloatVersion: "Refloat 3.0.7")
    XCTAssertEqual(.mismatched, missingBms.markBmsMissing(expected: complete))
  }

  func testUnprovenCheckTimesOutToOutdated() {
    let session = BoardSession(id: 1)
    session.startLinkIntegrityCheck(expected: complete)
    XCTAssertEqual(.checking, session.observeFirmware(expected: complete, firmware: "FW 6.05"))

    XCTAssertEqual(.outdated, session.markCheckTimedOut())
  }

  func testCheckTimeoutLeavesASettledVerdictAlone() {
    let trusted = BoardSession(id: 1)
    trusted.startLinkIntegrityCheck(expected: complete)
    trusted.observeFirmware(expected: complete, firmware: "FW 6.05")
    trusted.observeRefloat(expected: complete, refloatVersion: "Refloat 3.0.7")
    XCTAssertEqual(.trusted, trusted.observeBms(expected: complete))
    XCTAssertEqual(.trusted, trusted.markCheckTimedOut())

    let mismatched = BoardSession(id: 2)
    mismatched.startLinkIntegrityCheck(expected: complete)
    XCTAssertEqual(.mismatched, mismatched.observeFirmware(expected: complete, firmware: "FW 6.06"))
    XCTAssertEqual(.mismatched, mismatched.markCheckTimedOut())
  }

  func testLegalModeEnableRequiresMatchingConnectedBoardAndTrustedLink() {
    XCTAssertEqual(
      legalModeEnableError(
        phase: .connected,
        activeBoardId: "board-1",
        linkIntegrity: .trusted,
        requestedBoardId: "board-2"
      )?.0,
      "LEGAL_MODE_BOARD_NOT_CONNECTED"
    )
    XCTAssertEqual(
      legalModeEnableError(
        phase: .connected,
        activeBoardId: "board-1",
        linkIntegrity: .checking,
        requestedBoardId: "board-1"
      )?.0,
      "LINK_NOT_TRUSTED"
    )
    XCTAssertNil(
      legalModeEnableError(
        phase: .connected,
        activeBoardId: "board-1",
        linkIntegrity: .trusted,
        requestedBoardId: "board-1"
      )
    )
  }

  func testLegacyInfoCanGainPackageAndPatchPrecisionWithoutInvalidatingLink() {
    let cases = [
      ("Refloat 1.2", "Float/Refloat 1.2"),
      ("Refloat 1.2", "Refloat 1.2.0"),
      ("Refloat 1.2", "Refloat 1.2.7-beta"),
      ("Refloat 1.2", "Float 1.2.7"),
      ("Float/Refloat 1.2", "Refloat 1.2.7"),
      ("Float/Refloat 1.2", "Float 1.2.0"),
      ("Float/Refloat 1.2", "Float/Refloat 1.2"),
    ]
    for (saved, observed) in cases {
      var expected = complete
      expected.refloatVersion = saved
      expected.refloatBaseVersion = LinkIdentity.normalizeRefloatBaseVersion(saved)
      let session = BoardSession(id: 1)
      session.startLinkIntegrityCheck(expected: expected)
      session.observeFirmware(expected: expected, firmware: "FW 6.05")
      session.observeBms(expected: expected)
      XCTAssertEqual(.trusted, session.observeRefloat(expected: expected, refloatVersion: observed), "\(saved) -> \(observed)")
    }
  }

  func testCompatibilityPreservesKnownIdentityFacts() {
    let cases = [
      ("Refloat 1.2", "Float/Refloat 1.3"),
      ("Refloat 1.2", "Refloat 2.2.0"),
      ("Refloat 1.2", "Other 1.2.0"),
      ("Refloat 1.2.0", "Float 1.2.0"),
      ("Refloat 1.2.0", "Refloat 1.2.1"),
      ("Refloat 1.2.0-beta", "Refloat 1.2.0"),
      ("Refloat 1.2.0", "Float/Refloat 1.2"),
      ("Refloat 1.2.0", "Refloat 1.2"),
      ("Refloat 1.2", "Refloat 1.2.0 extra"),
      ("Refloat 1.2", "Refloat 1.2.0\n"),
      ("Refloat unknown", "Float/Refloat unknown"),
    ]
    for (saved, observed) in cases {
      var expected = complete
      expected.refloatVersion = saved
      expected.refloatBaseVersion = LinkIdentity.normalizeRefloatBaseVersion(saved)
      let session = BoardSession(id: 1)
      session.startLinkIntegrityCheck(expected: expected)
      session.observeFirmware(expected: expected, firmware: "FW 6.05")
      session.observeBms(expected: expected)
      XCTAssertEqual(.mismatched, session.observeRefloat(expected: expected, refloatVersion: observed), "\(saved) -> \(observed)")
    }
  }

  func testLegacyCompatibilityStillRequiresAllFactsAndConsistentBaseVersion() {
    var expected = complete
    expected.refloatVersion = "Refloat 1.2"
    expected.refloatBaseVersion = "1.2"
    let session = BoardSession(id: 1)
    session.startLinkIntegrityCheck(expected: expected)
    XCTAssertEqual(.checking, session.observeRefloat(expected: expected, refloatVersion: "Refloat 1.2.0"))
    XCTAssertEqual(.checking, session.observeFirmware(expected: expected, firmware: "FW 6.05"))
    XCTAssertEqual(.trusted, session.observeBms(expected: expected))
    XCTAssertEqual(.mismatched, session.observeFirmware(expected: expected, firmware: "FW 6.06"))
    XCTAssertEqual(.mismatched, session.observeFirmware(expected: expected, firmware: "FW 6.05"))

    var inconsistent = expected
    inconsistent.refloatBaseVersion = "1.3"
    XCTAssertEqual(.mismatched, BoardSession(id: 2).observeRefloat(expected: inconsistent, refloatVersion: "Refloat 1.2.0"))
    let missingBms = BoardSession(id: 3)
    missingBms.observeRefloat(expected: expected, refloatVersion: "Float/Refloat 1.2")
    XCTAssertEqual(.mismatched, missingBms.markBmsMissing(expected: expected))
  }
}
