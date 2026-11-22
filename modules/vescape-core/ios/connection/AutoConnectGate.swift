import Foundation

enum AutoConnectDecision: Equatable {
  case connect(boardId: String)
  case skip(reason: String)
}

enum AutoConnectGate {
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
