import Foundation

/// Hand-off between the two halves of linking: `finalizeBoardLink` proves the connect and then tears
/// its throwaway probe session down, while the Board Link is persisted later, from JS, on Save. This
/// records which Board proved a link so the persist can start the real Board Session — the ride
/// session, with the Board's own name, recording and auto-reconnect — instead of leaving the rider
/// disconnected until the next app launch.
///
/// Single-slot on purpose: only the pick the rider actually saves is worth reconnecting, and a
/// finalize for another Board replaces it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PendingLinkConnect.kt
enum PendingLinkConnect {
  private static let lock = NSLock()
  private static var boardId: String?

  static func arm(boardId: String) {
    lock.lock()
    defer { lock.unlock() }
    self.boardId = boardId
  }

  /// True once, for the Board that proved a link.
  static func consume(boardId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard self.boardId == boardId else { return false }
    self.boardId = nil
    return true
  }

  /// The rider left linking without saving: nothing proved is worth reconnecting to.
  static func clear() {
    lock.lock()
    defer { lock.unlock() }
    boardId = nil
  }
}
