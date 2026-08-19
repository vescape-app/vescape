import Foundation

/// How long a Board Presence Scan may look for the selected Board (ADR 0035).
///
/// The window is measured from scanner readiness, never from foreground entry: Bluetooth
/// initialization must not eat the rider's five seconds.
internal let presenceScanWindowMs: Int64 = 5_000

/// One linked Board the Presence Scan is watching for.
internal struct PresenceTarget: Equatable {
  let boardId: String
  let bleId: String
  let name: String?
  let selected: Bool
}

/// A linked Board seen advertising during a Presence Scan. Non-selected Boards are observed and
/// reported but never connected — #408 turns those into advisory switch-and-connect hints.
internal struct PresenceObservation: Equatable {
  let boardId: String
  let bleId: String
  let name: String?
  let rssi: Int?
  let observedAtMs: Int64
  let selected: Bool

  var map: [String: Any?] {
    [
      "boardId": boardId,
      "bleId": bleId,
      "name": name,
      "rssi": rssi,
      "observedAt": observedAtMs,
      "selected": selected,
    ]
  }
}

/// Everything the eligibility rule needs. No CoreBluetooth types — the rule is testable as data.
internal struct PresenceScanEnvironment {
  var linkedBoardCount: Int
  var selectedBoardId: String?
  /// BLE id of the selected Board's Board Link. `nil` means selected but never linked.
  var selectedBoardBleId: String?
  var bluetoothEnabled: Bool
  var scanPermissionGranted: Bool
  var scannerAvailable: Bool
  var sessionActive: Bool
  var connectIntentActive: Bool
  /// Purpose currently holding the scanner, if any.
  var activeScanPurpose: ScanPurpose?
}

/// Everything the promotion rule needs, evaluated once the selected Board has been observed.
internal struct PresencePromotionInput {
  var selectedObserved: Bool
  var autoConnectEnabled: Bool
  /// Board-scoped Automatic Connection Pause deadline for the selected Board, or `nil` when the
  /// Board is not paused. #406 replaces the permanent manual-stop gates with this map; the rule only
  /// ever asks "is it still in the future".
  var pausedUntilMs: Int64?
  var nowMs: Int64
  var sessionActive: Bool
  /// Owner already holding the connection, if any. Auto Connect is the weakest real owner.
  var currentOwner: ConnectionOwner
}

/// A named outcome. `proceed` is the only non-terminal one; the rest carry a rider-visible reason.
internal struct PresenceScanDecision: Equatable {
  let proceed: Bool
  let decision: String
  let reason: String?
}

/// Pure policy behind the Board Presence Scan (ADR 0035): may it run, and may an observation of the
/// selected Board promote into a Board Session. Kept free of platform types so both platforms can
/// assert identical external behavior, and so later slices (#406 pause, #407 Auto Start, #408 hints)
/// arbitrate against one rule instead of re-deriving it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PresenceScanPolicy.kt
internal enum PresenceScanPolicy {
  /// Distinct named reasons, in the order the rider would care about them: work already owning the
  /// connection first, then missing configuration, then a radio that cannot answer.
  static func evaluate(_ environment: PresenceScanEnvironment) -> PresenceScanDecision {
    if environment.sessionActive { return skipped(ConnectionTraceReason.sessionAlreadyActive) }
    if environment.connectIntentActive { return skipped(ConnectionTraceReason.connectIntentActive) }
    if let active = environment.activeScanPurpose, active.isExclusive {
      return skipped(ConnectionTraceReason.scannerBusy)
    }
    if environment.linkedBoardCount <= 0 { return skipped(ConnectionTraceReason.noLinkedBoards) }
    if (environment.selectedBoardId ?? "").isEmpty { return skipped(ConnectionTraceReason.noSelectedBoard) }
    if (environment.selectedBoardBleId ?? "").isEmpty { return skipped(ConnectionTraceReason.noBoardLink) }
    if !environment.scanPermissionGranted { return skipped(ConnectionTraceReason.permissionMissing) }
    if !environment.bluetoothEnabled { return skipped(ConnectionTraceReason.bluetoothDisabled) }
    if !environment.scannerAvailable { return skipped(ConnectionTraceReason.scannerUnavailable) }
    if let active = environment.activeScanPurpose, active != .presence {
      return skipped(ConnectionTraceReason.scannerBusy)
    }
    return PresenceScanDecision(proceed: true, decision: ConnectionTraceDecision.granted, reason: nil)
  }

  /// Whether an observed selected Board may become a Board Session.
  static func promotion(_ input: PresencePromotionInput) -> PresenceScanDecision {
    if input.sessionActive { return denied(ConnectionTraceReason.sessionAlreadyActive) }
    if input.currentOwner != .none, input.currentOwner != .autoConnect,
      !ConnectionOwner.autoConnect.outranks(input.currentOwner)
    {
      return denied(ownerReason(input.currentOwner))
    }
    if !input.selectedObserved {
      return PresenceScanDecision(
        proceed: false,
        decision: ConnectionTraceDecision.timeout,
        reason: ConnectionTraceReason.boardNotPresent
      )
    }
    if isPaused(pausedUntilMs: input.pausedUntilMs, nowMs: input.nowMs) {
      return skipped(ConnectionTraceReason.connectionPaused)
    }
    if !input.autoConnectEnabled { return skipped(ConnectionTraceReason.autoConnectDisabled) }
    return PresenceScanDecision(
      proceed: true,
      decision: ConnectionTraceDecision.granted,
      reason: ConnectionTraceReason.matched
    )
  }

  /// Deadline for a scan whose radio became usable at `readyAtMs`.
  static func deadlineAt(readyAtMs: Int64, windowMs: Int64 = presenceScanWindowMs) -> Int64 {
    readyAtMs + windowMs
  }

  static func isPaused(pausedUntilMs: Int64?, nowMs: Int64) -> Bool {
    guard let pausedUntilMs else { return false }
    return pausedUntilMs > nowMs
  }

  private static func ownerReason(_ owner: ConnectionOwner) -> String {
    switch owner {
    case .boardSession: return ConnectionTraceReason.sessionAlreadyActive
    case .connectIntent: return ConnectionTraceReason.connectIntentActive
    case .addBoardScan, .boardProbe: return ConnectionTraceReason.scannerBusy
    default: return ConnectionTraceReason.higherPriorityOwner
    }
  }

  private static func skipped(_ reason: String) -> PresenceScanDecision {
    PresenceScanDecision(proceed: false, decision: ConnectionTraceDecision.skipped, reason: reason)
  }

  private static func denied(_ reason: String) -> PresenceScanDecision {
    PresenceScanDecision(proceed: false, decision: ConnectionTraceDecision.denied, reason: reason)
  }
}
