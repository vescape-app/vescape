import Foundation

/// Identity token for one Board Session. Long-lived native work (GATT callbacks, poll
/// timers) captures the session it started under and checks `isActive` before touching
/// shared state, so a callback from a torn-down or reconnected session is discarded
/// instead of clobbering the live one. See ADR 0010.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/BoardSession.kt
final class BoardSession {
  let id: Int64
  private(set) var isActive = true
  private(set) var linkIntegrity: LinkIntegrity = .unknown
  private(set) var linkIntegrityProbeStarted = false
  private var observations = LinkIdentity(linkVersion: 3)

  init(id: Int64) {
    self.id = id
  }

  func invalidate() {
    isActive = false
  }

  func startLinkIntegrityCheck(expected: LinkIdentity) -> LinkIntegrity {
    linkIntegrity = .checking
    return linkIntegrity
  }

  func markOutdatedIfIncomplete(expected: LinkIdentity) -> LinkIntegrity {
    if !expected.isComplete { linkIntegrity = .outdated }
    return linkIntegrity
  }

  func claimLinkIntegrityProbe() -> Bool {
    if linkIntegrityProbeStarted { return false }
    linkIntegrityProbeStarted = true
    return true
  }

  func observeFirmware(expected: LinkIdentity, firmware: String) -> LinkIntegrity {
    updateLinkIntegrity(expected: expected) { $0.firmware = firmware }
  }

  func observeRefloat(expected: LinkIdentity, refloatVersion: String) -> LinkIntegrity {
    updateLinkIntegrity(expected: expected) {
      $0.refloatVersion = refloatVersion
      $0.refloatBaseVersion = LinkIdentity.normalizeRefloatBaseVersion(refloatVersion)
    }
  }

  func observeBms(expected: LinkIdentity) -> LinkIntegrity {
    updateLinkIntegrity(expected: expected) { $0.hasBms = true }
  }

  func markBmsMissing(expected: LinkIdentity) -> LinkIntegrity {
    if linkIntegrity == .mismatched { return linkIntegrity }
    if expected.hasBms == true, observations.hasBms != true {
      linkIntegrity = .mismatched
    }
    return linkIntegrity
  }

  private func updateLinkIntegrity(
    expected: LinkIdentity,
    mutate: (inout LinkIdentity) -> Void
  ) -> LinkIntegrity {
    if linkIntegrity == .outdated || linkIntegrity == .mismatched { return linkIntegrity }
    mutate(&observations)
    if !expected.isComplete {
      linkIntegrity = .outdated
    } else if expected.mismatches(observations) {
      linkIntegrity = .mismatched
    } else if expected.matches(observations) {
      linkIntegrity = .trusted
    } else {
      linkIntegrity = .checking
    }
    return linkIntegrity
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/BoardSession.kt
/// @parity /modules/vescape-core/src/index.ts `LinkIntegrity`
enum LinkIntegrity: String {
  case unknown
  case checking
  case trusted
  case outdated
  case mismatched
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt `legalModeEnableError`
func legalModeEnableError(
  phase: BoardPhase,
  activeBoardId: String?,
  linkIntegrity: LinkIntegrity,
  requestedBoardId: String
) -> (String, String)? {
  guard phase == .connected, activeBoardId == requestedBoardId else {
    return ("LEGAL_MODE_BOARD_NOT_CONNECTED", "Matching active Board Session required")
  }
  guard linkIntegrity == .trusted else {
    return ("LINK_NOT_TRUSTED", "Trusted Board Link required to enable Legal Mode")
  }
  return nil
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/runtime/BoardSession.kt
struct LinkIdentity {
  var linkVersion: Int?
  var hasBms: Bool?
  var firmware: String?
  var refloatVersion: String?
  var refloatBaseVersion: String?

  // refloatBaseVersion is derived from refloatVersion and may be absent for malformed or unknown
  // version strings, so it is not required here; matches/mismatches still compare it when present.
  var isComplete: Bool {
    linkVersion == 3 &&
      hasBms != nil &&
      !(firmware?.isEmpty ?? true) &&
      !(refloatVersion?.isEmpty ?? true)
  }

  func mismatches(_ observed: LinkIdentity) -> Bool {
    (observed.firmware != nil && observed.firmware != firmware) ||
      (observed.refloatVersion != nil && observed.refloatVersion != refloatVersion) ||
      (observed.refloatBaseVersion != nil && observed.refloatBaseVersion != refloatBaseVersion) ||
      (hasBms != nil && observed.hasBms != nil && observed.hasBms != hasBms)
  }

  func matches(_ observed: LinkIdentity) -> Bool {
    observed.firmware == firmware &&
      observed.refloatVersion == refloatVersion &&
      observed.refloatBaseVersion == refloatBaseVersion &&
      (hasBms != true || observed.hasBms == true)
  }

  static func normalizeRefloatBaseVersion(_ version: String?) -> String? {
    guard let version = version?.trimmingCharacters(in: .whitespacesAndNewlines), !version.isEmpty else {
      return nil
    }
    guard let match = version.range(of: #"\b\d+\.\d+(?:\.\d+)?\b"#, options: .regularExpression) else {
      return nil
    }
    return String(version[match])
  }
}
