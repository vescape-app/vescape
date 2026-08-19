import Foundation

/// Pure decision behind launch auto-connect: given the durable settings, the manual-stop tombstone
/// and what the launch already owns, which Board (if any) should be connected.
///
/// Split out of `BoardSessionController` so the guard set is unit-testable without a live central,
/// an `AppDataRepository` or a launch sequence — the guards are the whole behaviour of #401.
enum AutoConnectGate {
  /// Board id to auto-connect, or `nil` when this launch must not start a session.
  ///
  /// - `hasLiveSession`: the coordinator already owns a Board Session (a JS reload mid-ride must
  ///   never restart it).
  /// - `resumePending`: CoreBluetooth state restoration is still expected to adopt the session that
  ///   was live when the process died (ADR 0034) — restoration wins, auto-connect stands down.
  static func boardToAutoConnect(
    settings: [String: Any],
    suppressedBoardId: String?,
    hasLiveSession: Bool,
    resumePending: Bool
  ) -> String? {
    guard !hasLiveSession, !resumePending else { return nil }
    guard settings["autoConnect"] as? Bool ?? true else { return nil }
    guard let boardId = settings["selectedBoardId"] as? String, !boardId.isEmpty else { return nil }
    guard boardId != suppressedBoardId else { return nil }
    return boardId
  }
}
