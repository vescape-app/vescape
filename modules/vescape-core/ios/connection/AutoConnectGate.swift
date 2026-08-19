import Foundation

/// Why a launch did or did not auto-connect. The skip reasons are logged verbatim, so a device that
/// silently fails to auto-connect names its own cause instead of leaving four indistinguishable
/// early returns.
enum AutoConnectDecision: Equatable {
  case connect(boardId: String)
  case skip(reason: String)
}

/// Pure decision behind launch auto-connect: given the durable settings, the manual-stop tombstone
/// and what the launch already owns, which Board (if any) should be connected.
///
/// Split out of `BoardSessionController` so the guard set is unit-testable without a live central,
/// an `AppDataRepository` or a launch sequence — the guards are the whole behaviour of #401.
enum AutoConnectGate {
  /// - `hasLiveSession`: the coordinator already owns a Board Session (a JS reload mid-ride must
  ///   never restart it).
  /// - `resumePending`: CoreBluetooth state restoration is still expected to adopt the session that
  ///   was live when the process died (ADR 0034) — restoration wins, auto-connect stands down.
  static func decide(
    settings: [String: Any],
    suppressedBoardId: String?,
    hasLiveSession: Bool,
    resumePending: Bool
  ) -> AutoConnectDecision {
    if hasLiveSession { return .skip(reason: "session_already_live") }
    if resumePending { return .skip(reason: "state_restoration_pending") }
    guard settings["autoConnect"] as? Bool ?? true else { return .skip(reason: "auto_connect_off") }
    guard let boardId = settings["selectedBoardId"] as? String, !boardId.isEmpty else {
      return .skip(reason: "no_selected_board")
    }
    guard boardId != suppressedBoardId else { return .skip(reason: "manual_stop_tombstone") }
    return .connect(boardId: boardId)
  }
}
