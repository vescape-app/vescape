import Foundation

/// Dedicated watch tick (ADR-0013/0019): a mirror-scoped scheduler, independent of the board
/// session and poll rate, that reads the latest cold-path `WatchSnapshot` and pushes an encoded Watch
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

  private var running = false
  private var generation = 0
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
    guard !running else { return }
    running = true
    generation += 1
    schedule()
  }

  func stop() {
    running = false
    generation += 1
    handle?.cancel()
    handle = nil
  }

  /// Live-update the push cadence. Re-arms the active tick (cancel + reschedule) so a lowered
  /// interval takes effect immediately instead of waiting out the current, possibly longer, delay.
  func setIntervalMs(_ intervalMs: Int64) {
    if intervalMs == self.intervalMs { return }
    self.intervalMs = intervalMs
    if running {
      generation += 1
      handle?.cancel()
      handle = nil
      schedule()
    }
  }

  private func schedule() {
    let currentGeneration = generation
    handle = scheduler.postDelayed(intervalMs) { [weak self] in
      guard let self, running, generation == currentGeneration else { return }
      if self.canPush() {
        let frame = WatchFrameBuilder.build(snapshot: self.snapshot(), stale: self.isStale())
        self.push(WatchFrameBuilder.encode(frame))
      }
      if running, generation == currentGeneration { schedule() }
    }
  }
}
