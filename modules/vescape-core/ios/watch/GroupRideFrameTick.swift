import Foundation

/// About once a second: Rider Presence itself moves no faster (ADR-0039).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameTick.kt `GROUP_RIDE_FRAME_INTERVAL_MS`
let GROUP_RIDE_FRAME_INTERVAL_MS: Int64 = 1_000

/// The Group Ride Frame's own 1 Hz tick, beside the Watch Frame's `WatchTick` rather than inside it:
/// the two streams have their own sources and cadences (ADR-0039).
///
/// It pushes only while all three hold: the Watch Frame could be pushed at all (`canPushWatchFrame`),
/// the wrist says it is awake and not in ambient, and the Rider is joined (`frame` non-nil).
///
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
