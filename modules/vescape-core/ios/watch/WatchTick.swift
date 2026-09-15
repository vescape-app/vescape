import Foundation

/// Dedicated watch tick (ADR-0013/0019): a session-scoped scheduler, independent of the board
/// session poll rate, that reads the latest cold-path `WatchSnapshot` and pushes an encoded Watch
/// Frame at a configurable cadence. Board lanes may be empty while the session is still connecting.
///
/// Capability-gated: `canPush` is checked before building the frame, so when no Mirror is reachable
/// the tick keeps spinning but skips both encode and send.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTick.kt
final class WatchTick {
  private let scheduler: Scheduler
  private let snapshot: () -> WatchSnapshot
  private let isStale: () -> Bool
  private let canPush: () -> Bool
  private let push: (Data) -> Void

  private var handle: Cancellable?
  private var intervalMs: Int64

  init(
    scheduler: Scheduler,
    snapshot: @escaping () -> WatchSnapshot,
    isStale: @escaping () -> Bool,
    canPush: @escaping () -> Bool,
    push: @escaping (Data) -> Void,
    intervalMs: Int64
  ) {
    self.scheduler = scheduler
    self.snapshot = snapshot
    self.isStale = isStale
    self.canPush = canPush
    self.push = push
    self.intervalMs = intervalMs
  }

  func start() {
    if handle == nil { schedule() }
  }

  func stop() {
    handle?.cancel()
    handle = nil
  }

  /// Live-update the push cadence. Re-arms the active tick (cancel + reschedule) so a lowered
  /// interval takes effect immediately instead of waiting out the current, possibly longer, delay.
  func setIntervalMs(_ intervalMs: Int64) {
    if intervalMs == self.intervalMs { return }
    self.intervalMs = intervalMs
    if handle != nil {
      handle?.cancel()
      handle = nil
      schedule()
    }
  }

  private func schedule() {
    handle = scheduler.postDelayed(intervalMs) { [weak self] in
      guard let self else { return }
      if self.canPush() {
        let frame = WatchFrameBuilder.build(snapshot: self.snapshot(), stale: self.isStale())
        self.push(WatchFrameBuilder.encode(frame))
      }
      self.schedule()
    }
  }
}
