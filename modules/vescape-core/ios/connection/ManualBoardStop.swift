import Foundation

/// Explicit rider stop shared by JS and App Intent entry points. The active Board id is the
/// idempotency key: `BoardSessionController.stopBoard()` succeeds only for a live session, so a
/// duplicate intent cannot repeat teardown.
///
/// A stop that a session accepted is rider intent to stop riding, so it arms the board-scoped
/// Automatic Connection Pause (ADR 0035, #406). The permanent tombstone this used to write is gone —
/// `ConnectionPauseStore` owns that decision now, with a deadline.
struct ManualBoardStop {
  let activeBoardId: () -> String?
  let stop: () -> Bool
  /// Arms the Automatic Connection Pause for the stopped Board. Returns whether one was stored.
  let armPause: (String) -> Bool

  @discardableResult
  func perform() -> Bool {
    guard let boardId = activeBoardId(), !boardId.isEmpty else { return false }
    guard stop() else { return false }
    _ = armPause(boardId)
    return true
  }
}
