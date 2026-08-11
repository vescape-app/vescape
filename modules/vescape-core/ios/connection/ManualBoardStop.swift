import Foundation

/// Explicit rider stop shared by JS and App Intent entry points. The active Board id is the
/// idempotency key: `BoardSessionController.stopBoard()` succeeds only for a live session, so a
/// duplicate intent cannot repeat teardown. The tombstone also prevents a later module bootstrap
/// from immediately auto-connecting the Board the rider just stopped.
struct ManualBoardStop {
  static let suppressedBoardKey = "vesc_manual_disconnect_auto_start_board_id"

  let defaults: UserDefaults
  let activeBoardId: () -> String?
  let stop: () -> Bool

  @discardableResult
  func perform() -> Bool {
    guard let boardId = activeBoardId(), !boardId.isEmpty else { return false }
    guard stop() else { return false }
    defaults.set(boardId, forKey: Self.suppressedBoardKey)
    return true
  }

  static func isAutoStartSuppressed(boardId: String, defaults: UserDefaults = .standard) -> Bool {
    defaults.string(forKey: suppressedBoardKey) == boardId
  }

  static func clearAutoStartSuppression(defaults: UserDefaults = .standard) {
    defaults.removeObject(forKey: suppressedBoardKey)
  }
}
