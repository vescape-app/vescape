import Foundation
import GRDB

/// Rebuild every ride summary the way the runner does, without fingerprint bookkeeping.
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

/// Ride summaries Maintenance Job (#605) through the production GRDB statements and fence.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/MaintenanceJobsHostTest.kt
func runMaintenanceJobsContract() throws {
  let minute: Int64 = 60_000
  let hour = 60 * minute
  let board = "board-a"
  func frame(_ at: Int64, speed: Int = 1_000) -> RecordingPersistenceSQL.Frame {
    .init(capturedAtMs: at, elapsedRealtimeMs: at, boardId: board, canId: nil, flags: 1,
          changedMask1: Int.max, changedMask2: 0, speedCentiKmh: speed, batteryVoltageMv: 80_000,
          motorCurrentMa: 1_000, batteryCurrentMa: 500, dutyPermille: 100, pitchCentiDeg: 0,
          rollCentiDeg: 0, balancePitchCentiDeg: 0, balanceCurrentMa: 0, erpm: 1_000, state: 1,
          switchState: 1, adc1Milli: 0, adc2Milli: 0, odometerCm: at, tempMosfetDeciC: 300,
          tempMotorDeciC: 300)
  }
  func fix(_ at: Int64, _ speedCentiMps: Int) -> RideTrackPoint {
    RideTrackPoint(boardId: board, fixAtMs: at, latitudeE7: 520_000_000 + at / 1_000, longitudeE7: 210_000_000,
                   accuracyCm: 500, gpsSpeedCentiMps: speedCentiMps, bearingCentiDeg: nil, altitudeCm: nil)
  }
  func freshQueue() throws -> DatabaseQueue {
    let queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
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

  // Rebuilding twice is identical across minute and hour edges, with free spin GPS context.
  do {
    let queue = try freshQueue()
    let edge = 10 * hour
    try insertFrames(queue, stride(from: edge - 5 * minute, to: edge + 5 * minute, by: 2_000).map { frame($0, speed: 3_000) })
    try queue.write { db in
      for point in [fix(edge - 3_000, 0)] + stride(from: edge + 20_000, to: edge + 4 * minute, by: 5_000).map({ fix($0, 800) }) {
        try insertRideTrackPoint(db, point)
      }
      try insertExclusion(db, .init(boardId: board, reason: "live", startMs: edge - 90_000, endMs: edge + 90_000, sampleCount: 4))
    }
    try require(try rebuildRideSummaries(queue) == .completed, "rebuild completes")
    let first = (try buckets(queue), try exclusions(queue))
    try require(first.0.count == 10, "rebuild covers both sides of the hour edge")
    try require(first.1.contains { $0["reason"] == EXCLUSION_REASON_FREE_SPIN && ($0["start_ms"] as Int64) >= edge && ($0["start_ms"] as Int64) < edge + 10_000 },
                "free spin sees the fix across the edge")
    try require(!first.1.contains { $0["reason"] == "live" }, "rebuild replaces both owned portions of the live range")
    try rebuildRideSummaries(queue)
    try require(try buckets(queue) == first.0 && (try exclusions(queue)) == first.1, "rebuilding twice is identical")
  }

  // The potentially active ride is never touched and keeps the job stale.
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

  // Deletion and fencing between chunks leave no ghosts and no fingerprint.
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

  // The fingerprint carries the version and normalized inputs, and round-trips through app_settings.
  do {
    let queue = try freshQueue()
    try require(try rebuildRideSummaries(queue) == .completed, "empty database completes")
    let fingerprint = maintenanceFingerprint(RideSummariesJob(), settings: ["movingSpeedThresholdKmh": 2.999_999])
    try require(fingerprint == "1|moving=300|freeSpinDelta=1200|freeSpinCap=1500", "fingerprint format \(fingerprint)")
    try queue.write { try publishMaintenanceFingerprint($0, id: RideSummariesJob().id, fingerprint: fingerprint, nowMs: 1) }
    try require(try queue.read { try storedMaintenanceFingerprint($0, id: RideSummariesJob().id) } == fingerprint, "fingerprint round trip")
    try require(maintenanceFingerprint(RideSummariesJob(), settings: ["freeSpinMaxSpeedDeltaKmh": 10.0]) != fingerprint, "inputs change the fingerprint")
  }
}
