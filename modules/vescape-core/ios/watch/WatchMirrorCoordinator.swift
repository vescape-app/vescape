import Foundation

/// Active default and ambient cadence; independent of Board telemetry polling.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorCoordinator.kt `WATCH_FRAME_INTERVAL_MS`
let WATCH_FRAME_INTERVAL_MS: Int64 = 250
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorCoordinator.kt `WATCH_FRAME_AMBIENT_INTERVAL_MS`
let WATCH_FRAME_AMBIENT_INTERVAL_MS: Int64 = 5_000

/// Delivery and reachability only. The coordinator owns subscriptions, clocks, and stream lifetime.
protocol WatchMirrorTransport: AnyObject {
  var reachable: Bool { get }
  var requiresWakeReport: Bool { get }
  func start(command: @escaping (WatchCommand) -> Void)
  func stop()
  func pushFrame(_ frame: Data)
  func pushGroup(_ frame: Data)
  func pushRouteStatus(_ status: WatchRouteStatus)
  func pushSettings(_ settings: WatchSettings)
  func pushWeather(_ weather: WatchWeather)
  func pushRoute(_ payload: [String: Any])
  func pushBoard(_ board: WatchBoardLights)
}

protocol WatchMirrorSources: AnyObject {
  func routeStatus() -> WatchRouteStatus
  func subscribe(
    routeChanged: @escaping () -> Void,
    weatherChanged: @escaping (WatchWeather) -> Void,
    routePayload: @escaping ([String: Any]) -> Void
  ) -> () -> Void
}

/// Process-scoped wrist streams, independent of Board Session ownership (ADR-0033/0039).
/// Coordination state lives on the supplied scheduler, including commands arriving from WCSession.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMirrorCoordinator.kt
final class WatchMirrorCoordinator {
  private let scheduler: Scheduler
  private let nowMs: () -> Int64
  private let snapshot: () -> WatchSnapshot
  private let isStale: () -> Bool
  private let groupFrame: () -> GroupRideFrame?
  private let transport: WatchMirrorTransport
  private let sources: WatchMirrorSources
  private let command: (WatchCommand) -> Void
  private let record: (String, [String: Any?]) -> Void
  private var running = false
  private var generation = 0
  private var unsubscribe: (() -> Void)?
  private var wakeLevel: WatchMirrorWakeLevel = .asleep
  private var wakeAtMs: Int64 = 0
  private var configuredIntervalMs: Int64 = WATCH_FRAME_INTERVAL_MS
  private lazy var tick = WatchTick(
    scheduler: scheduler, snapshot: snapshot, isStale: isStale,
    canPush: { [weak self] in self?.canPush == true },
    push: { [weak self] frame in
      self?.transport.pushFrame(frame)
      self?.pushRouteStatus()
    }, intervalMs: configuredIntervalMs
  )
  private lazy var groupTick = GroupRideFrameTick(
    scheduler: scheduler,
    canPushWatchFrame: { [weak self] in self?.canPush == true },
    wakeLevel: { [weak self] in self?.effectiveWakeLevel ?? .asleep },
    frame: groupFrame,
    push: { [weak self] in self?.transport.pushGroup($0) }
  )

  init(
    scheduler: Scheduler, nowMs: @escaping () -> Int64,
    snapshot: @escaping () -> WatchSnapshot, isStale: @escaping () -> Bool,
    groupFrame: @escaping () -> GroupRideFrame?, transport: WatchMirrorTransport,
    sources: WatchMirrorSources, command: @escaping (WatchCommand) -> Void,
    record: @escaping (String, [String: Any?]) -> Void
  ) {
    self.scheduler = scheduler
    self.nowMs = nowMs
    self.snapshot = snapshot
    self.isStale = isStale
    self.groupFrame = groupFrame
    self.transport = transport
    self.sources = sources
    self.command = command
    self.record = record
  }

  func start() {
    guard !running else { return }
    running = true
    generation += 1
    let currentGeneration = generation
    transport.start { [weak self] command in
      self?.scheduler.post { [weak self] in
        guard let self, running, generation == currentGeneration else { return }
        if case .mirrorAwake(let level) = command { acceptWakeLevel(level) }
        else { self.command(command) }
      }
    }
    unsubscribe = sources.subscribe(
      routeChanged: { [weak self] in
        self?.scheduler.post { [weak self] in
          guard let self, running, generation == currentGeneration else { return }
          pushRouteStatus()
        }
      },
      weatherChanged: { [weak self] weather in
        self?.scheduler.post { [weak self] in
          guard let self, running, generation == currentGeneration else { return }
          transport.pushWeather(weather)
        }
      },
      routePayload: { [weak self] payload in
        // Navigation and the synchronous cold-state origin commit already share the main queue.
        guard let self, running, generation == currentGeneration else { return }
        transport.pushRoute(payload)
      }
    )
    tick.start()
    groupTick.start()
  }

  func stop() {
    guard running else { return }
    running = false
    generation += 1
    unsubscribe?()
    unsubscribe = nil
    tick.stop()
    groupTick.stop()
    transport.stop()
    wakeLevel = .asleep
    applyInterval()
  }

  private var effectiveWakeLevel: WatchMirrorWakeLevel {
    nowMs() - wakeAtMs > watchMirrorAwakeTimeoutMs ? .asleep : wakeLevel
  }

  private var canPush: Bool {
    running && transport.reachable && (!transport.requiresWakeReport || effectiveWakeLevel != .asleep)
  }

  func acceptWakeLevel(_ level: WatchMirrorWakeLevel) {
    let changed = level != wakeLevel
    wakeLevel = level
    wakeAtMs = nowMs()
    if changed { record("watch_mirror_wake_level", ["level": String(describing: level)]) }
    applyInterval()
  }

  func applySettings(_ settings: WatchSettings, intervalMs: Int64) {
    configuredIntervalMs = intervalMs
    applyInterval()
    transport.pushSettings(settings)
  }

  private func applyInterval() {
    tick.setIntervalMs(effectiveWakeLevel == .ambient ? WATCH_FRAME_AMBIENT_INTERVAL_MS : configuredIntervalMs)
  }

  private func pushRouteStatus() {
    if canPush { transport.pushRouteStatus(sources.routeStatus()) }
  }

  func pushBoard(_ board: WatchBoardLights) { transport.pushBoard(board) }
}
