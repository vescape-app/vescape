import Foundation

/// Turns wrist Move ticks into the same Board Move stream the phone UI drives, so a wrist press and
/// a phone press are literally the same action (ADR-0033) — reaching `BoardMoveController` through
/// `startBoardMove` / `stopBoardMove` and inheriting every gate that lives there: the trusted-link
/// check, the firmware generation's wire format and repeat cadence, and the remote-input arbiter's
/// refusal while a sensor is correcting. Strength stays a phone setting: the wrist sends a
/// direction, never an input value.
///
/// A held button arrives as a repeated tick rather than a press/release pair, and every tick re-arms
/// a dead-man. Nothing about the wrist link is trustworthy enough for press/release: the release is
/// the one message that must not be lost, and it is exactly the message a dropped link eats. Lost
/// release, wrist app exit, a dead watch and a walk out of range are one event to the phone —
/// ticks stopped — and ``watchMoveDeadManMs`` of silence is what stops the board in all four.
///
/// The dead-man runs on the phone's own scheduler, started when a tick is *received*. No wrist
/// timestamp is read: the two devices have independent clock domains, and a clock the phone does
/// not own is not a thing to gate a motor on.
///
/// Re-issuing the hold each tick is deliberate — it costs nothing (the controller's repeat loop is
/// already running and only swaps its input) and it self-heals a hold that was refused when it
/// started, e.g. a board that finished connecting mid-press.
///
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

  /// One wrist tick. `0` is the rider's release; anything else is "still holding this direction".
  func accept(_ direction: Int) {
    apply(clampWatchMoveDirection(direction))
  }

  /// Session teardown, and the only caller that is not a wrist message. It stops an active hold
  /// rather than trusting teardown order to have done it, and drops the dead-man so nothing is left
  /// scheduled against a session that is gone.
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
