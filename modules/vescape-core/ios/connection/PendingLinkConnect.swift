import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PendingLinkConnect.kt
enum PendingLinkConnect {
  private static let lock = NSLock()
  private static var boardId: String?

  static func arm(boardId: String) {
    lock.lock()
    defer { lock.unlock() }
    self.boardId = boardId
  }

  static func consume(boardId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard self.boardId == boardId else { return false }
    self.boardId = nil
    return true
  }

  static func clear() {
    lock.lock()
    defer { lock.unlock() }
    boardId = nil
  }
}
