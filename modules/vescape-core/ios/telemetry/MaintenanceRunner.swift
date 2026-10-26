import Foundation
import Network
import os
#if canImport(Sentry)
import Sentry
#endif

/// Startup settles before the first pass: JS, BLE and the first flushes go first.
private let maintenanceLaunchDelay: TimeInterval = 10
/// A Stepper fires one change per tap; the run restarts once the Rider stops.
private let maintenanceInputDebounce: TimeInterval = 3
private let maintenanceProgressEmitInterval: TimeInterval = 0.25
/// Open history pages re-read at most this often while chunks commit.
private let maintenanceHistoryRevisionInterval: TimeInterval = 3

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceRunner.kt `MaintenanceJobStatus`
enum MaintenanceJobStatus: String {
  /// Not checked yet this process, or stale and waiting for a ride to close or a restart.
  case pending
  case running
  case done
  case waitingForNetwork
  case failed
}

/// One job's line on the Database screen. Run history is per process; the durable truth is the
/// fingerprint alone.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceRunner.kt `MaintenanceJobState`
/// @parity /modules/vescape-core/src/index.ts `MaintenanceJobState`
struct MaintenanceJobState {
  let id: String
  var status: MaintenanceJobStatus = .pending
  var done = 0
  var total = 0
  var lastRunAtMs: Int64?
  var lastDurationMs: Int64?
  var lastError: String?

  var map: [String: Any?] {
    ["id": id, "status": status.rawValue, "done": done, "total": total,
     "lastRunAtMs": lastRunAtMs, "lastDurationMs": lastDurationMs, "lastError": lastError]
  }
}

/// Runs stale Maintenance Jobs one at a time, in declaration order, on one utility-QoS queue.
/// Every piece of state is confined to that queue; JS reads `snapshot()` and the `onChange` sink.
/// Triggers: launch, network back, an input setting change, ride closure, Restore and Clear all.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceRunner.kt `MaintenanceRunner`
final class MaintenanceRunner {
  static let shared = MaintenanceRunner()

  private static let log = Logger(subsystem: "app.vescape.core", category: "MaintenanceRunner")
  private let queue = DispatchQueue(label: "app.vescape.maintenance", qos: .utility)
  /// The pass itself runs here, so the state queue stays free to take triggers mid-run.
  private let workQueue = DispatchQueue(label: "app.vescape.maintenance.work", qos: .utility)
  private let jobs: [MaintenanceJob] = maintenanceJobs
  private let monitor = NWPathMonitor()

  private var started = false
  private var running = false
  private var rerun = false
  private var runGeneration = 0
  private var debounce: DispatchWorkItem?
  private var closureCheck: DispatchWorkItem?
  private var online = false

  private var states: [String: MaintenanceJobState]
  private var runningId: String?
  private var historyRevision = 0
  private var lastRevisionAt = Date.distantPast
  private var revisionPending = false
  private var lastProgressEmitAt = Date.distantPast

  private let publishedLock = NSLock()
  private var published: [String: Any?] = [:]
  private let sinkLock = NSLock()
  private var sink: (([String: Any?]) -> Void)?

  private init() {
    states = Dictionary(uniqueKeysWithValues: maintenanceJobs.map { ($0.id, MaintenanceJobState(id: $0.id)) })
    published = buildSnapshot()
  }

  /// JS-facing sink; called on the maintenance queue.
  var onChange: (([String: Any?]) -> Void)? {
    get { sinkLock.lock(); defer { sinkLock.unlock() }; return sink }
    set { sinkLock.lock(); sink = newValue; sinkLock.unlock() }
  }

  func snapshot() -> [String: Any?] {
    publishedLock.lock()
    defer { publishedLock.unlock() }
    return published
  }

  /// Idempotent per process: the first call arms network tracking and the launch pass.
  func start() {
    queue.async {
      guard !self.started else { return }
      self.started = true
      self.monitor.pathUpdateHandler = { [weak self] path in self?.queue.async { self?.networkChanged(path.status == .satisfied) } }
      self.monitor.start(queue: self.queue)
      self.queue.asyncAfter(deadline: .now() + maintenanceLaunchDelay) { self.triggerLocked("launch") }
    }
  }

