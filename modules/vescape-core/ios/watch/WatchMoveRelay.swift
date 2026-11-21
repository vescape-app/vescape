import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMoveRelay.kt
/// @platform-diff The Android relay owns the hop onto its scheduler because Wear commands arrive on
///   a binder thread. `WCSession` hands commands to its delegate on its own queue and the caller
///   already posts to the controller's scheduler before this is touched, so `accept` is synchronous
///   here — and therefore testable without racing the scheduler it schedules the dead-man on.
final class WatchMoveRelay {
  private let scheduler: Scheduler
  private let strengthPercent: () -> Int
  private let startMove: (Int) -> Bool
  private let stopMove: () -> Bool
  private let record: (String, [String: Any?]) -> Void
  private let deadManMs: Int64

  private var direction = 0
  private var deadMan: Cancellable?

  init(
    scheduler: Scheduler,
    strengthPercent: @escaping () -> Int,
    startMove: @escaping (Int) -> Bool,
    stopMove: @escaping () -> Bool,
    record: @escaping (String, [String: Any?]) -> Void,
    deadManMs: Int64 = watchMoveDeadManMs
  ) {
    self.scheduler = scheduler
    self.strengthPercent = strengthPercent
    self.startMove = startMove
    self.stopMove = stopMove
    self.record = record
    self.deadManMs = deadManMs
  }

  func accept(_ direction: Int) {
    apply(clampWatchMoveDirection(direction))
  }

  func cancel() {
    apply(0)
  }

  private func apply(_ next: Int) {
    deadMan?.cancel()
    deadMan = nil

    if next == 0 {
      guard direction != 0 else { return }
      direction = 0
      _ = stopMove()
      record("watch_move_released", [:])
      return
    }

    let input = next * (BOARD_MOVE_INPUT_MAX * min(max(strengthPercent(), 0), 100) / 100)
    let accepted = startMove(input)
    if direction != next {
      direction = next
      record("watch_move_held", ["direction": next, "input": input, "accepted": accepted])
    }
    deadMan = scheduler.postDelayed(deadManMs) { [weak self] in self?.deadManStop() }
  }

  private func deadManStop() {
    deadMan = nil
    guard direction != 0 else { return }
    direction = 0
    _ = stopMove()
    record("watch_move_deadman_stop", [:])
  }
}
