import Foundation
import GRDB

@discardableResult
func rebuildRideSummaries(
  _ writer: any DatabaseWriter,
  nowMs: Int64 = Int64.max / 2,
  fence: DatabaseReplacementFence = DatabaseReplacementFence(),
  committed: @escaping () -> Void = {}
) throws -> MaintenanceJobOutcome {
  try RideSummariesJob().run(
    MaintenanceJobScope(writer: { writer }, fence: fence, ticket: fence.ticket(), nowMs: { nowMs }, committed: committed),
    settings: [:]
  )
}

/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/MaintenanceJobsHostTest.kt
func runMaintenanceJobsContract() throws {
  let minute: Int64 = 60_000
  let hour = 60 * minute
  let board = "board-a"
  func frame(_ at: Int64, speed: Int = 1_000, motorCurrentMa: Int = 1_000) -> RecordingPersistenceSQL.Frame {
    .init(capturedAtMs: at, elapsedRealtimeMs: at, boardId: board, canId: nil, flags: 1,
          changedMask1: Int.max, changedMask2: 0, speedCentiKmh: speed, batteryVoltageMv: 80_000,
          motorCurrentMa: motorCurrentMa, batteryCurrentMa: 500, dutyPermille: 100, pitchCentiDeg: 0,
          rollCentiDeg: 0, balancePitchCentiDeg: 0, balanceCurrentMa: 0, erpm: 1_000, state: 1,
          switchState: 1, adc1Milli: 0, adc2Milli: 0, odometerCm: at, tempMosfetDeciC: 300,
          tempMotorDeciC: 300)
  }
  func freshQueue() throws -> DatabaseQueue {
    let queue = try DatabaseQueue()
    try VescapeDatabase.migrator.migrate(queue)
    return queue
  }
  func insertFrames(_ queue: DatabaseQueue, _ frames: [RecordingPersistenceSQL.Frame]) throws {
    try queue.write { db in
      for frame in frames {
        try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(frame))
      }
    }
  }
  func buckets(_ queue: DatabaseQueue) throws -> [Row] {
    try queue.read { try Row.fetchAll($0, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms, board_id") }
  }
  func exclusions(_ queue: DatabaseQueue) throws -> [Row] {
    try queue.read { try Row.fetchAll($0, sql: "SELECT board_id, reason, start_ms, end_ms, sample_count FROM metric_exclusion_ranges ORDER BY start_ms, reason") }
  }

  do {
    let queue = try freshQueue()
    let edge = 10 * hour
    let spinning = (edge - 500)..<(edge + 5_000)
    try insertFrames(queue, stride(from: edge - 5 * minute, to: edge + 5 * minute, by: 500).map {
      spinning.contains($0) ? frame($0, speed: 5_000, motorCurrentMa: 1_000) : frame($0, speed: 3_000, motorCurrentMa: 20_000)
    })
    try queue.write { db in
      try insertExclusion(db, .init(boardId: board, reason: "live", startMs: edge - 90_000, endMs: edge + 90_000, sampleCount: 4))
    }
    try require(try rebuildRideSummaries(queue) == .completed, "rebuild completes")
    let first = (try buckets(queue), try exclusions(queue))
    try require(first.0.count == 10, "rebuild covers both sides of the hour edge")
    try require(first.1.contains { $0["reason"] == EXCLUSION_REASON_FREE_SPIN && ($0["start_ms"] as Int64) >= edge && ($0["start_ms"] as Int64) < edge + 10_000 },
                "free spin carries across the edge")
    try require(!first.1.contains { $0["reason"] == "live" }, "rebuild replaces both owned portions of the live range")
    try rebuildRideSummaries(queue)
    try require(try buckets(queue) == first.0 && (try exclusions(queue)) == first.1, "rebuilding twice is identical")
  }

  do {
    let queue = try freshQueue()
    let now = 100 * hour
    try insertFrames(queue, stride(from: 10 * hour, to: 10 * hour + 10 * minute, by: 5_000).map { frame($0) })
    let active = Array(stride(from: now - 3 * hour, through: now - minute, by: Int(20 * minute)))
    try insertFrames(queue, active.map { frame($0) })
    try queue.write { db in
      for bucket in buildTelemetryBuckets(active.map {
        BucketTelemetryPoint(capturedAtMs: $0, boardId: board, speedCentiKmh: 9_999, batteryVoltageMv: 80_000,
                             motorCurrentMa: 1_000, batteryCurrentMa: 500, dutyPermille: 100, odometerCm: nil,
                             tempMosfetDeciC: nil, tempMotorDeciC: nil)
      }) { try upsertBucket(db, bucket) }
    }
    func activeBuckets() throws -> [Row] { try buckets(queue).filter { ($0["bucket_start_ms"] as Int64) >= now - 3 * hour } }
    let before = try activeBuckets()
    try require(try rebuildRideSummaries(queue, nowMs: now) == .deferred(retryAtMs: active.last! + 30 * minute), "active ride defers the job")
    try require(try activeBuckets() == before, "active ride buckets untouched")
    try require(try buckets(queue).filter { ($0["bucket_start_ms"] as Int64) < now - 3 * hour }.count == 10, "closed ride rebuilt")
    try require(try rebuildRideSummaries(queue, nowMs: active.last! + 30 * minute) == .completed, "closure completes the job")
    try require(try buckets(queue).allSatisfy { ($0["max_abs_speed_centi_kmh"] as Int) != 9_999 }, "closed ride rebuilt after closure")
  }

  do {
    let queue = try freshQueue()
    try insertFrames(queue, stride(from: Int64(0), to: 3 * hour, by: Int(minute)).map { frame($0) })
    let fence = DatabaseReplacementFence()
    var chunks = 0
    try rebuildRideSummaries(queue, fence: fence) {
      chunks += 1
      // intentional-suppression: the contract asserts on the resulting buckets below.
      if chunks == 1 { _ = try? TelemetryMaintenancePersistence(writer: queue).deleteRanges([.init(startMs: hour, endMs: 2 * hour - 1)], boardId: board, allBoards: false) }
    }
    try require(try buckets(queue).allSatisfy { !(hour..<2 * hour).contains($0["bucket_start_ms"] as Int64) }, "deleted ride stays deleted")
    try require(try buckets(queue).count == 120, "the rest is rebuilt")
    var fenced = false
    do { try rebuildRideSummaries(queue, fence: fence) { fence.fence {} } } catch is MaintenanceRunFenced { fenced = true }
    try require(fenced, "a fence stops the run")
    try require(try buckets(queue).count == 120, "fenced run leaves complete history")
    try require(try queue.read { try storedMaintenanceFingerprint($0, id: RideSummariesJob().id) } == nil, "no fingerprint after a fenced run")
  }

  do {
    let queue = try freshQueue()
    try require(try rebuildRideSummaries(queue) == .completed, "empty database completes")
    let fingerprint = maintenanceFingerprint(RideSummariesJob(), settings: ["movingSpeedThresholdKmh": 2.999_999])
    try require(fingerprint == "2|moving=300", "fingerprint format \(fingerprint)")
    try queue.write { try publishMaintenanceFingerprint($0, id: RideSummariesJob().id, fingerprint: fingerprint, nowMs: 1) }
    try require(try queue.read { try storedMaintenanceFingerprint($0, id: RideSummariesJob().id) } == fingerprint, "fingerprint round trip")
    try require(maintenanceFingerprint(RideSummariesJob(), settings: ["movingSpeedThresholdKmh": 5.0]) != fingerprint, "inputs change the fingerprint")
  }
  do {
    var queue = try freshQueue()
    let fence = DatabaseReplacementFence()
    let now = 100 * 24 * hour
    let boundary = now - DIAGNOSTIC_EVENT_RETENTION_MS
    let job = maintenanceJobs.last!
    try require(job is CleanupJob, "cleanup runs last")
    func scope() -> MaintenanceJobScope {
      MaintenanceJobScope(writer: { queue }, fence: fence, ticket: fence.ticket(), nowMs: { now })
    }
    func seed() throws {
      let diagnostics = DiagnosticEventPersistence(writer: queue)
      for at in [boundary - 1, boundary, now - 1] {
        try diagnostics.insert(.init(id: nil, occurredAtMs: at, elapsedRealtimeMs: 0, eventName: "e", operation: nil,
                                    phase: nil, boardId: nil, message: nil, propertiesJson: "{}"))
      }
    }
    func runJob() throws {
      let scope = scope()
      try require(try job.hasWork(scope, settings: [:]), "cleanup is stale")
      try job.begin(scope, settings: [:])
      try require(try job.run(scope, settings: [:]) == .completed, "cleanup completes")
      try job.complete(scope, settings: [:])
      try require(try !job.hasWork(scope, settings: [:]), "cleanup completes for this launch and generation")
      let events = try DiagnosticEventPersistence(writer: queue).events(fromMs: Int64.min, toMs: Int64.max, boardId: nil, limit: 100)
      try require(events.map(\.occurredAtMs) == [now - 1, boundary], "cleanup keeps boundary and recent events")
    }
    try seed()
    try insertFrames(queue, [frame(now - minute)])
    try job.begin(scope(), settings: [:])
    try require(try job.run(scope(), settings: [:]) == .deferred(retryAtMs: now + 30 * minute), "recording defers cleanup")
    try require(try job.hasWork(scope(), settings: [:]), "deferred cleanup stays stale")
    try require(try queue.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM diagnostic_events") } == 3, "recording keeps all events")
    try queue.write { try $0.execute(sql: "DELETE FROM telemetry_frames") }
    try runJob()
    try require(try CleanupJob().hasWork(scope(), settings: [:]), "next launch reruns cleanup")
    let fingerprint = try queue.read { try storedMaintenanceFingerprint($0, id: job.id)! }
    let replacement = try freshQueue()
    fence.fence { queue = replacement }
    try queue.write { try publishMaintenanceFingerprint($0, id: job.id, fingerprint: fingerprint, nowMs: now) }
    try seed()
    try runJob()
  }

  do {
    let queue = try freshQueue()
    let now = 100 * 24 * hour
    let boundary = now - DIAGNOSTIC_EVENT_RETENTION_MS
    let diagnostics = DiagnosticEventPersistence(writer: queue)
    for at in (0..<5).map({ boundary - 1 - Int64($0) }) + [boundary, now - 1] {
      try diagnostics.insert(.init(id: nil, occurredAtMs: at, elapsedRealtimeMs: 0, eventName: "e", operation: nil,
                                   phase: nil, boardId: nil, message: nil, propertiesJson: "{}"))
    }
    func remaining() throws -> [Int64] {
      try diagnostics.events(fromMs: Int64.min, toMs: Int64.max, boardId: nil, limit: 100).map(\.occurredAtMs).sorted()
    }
    let fence = DatabaseReplacementFence()
    func scope(_ progress: @escaping (Int, Int) -> Void = { _, _ in }) -> MaintenanceJobScope {
      MaintenanceJobScope(writer: { queue }, fence: fence, ticket: fence.ticket(), nowMs: { now }, progress: progress)
    }
    var fenced = false
    do { try pruneDiagnosticEvents(scope { _, _ in fence.fence {} }, gapMs: 10 * minute, batch: 2) } catch is MaintenanceRunFenced { fenced = true }
    try require(fenced, "a fence stops the Diagnostic Event prune")
    try require(try remaining().count == 5, "fenced prune keeps the rest")
    // intentional-suppression: the contract asserts on the remaining events below.
    let started = try pruneDiagnosticEvents(scope { _, _ in _ = try? insertFrames(queue, [frame(now - minute)]) }, gapMs: 10 * minute, batch: 2)
    try require(started.deleted == 2 && started.yielded, "recording that starts mid-prune stops later batches")
    try require(try remaining().count == 3, "later batches leave the backlog untouched")
    try require(try pruneDiagnosticEvents(scope(), gapMs: 10 * minute, batch: 2).yielded, "an active ride defers the prune")
    try require(try remaining().count == 3, "deferred prune deletes nothing")
    try require(try pruneDiagnosticEvents(scope(), gapMs: 30_000, batch: 2).deleted == 1, "prune deletes the rest in batches")
    try require(try remaining() == [boundary, now - 1], "the boundary event and newer stay")

    let revQueue = try freshQueue()
    let revFence = DatabaseReplacementFence()
    let revScope = MaintenanceJobScope(writer: { revQueue }, fence: revFence, ticket: revFence.ticket(), nowMs: { now })
    try revQueue.write { db in
      try db.execute(sql: "INSERT INTO board_config_schemas (schema_hash, raw_xml, created_at) VALUES ('schema-old', '<ConfigParams/>', 1)")
      try db.execute(sql: "INSERT INTO board_config_schemas (schema_hash, raw_xml, created_at) VALUES ('schema-kept', '<ConfigParams/>', 2)")
      try db.execute(sql: "INSERT INTO board_config_schemas (schema_hash, raw_xml, created_at) VALUES ('schema-last-known', '<ConfigParams/>', 3)")
      try db.execute(sql: "INSERT INTO board_config_values (board_id, refloat_base_version, values_json, captured_at, schema_hash) VALUES ('board-a', '1.3', '{}', 10, 'schema-last-known')")
      for i in 1...4 {
        let hash = i <= 2 ? "schema-old" : "schema-kept"
        try db.execute(
          sql: "INSERT INTO board_config_revisions (board_id, refloat_version, schema_hash, package_signature, raw_config, source, changes_json, created_at) VALUES ('board-a', '1.3.0', ?, 1, ?, 'app', '[]', ?)",
          arguments: [hash, Data([UInt8(i)]), Int64(i * 100)]
        )
      }
      try db.execute(
        sql: "INSERT INTO board_config_revisions (board_id, refloat_version, schema_hash, package_signature, raw_config, source, changes_json, created_at) VALUES ('board-b', '1.3.0', 'schema-kept', 1, ?, 'external', '[]', 500)",
        arguments: [Data([9])]
      )
    }
    let pruned = try pruneBoardConfigRevisions(revScope, gapMs: 30 * minute, retainPerBoard: 2)
    try require(pruned.deletedRevisions == 2 && pruned.deletedSchemas == 1 && !pruned.yielded, "prunes old revisions and unreferenced schemas")
    try revQueue.read { db in
      let boardATimes = try Int64.fetchAll(db, sql: "SELECT created_at FROM board_config_revisions WHERE board_id = 'board-a' ORDER BY created_at DESC")
      try require(boardATimes == [400, 300], "keeps newest revisions per board")
      try require(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM board_config_revisions WHERE board_id = 'board-b'") == 1, "keeps other board revisions")
      let schemas = try String.fetchAll(db, sql: "SELECT schema_hash FROM board_config_schemas ORDER BY schema_hash")
      try require(schemas == ["schema-kept", "schema-last-known"], "deletes only unreferenced schemas")
    }
  }
}
