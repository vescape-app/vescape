import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MaintenanceJob`
protocol MaintenanceJob {
  var id: String { get }
  var version: Int { get }
  var requiresNetwork: Bool { get }
  var inputKeys: Set<String> { get }

  func inputs(_ settings: [String: Any?]) -> String

  func run(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> MaintenanceJobOutcome

  func hasWork(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> Bool

  func begin(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws

  func complete(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws
}

extension MaintenanceJob {
  func hasWork(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> Bool {
    try scope.chunk { try storedMaintenanceFingerprint($0, id: id) } != maintenanceFingerprint(self, settings: settings)
  }

  func begin(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {
    try scope.chunk { try $0.execute(sql: "DELETE FROM app_settings WHERE key = ?", arguments: [maintenanceJobKey(id)]) }
  }

  func complete(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {
    let fingerprint = maintenanceFingerprint(self, settings: settings)
    let nowMs = scope.nowMs()
    try scope.chunk { try publishMaintenanceFingerprint($0, id: id, fingerprint: fingerprint, nowMs: nowMs) }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MaintenanceJobOutcome`
enum MaintenanceJobOutcome: Equatable {
  case completed
  case deferred(retryAtMs: Int64)
}

struct MaintenanceRunFenced: Error {}

struct MaintenanceRunCancelled: Error {}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MaintenanceHttpResponse`
struct MaintenanceHttpResponse {
  let status: Int
  let body: Data?
  let retryAfterSeconds: Int64?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MaintenanceHttp`
protocol MaintenanceHttp {
  func get(_ url: String, isCancelled: @escaping () -> Bool) throws -> MaintenanceHttpResponse
}

