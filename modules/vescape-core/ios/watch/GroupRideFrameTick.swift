import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameTick.kt `GROUP_RIDE_FRAME_INTERVAL_MS`
let GROUP_RIDE_FRAME_INTERVAL_MS: Int64 = 1_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameTick.kt `GroupRideFrameTick`
final class GroupRideFrameTick {
  private let scheduler: Scheduler
  private let canPushWatchFrame: () -> Bool
  private let wakeLevel: () -> WatchMirrorWakeLevel
  private let frame: () -> GroupRideFrame?
  private let push: (Data) -> Void
  private var running = false
  private var generation = 0
  private var handle: Cancellable?

  init(
    scheduler: Scheduler,
    canPushWatchFrame: @escaping () -> Bool,
    wakeLevel: @escaping () -> WatchMirrorWakeLevel,
    frame: @escaping () -> GroupRideFrame?,
    push: @escaping (Data) -> Void
  ) {
    self.scheduler = scheduler
    self.canPushWatchFrame = canPushWatchFrame
    self.wakeLevel = wakeLevel
    self.frame = frame
    self.push = push
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

  private func schedule() {
    let currentGeneration = generation
    handle = scheduler.postDelayed(GROUP_RIDE_FRAME_INTERVAL_MS) { [weak self] in
      guard let self, running, generation == currentGeneration else { return }
      if self.wakeLevel() == .active, self.canPushWatchFrame(), let frame = self.frame() {
        self.push(GroupRideFrameCodec.encode(frame))
      }
      if running, generation == currentGeneration { schedule() }
    }
  }
}
