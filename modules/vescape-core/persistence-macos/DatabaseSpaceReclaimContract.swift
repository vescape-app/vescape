import Foundation
import GRDB

/// Database space reclaim (#686, ADR 0045) through the production GRDB migrator on a real file.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaimHostTest.kt `DatabaseSpaceReclaimHostTest`
func runDatabaseSpaceReclaimContract() throws {
  let now: Int64 = 1_000_000_000
  let gapMs: Int64 = 10 * 60_000
  let threshold = DatabaseSpaceReclaimThreshold(minFreeBytes: 1024 * 1024, minFreeFraction: 0.5)
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent("reclaim-\(UUID().uuidString)", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }

  func fresh(_ name: String) throws -> (DatabasePool, URL) {
    let url = directory.appendingPathComponent(name)
    let pool = try DatabasePool(path: url.path)
    try VescapeDatabase.migrator.migrate(pool)
    return (pool, url)
  }
  /// ~8 MB of rows, deleted again: the pages stay in the file as free pages.
  func freePages(_ pool: DatabasePool) throws {
    let blob = "\"" + String(repeating: "x", count: 8_000) + "\""
    try pool.write { db in
      for i in 0..<1_000 {
        try db.execute(sql: "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)", arguments: ["bloat.\(i)", blob, now])
      }
    }
    try pool.write { try $0.execute(sql: "DELETE FROM app_settings WHERE key LIKE 'bloat.%'") }
  }
  func markDrained(_ pool: DatabasePool) throws {
    try pool.write { try publishMaintenanceFingerprint($0, id: TELEMETRY_DRAINED_JOB_ID, fingerprint: "drained", nowMs: now) }
  }
  func reclaim(_ pool: DatabasePool, fence: DatabaseReplacementFence = DatabaseReplacementFence(), ticket: Int64? = nil,
               disk: Int64 = Int64.max, activity: BoardSessionActivity = BoardSessionActivity()) throws -> DatabaseSpaceReclaimResult {
    try reclaimDatabaseSpace(writer: { pool }, fence: fence, ticket: ticket ?? fence.ticket(), gapMs: gapMs,
                             availableDiskBytes: { disk }, nowMs: { now }, activity: activity, threshold: threshold)
  }
  func reclaimed(_ pool: DatabasePool) throws -> String? {
    try pool.read { try storedMaintenanceFingerprint($0, id: DATABASE_SPACE_RECLAIMED_JOB_ID) }
  }
  func fileSize(_ url: URL) throws -> Int64 {
    (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
  }

  // VACUUM shrinks the file once after the drain.
  let (pool, url) = try fresh("shrink.sqlite")
  try freePages(pool)
  try require(try reclaim(pool) == .skipped(reason: "not_drained"), "waits for the drained marker")
  try markDrained(pool)
  try pool.writeWithoutTransaction { try $0.execute(sql: "PRAGMA wal_checkpoint(TRUNCATE)") }
  let before = try fileSize(url)
  guard case let .reclaimed(beforeBytes, afterBytes) = try reclaim(pool) else { throw Failure(description: "reclaim did not run") }
  try require(beforeBytes > 8_000_000, "before \(beforeBytes)")
  try require(afterBytes < 1_000_000, "after \(afterBytes)")
  try require(try fileSize(url) < before / 4, "file \(try fileSize(url)) of \(before)")
  try require(try reclaimed(pool) == "reclaimed", "reclaimed marker")
  try freePages(pool)
  try require(try reclaim(pool) == .skipped(reason: "already_reclaimed"), "runs once")

  // A recording ride, low disk and few free pages skip without the marker.
  let (skipPool, _) = try fresh("skip.sqlite")
  try markDrained(skipPool)
  guard case .skipped("below_threshold", _, _) = try reclaim(skipPool) else { throw Failure(description: "below threshold") }
  try freePages(skipPool)
  guard case .skipped("low_disk", _, _) = try reclaim(skipPool, disk: 1_000_000) else { throw Failure(description: "low disk") }
  try skipPool.write { db in
    try db.execute(sql: "INSERT INTO telemetry_frames (captured_at_ms, elapsed_realtime_ms, flags, changed_mask_1, changed_mask_2) VALUES (?, 1, 0, 0, 0)",
                   arguments: [now - 1_000])
  }
  try require(try reclaim(skipPool) == .skipped(reason: "recording"), "yields to a recording ride")
  try require(try reclaimed(skipPool) == nil, "skips leave the marker unset")

  // A fenced reclaim never touches the database.
  let (fencedPool, _) = try fresh("fenced.sqlite")
  try freePages(fencedPool)
  try markDrained(fencedPool)
  let fence = DatabaseReplacementFence()
  let ticket = fence.ticket()
  fence.fence {}
  do { _ = try reclaim(fencedPool, fence: fence, ticket: ticket); throw Failure(description: "fenced reclaim ran") } catch is MaintenanceRunFenced {}
  try require(try reclaimed(fencedPool) == nil, "fenced reclaim wrote nothing")
  guard case .reclaimed = try reclaim(fencedPool, fence: fence) else { throw Failure(description: "reclaim after fence") }

  // An active Board Session refuses; one that starts mid-VACUUM interrupts it. Both leave the marker unset.
  let (sessionPool, _) = try fresh("session.sqlite")
  try freePages(sessionPool)
  try markDrained(sessionPool)
  let activity = BoardSessionActivity()
  activity.setLinked(true)
  try require(try reclaim(sessionPool, activity: activity) == .skipped(reason: "session_active"), "yields to a linked Board")
  activity.setLinked(false)
  activity.setRecording(true)
  try require(try reclaim(sessionPool, activity: activity) == .skipped(reason: "session_active"), "yields to armed recording")
  activity.setRecording(false)
  // Toggle a session on and off until one lands while the VACUUM runs.
  let toggling = ManagedAtomicFlag()
  let toggler = Thread {
    while !toggling.stopped {
      activity.setLinked(true)
      activity.setLinked(false)
    }
  }
  toggler.start()
  var interrupted = false
  for _ in 0..<200 where !interrupted {
    if case .skipped("interrupted", _, _) = try reclaim(sessionPool, activity: activity) { interrupted = true }
    try require(try reclaimed(sessionPool) == nil, "an interrupted or refused reclaim leaves the marker unset")
  }
  toggling.stop()
  try require(interrupted, "a session starting mid-VACUUM interrupts it")
  try require(try sessionPool.read { try String.fetchOne($0, sql: "PRAGMA integrity_check") } == "ok", "rolled back intact")
  while toggler.isExecuting { usleep(1_000) }
  guard case .reclaimed = try reclaim(sessionPool, activity: activity) else { throw Failure(description: "reclaim once idle") }
}

private final class ManagedAtomicFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var value = false
  var stopped: Bool { lock.withLock { value } }
  func stop() { lock.withLock { value = true } }
}