  func trigger(_ reason: String) {
    queue.async { self.triggerLocked(reason) }
  }

  /// An input setting changed: restart any run with the new values once the Rider settles.
  func onSettingChanged(_ key: String) {
    queue.async {
      guard self.jobs.contains(where: { $0.inputKeys.contains(key) }) else { return }
      self.debounce?.cancel()
      let item = DispatchWorkItem {
        // The running chunk finishes; the next one sees the bump and stops.
        self.runGeneration += 1
        self.rerun = true
        self.triggerLocked("input:\(key)")
      }
      self.debounce = item
      self.queue.asyncAfter(deadline: .now() + maintenanceInputDebounce, execute: item)
    }
  }

  /// Restore or Clear all finished, successfully or not: re-check against the resulting database.
  func onDatabaseReplaced() { trigger("database_replaced") }

  private func triggerLocked(_ reason: String) {
    guard started else { return }
    if running { rerun = true; return }
    running = true
    breadcrumb("pass", ["reason": reason])
    workQueue.async { self.runPasses() }
  }

  private func onQueue<T>(_ block: () -> T) -> T { queue.sync(execute: block) }

  private func runPasses() {
    while true {
      let generation: Int = onQueue { rerun = false; return runGeneration }
      if RecordingStorageFailure.value() == nil {
        do {
          let settings = try AppDataRepository.shared.getSettings()
          for job in jobs { runIfStale(job, settings: settings, generation: generation) }
        } catch {
          Self.log.error("Maintenance settings read failed: \(error.localizedDescription, privacy: .public)")
        }
      }
      let again: Bool = onQueue {
        if rerun { return true }
        running = false
        return false
      }
      if !again { return }
    }
  }

  private func runIfStale(_ job: MaintenanceJob, settings: [String: Any?], generation: Int) {
    let fingerprint = maintenanceFingerprint(job, settings: settings)
    let stored: String?
    do {
      stored = try TelemetryDatabase.requirePool().read { try storedMaintenanceFingerprint($0, id: job.id) }
    } catch {
      fail(job, fingerprint: fingerprint, error: error, startedAt: Date())
      return
    }
    if stored == fingerprint {
      update(job.id) { $0.status = .done; $0.done = 0; $0.total = 0 }
      return
    }
    if job.requiresNetwork && !onQueue({ online }) {
      update(job.id) { $0.status = .waitingForNetwork }
      return
    }
    let fence = DatabaseReplacementFence.process
    let ticket = fence.ticket()
    let startedAt = Date()
    onQueue { runningId = job.id }
    update(job.id) {
      $0.status = .running; $0.done = 0; $0.total = 0
      $0.lastRunAtMs = Int64(startedAt.timeIntervalSince1970 * 1000); $0.lastError = nil
    }
    breadcrumb("start", ["job": job.id, "fingerprint": fingerprint])
    let scope = MaintenanceJobScope(
      writer: { try TelemetryDatabase.requirePool() },
      fence: fence,
      ticket: ticket,
      isCancelled: { [unowned self] in onQueue { runGeneration != generation } },
      progress: { [unowned self] done, total in progress(job.id, done: done, total: total) },
      committed: { [unowned self] in chunkCommitted() }
    )
    var status: MaintenanceJobStatus
    do {
      // The old fingerprint goes before the first chunk: a run that ends partway must leave the job
      // stale, even if the inputs change back to the ones the old fingerprint names.
      try scope.chunk { try $0.execute(sql: "DELETE FROM app_settings WHERE key = ?", arguments: [maintenanceJobKey(job.id)]) }
      switch try job.run(scope, settings: settings) {
      case .completed:
        try scope.chunk { try publishMaintenanceFingerprint($0, id: job.id, fingerprint: fingerprint, nowMs: scope.nowMs()) }
        breadcrumb("finish", ["job": job.id])
        status = .done
      case .deferred(let retryAtMs):
        breadcrumb("deferred", ["job": job.id, "retryAtMs": retryAtMs])
        scheduleClosureCheck(retryAtMs)
        status = .pending
      }
    } catch is MaintenanceRunFenced {
      breadcrumb("cancel", ["job": job.id, "reason": "database_replaced"])
      onQueue { rerun = true }
      status = .pending
    } catch is MaintenanceRunCancelled {
      breadcrumb("cancel", ["job": job.id, "reason": "restart"])
      status = .pending
    } catch {
      fail(job, fingerprint: fingerprint, error: error, startedAt: startedAt)
      return
    }
    finishRun(job.id, startedAt: startedAt) { $0.status = status }
  }

