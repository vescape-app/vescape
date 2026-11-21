import Foundation

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

  static func suppressedBoardId(defaults: UserDefaults = .standard) -> String? {
    defaults.string(forKey: suppressedBoardKey)
  }

  static func isAutoStartSuppressed(boardId: String, defaults: UserDefaults = .standard) -> Bool {
    suppressedBoardId(defaults: defaults) == boardId
  }

  static func clearAutoStartSuppression(defaults: UserDefaults = .standard) {
    defaults.removeObject(forKey: suppressedBoardKey)
  }
}