struct NoMaintenanceHttp: MaintenanceHttp {
  func get(_ url: String, isCancelled: @escaping () -> Bool) throws -> MaintenanceHttpResponse {
    throw URLError(.notConnectedToInternet)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MaintenanceJobScope`
final class MaintenanceJobScope {
  private let writer: () throws -> any DatabaseWriter
  private let fence: DatabaseReplacementFence
  let ticket: Int64
  let isCancelled: () -> Bool
  let nowMs: () -> Int64
  let progress: (Int, Int) -> Void
  let committed: () -> Void
  let sealFailure: (TelemetryMinuteKey, Error) -> Void
  let diagnostic: (String, [String: Any?]) -> Void
  let http: MaintenanceHttp

  init(
    writer: @escaping () throws -> any DatabaseWriter,
    fence: DatabaseReplacementFence,
    ticket: Int64,
    isCancelled: @escaping () -> Bool = { false },
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
    progress: @escaping (Int, Int) -> Void = { _, _ in },
    committed: @escaping () -> Void = {},
    sealFailure: @escaping (TelemetryMinuteKey, Error) -> Void = { _, _ in },
    diagnostic: @escaping (String, [String: Any?]) -> Void = { _, _ in },
    http: MaintenanceHttp = NoMaintenanceHttp()
  ) {
    self.writer = writer
    self.fence = fence
    self.ticket = ticket
    self.isCancelled = isCancelled
    self.nowMs = nowMs
    self.progress = progress
    self.committed = committed
    self.sealFailure = sealFailure
    self.diagnostic = diagnostic
    self.http = http
  }

  func chunk<T>(_ block: (Database) throws -> T) throws -> T {
    if isCancelled() { throw MaintenanceRunCancelled() }
    guard let box = try fence.write(ticket: ticket, { try [writer().write(block)] }) else {
      throw MaintenanceRunFenced()
    }
    return box[0]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `fingerprint`
func maintenanceFingerprint(_ job: MaintenanceJob, settings: [String: Any?]) -> String {
  "\(job.version)|\(job.inputs(settings))"
}

let MAINTENANCE_JOB_KEY_PREFIX = "maintenanceJob."

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `maintenanceJobKey`
func maintenanceJobKey(_ id: String) -> String { MAINTENANCE_JOB_KEY_PREFIX + id }

func storedMaintenanceFingerprint(_ db: Database, id: String) throws -> String? {
  guard let json = try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key = ?", arguments: [maintenanceJobKey(id)]),
        let data = json.data(using: .utf8)
  else { return nil }
  // intentional-suppression: an unreadable fingerprint is a stale job, which re-runs and rewrites it.
  return (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) as? String
}

func publishMaintenanceFingerprint(_ db: Database, id: String, fingerprint: String, nowMs: Int64) throws {
  let data = try JSONSerialization.data(withJSONObject: fingerprint, options: .fragmentsAllowed)
  try db.execute(
    sql: "INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    arguments: [maintenanceJobKey(id), String(decoding: data, as: UTF8.self), nowMs]
  )
}

/// @parity /src/modules/settings/lib/maintenance.ts `MaintenanceJobId`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MAINTENANCE_JOBS`
let maintenanceJobs: [MaintenanceJob] = [TelemetryStorageJob(), RideSummariesJob(), RideWeatherJob.shared, CleanupJob()]

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `RideSummariesJob`
struct RideSummariesJob: MaintenanceJob {
  let id = "rideSummaries"
  let version = 2
  let requiresNetwork = false
  let inputKeys: Set<String> = [
    "movingSpeedThresholdKmh",
    "avgSpeedCutoffKmh",
    "movingAvgSpeedThresholdKmh",
  ]

  func inputs(_ settings: [String: Any?]) -> String {
    "moving=\(MetricSanitizerConfig.from(settings: settings).movingSpeedThresholdCentiKmh)"
  }

  func run(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> MaintenanceJobOutcome {
    let config = MetricSanitizerConfig.from(settings: settings)
    let gapMs = Int64(telemetryInt(settings["rideSplitGapMinutes"] ?? nil) ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
    guard let start = try scope.chunk({ try rideSummariesStartMs($0) }) else { return .completed }
    let context = RideSummariesContext()
    var from = start
    while true {
      let nowMs = scope.nowMs()
      switch try scope.chunk({ try rebuildRideSummariesChunk($0, fromMs: from, context: context, config: config, gapMs: gapMs, nowMs: nowMs) }) {
      case .finished:
        return .completed
      case .activeRide(let retryAtMs):
        return .deferred(retryAtMs: retryAtMs)
      case .rebuilt(let toMs, let endMs):
        scope.committed()
        scope.progress(hours(toMs - start), hours(endMs - start))
        from = toMs
      }
    }
  }

  private func hours(_ spanMs: Int64) -> Int { Int((spanMs + RIDE_SUMMARIES_CHUNK_MS - 1) / RIDE_SUMMARIES_CHUNK_MS) }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `TelemetryStorageJob`
/// @parity /src/modules/settings/lib/maintenance.ts `MaintenanceJobId`
struct TelemetryStorageJob: MaintenanceJob {
  let id = "telemetryStorage"
  let version = 1
  let requiresNetwork = false
  let inputKeys: Set<String> = []
  private let completion = LaunchMaintenanceCompletion()
  func inputs(_ settings: [String: Any?]) -> String { "" }

  func hasWork(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> Bool {
    try scope.chunk { db in
      try db.execute(sql: "DELETE FROM app_settings WHERE key = 'maintenanceJob.telemetryBacklogDrain'")
      return try storedMaintenanceFingerprint(db, id: id) != completion(scope) &&
        Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM telemetry_frames WHERE captured_at_ms < ? LIMIT 1)",
                      arguments: [telemetryDrainCutoffMs(scope.nowMs())]) == true
    }
  }

  func begin(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {
    try scope.chunk { try $0.execute(sql: "DELETE FROM app_settings WHERE key = ?", arguments: [maintenanceJobKey(id)]) }
  }

  func complete(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {
    try scope.chunk { try publishMaintenanceFingerprint($0, id: id, fingerprint: completion(scope), nowMs: scope.nowMs()) }
  }

  func run(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> MaintenanceJobOutcome {
    let started = DispatchTime.now().uptimeNanoseconds
    let gapMs = Int64(telemetryInt(settings["rideSplitGapMinutes"] ?? nil) ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
    let result = try drainTelemetryBuffer(scope, gapMs: gapMs, onFailure: scope.sealFailure)
    if result.minutes > 0 {
      scope.diagnostic("telemetry_drain", [
        "operation": "telemetry_drain", "minutes": result.minutes,
        "sealed_minutes": result.sealedMinutes, "failures": result.failures,
        "yielded": result.yielded, "duration_ms": (DispatchTime.now().uptimeNanoseconds - started) / 1_000_000,
      ])
    }
    return result.yielded ? .deferred(retryAtMs: scope.nowMs() + gapMs) : .completed
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `LaunchMaintenanceCompletion`
private struct LaunchMaintenanceCompletion {
  private let launch = UUID().uuidString
  func callAsFunction(_ scope: MaintenanceJobScope) -> String { "\(launch)|\(scope.ticket)" }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `CLEANUP_STEPS`
private let CLEANUP_STEPS: [(MaintenanceJobScope, Int64) throws -> MaintenanceJobOutcome] = [
  { scope, gapMs in
    let result = try pruneDiagnosticEvents(scope, gapMs: gapMs)
    if result.deleted > 0 { scope.diagnostic("diagnostic_prune", ["deleted": result.deleted]) }
    return result.yielded ? .deferred(retryAtMs: scope.nowMs() + gapMs) : .completed
  },
]

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `CleanupJob`
/// @parity /src/modules/settings/lib/maintenance.ts `MaintenanceJobId`
struct CleanupJob: MaintenanceJob {
  let id = "cleanup"
  let version = 1
  let requiresNetwork = false
  let inputKeys: Set<String> = []
  private let completion = LaunchMaintenanceCompletion()
  func inputs(_ settings: [String: Any?]) -> String { "" }

  func hasWork(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> Bool {
    try scope.chunk { try storedMaintenanceFingerprint($0, id: id) } != completion(scope)
  }

  func complete(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws {
    try scope.chunk { try publishMaintenanceFingerprint($0, id: id, fingerprint: completion(scope), nowMs: scope.nowMs()) }
  }

  func run(_ scope: MaintenanceJobScope, settings: [String: Any?]) throws -> MaintenanceJobOutcome {
    let gapMs = Int64(telemetryInt(settings["rideSplitGapMinutes"] ?? nil) ?? DEFAULT_RIDE_SPLIT_GAP_MINUTES) * 60_000
    var failure: Error?
    for (index, step) in CLEANUP_STEPS.enumerated() {
      do {
        let outcome = try step(scope, gapMs)
        if case .deferred = outcome { return outcome }
      } catch {
        if error is MaintenanceRunFenced || error is MaintenanceRunCancelled || error is DatabaseError { throw error }
        scope.diagnostic("cleanup_step_failed", ["step": index, "message": error.localizedDescription])
        if failure == nil { failure = error }
      }
    }
    if let failure { throw failure }
    return .completed
  }
}