  private func fail(_ job: MaintenanceJob, fingerprint: String, error: Error, startedAt: Date) {
    Self.log.error("Maintenance Job \(job.id, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
#if canImport(Sentry)
    SentrySDK.capture(error: error) { scope in
      scope.setTag(value: job.id, key: "maintenance.job")
      scope.setExtra(value: fingerprint, key: "maintenance.fingerprint")
    }
#endif
    finishRun(job.id, startedAt: startedAt) {
      $0.status = .failed
      $0.lastError = error.localizedDescription
    }
  }

  private func finishRun(_ id: String, startedAt: Date, _ change: (inout MaintenanceJobState) -> Void) {
    onQueue {
      runningId = nil
      if var state = states[id] {
        change(&state)
        state.lastDurationMs = Int64(Date().timeIntervalSince(startedAt) * 1000)
        states[id] = state
      }
      if revisionPending { bumpHistoryRevisionLocked() }
      publishLocked()
    }
  }

  private func scheduleClosureCheck(_ retryAtMs: Int64) {
    queue.async {
      self.closureCheck?.cancel()
      let item = DispatchWorkItem { self.triggerLocked("ride_closure") }
      self.closureCheck = item
      let delay = max(0, TimeInterval(retryAtMs) / 1000 - Date().timeIntervalSince1970) + 1
      self.queue.asyncAfter(deadline: .now() + delay, execute: item)
    }
  }

  private func progress(_ id: String, done: Int, total: Int) {
    breadcrumb("chunk", ["job": id, "done": done, "total": total], log: false)
    onQueue {
      states[id]?.done = done
      states[id]?.total = total
      let now = Date()
      guard now.timeIntervalSince(lastProgressEmitAt) >= maintenanceProgressEmitInterval || done >= total else { return }
      lastProgressEmitAt = now
      publishLocked()
    }
  }

  private func chunkCommitted() {
    onQueue {
      revisionPending = true
      if Date().timeIntervalSince(lastRevisionAt) >= maintenanceHistoryRevisionInterval {
        bumpHistoryRevisionLocked()
        publishLocked()
      }
    }
  }

  private func bumpHistoryRevisionLocked() {
    revisionPending = false
    lastRevisionAt = Date()
    historyRevision += 1
  }

  private func update(_ id: String, _ change: (inout MaintenanceJobState) -> Void) {
    onQueue {
      if var state = states[id] { change(&state); states[id] = state }
      publishLocked()
    }
  }

  private func publishLocked() {
    let snapshot = buildSnapshot()
    publishedLock.lock()
    published = snapshot
    publishedLock.unlock()
    onChange?(snapshot)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceRunner.kt `buildSnapshot`
  /// @parity /modules/vescape-core/src/index.ts `MaintenanceState`
  private func buildSnapshot() -> [String: Any?] {
    ["running": runningId != nil,
     "historyRevision": historyRevision,
     "jobs": jobs.compactMap { states[$0.id]?.map }]
  }

  private func networkChanged(_ isOnline: Bool) {
    let wasOnline = online
    online = isOnline
    if isOnline && !wasOnline && jobs.contains(where: { $0.requiresNetwork }) { triggerLocked("network") }
  }

  private func breadcrumb(_ event: String, _ data: [String: Any], log: Bool = true) {
    if log {
      Self.log.info("\(event, privacy: .public) \(String(describing: data), privacy: .public)")
    } else {
      Self.log.debug("\(event, privacy: .public) \(String(describing: data), privacy: .public)")
    }
#if canImport(Sentry)
    let crumb = Breadcrumb(level: .info, category: "maintenance")
    crumb.message = event
    crumb.data = data
    SentrySDK.addBreadcrumb(crumb)
#endif
  }
}
