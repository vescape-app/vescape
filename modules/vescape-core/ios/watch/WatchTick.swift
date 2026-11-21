import Foundation

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
