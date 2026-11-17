import Foundation
import GRDB

/// Telemetry Chunks (#687, ADR 0045) through the production GRDB statements: every sample reader
/// returns the same over sealed + buffered data as over the same rows left unsealed.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/TelemetryChunkStoreHostTest.kt
func runTelemetryChunkContract() throws {
  let minute: Int64 = 60_000
  let t0 = 100 * minute
  let board = "board-a"
  let owners: [String?] = [board, nil]

  /// Android's delta chain at 2 Hz, keyframe 3.5 s into each minute, temperature cleared now and
  /// then. Unmasked columns hold the carried value, so readers that take rows as full states agree.
  func recording(_ boardId: String?, from: Int64 = t0, minutes: Int = 4) -> [RecordingPersistenceSQL.Frame] {
    var temp: Int? = nil
    return (0..<(minutes * 120)).map { i in
      // iOS reads rows as full states, so the very first row anchors the chain too.
      let key = i % 120 == 7 || i == 0
      let at = from + Int64(i) * 500
      if key || i % 10 == 0 { temp = i % 20 == 0 ? nil : 300 + i }
      return .init(capturedAtMs: at, elapsedRealtimeMs: at / 2, boardId: boardId, canId: key ? 4 : nil, flags: key ? 1 : 0,
        changedMask1: key ? (1 << 17) - 1 : 1 | (i % 10 == 0 ? 1 << 15 : 0), changedMask2: 0, speedCentiKmh: i * 3,
        batteryVoltageMv: 80_000, motorCurrentMa: 1_000, batteryCurrentMa: 500, dutyPermille: 100, pitchCentiDeg: -5,
        rollCentiDeg: 7, balancePitchCentiDeg: 1, balanceCurrentMa: 0, erpm: 1_200, state: 2, switchState: 1,
        adc1Milli: 10, adc2Milli: 20, odometerCm: 5_000_000_000, tempMosfetDeciC: temp, tempMotorDeciC: 250)
    }
  }
  func fresh(_ path: String? = nil) throws -> DatabasePool {
    let pool = try DatabasePool(path: path ?? FileManager.default.temporaryDirectory.appendingPathComponent("chunks-\(UUID().uuidString).db").path)
    try VescapeDatabase.migrator.migrate(pool)
    return pool
  }
  func insert(_ db: Database, _ frames: [RecordingPersistenceSQL.Frame]) throws {
    for frame in frames { try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(frame)) }
  }
  func seed(_ pool: DatabasePool) throws {
    try pool.write { db in
      try db.execute(sql: "INSERT INTO boards (id,name,created_at) VALUES (?,'Board A',1)", arguments: [board])
      for owner in owners { try insert(db, recording(owner)) }
    }
  }
  func seal(_ pool: DatabasePool, _ minutes: ClosedRange<Int64>) throws {
    try pool.write { db in
      for m in minutes { for owner in owners { try sealTelemetryMinute(db, TelemetryMinuteKey(boardId: owner, minuteStartMs: t0 + m * minute)) } }
    }
  }
  /// Reconstructed samples of `boardId` in `[from, to]`, replayed from the preceding full state.
  func canonical(_ pool: DatabasePool, _ from: Int64, _ to: Int64, _ boardId: String?) throws -> [String] {
    try pool.read { db in
      let start = try telemetryAnchorMs(db, beforeMs: from + 1, boardId: boardId, allBoards: false) ?? from
      var values = [Int64?](repeating: nil, count: TELEMETRY_CHUNK_VALUE_COLUMNS)
      return try telemetryFrameRows(db, fromMs: start, toMs: to, boardId: boardId, allBoards: false).compactMap { row in
        reconstructTelemetryValues(&values, flags: row["flags"], changedMask1: row["changed_mask_1"],
                                   row: TELEMETRY_VALUE_COLUMN_NAMES.map { row[$0] as Int64? })
        let at: Int64 = row["captured_at_ms"]
        return at < from ? nil : "\(at):\(values.map { $0.map(String.init) ?? "-" }.joined(separator: ","))"
      }
    }
  }
  func csv(_ pool: DatabasePool, _ from: Int64, _ to: Int64, _ boardId: String?) throws -> String {
    try pool.read { db in
      var out = ""
      try RideExport.writeCsv(db, fromMs: from, toMs: to, boardId: boardId) { out += $0 }
      return out
    }
  }
  func assertSameReads(_ expected: DatabasePool, _ actual: DatabasePool, _ label: String) throws {
    let windows: [(Int64, Int64)] = [(t0, t0 + 4 * minute), (t0 + 30_000, t0 + 90_000),
      (t0 + 2 * minute + 1_000, t0 + 3 * minute), (t0 + 61_000, t0 + 61_000)]
    for owner in owners { for (from, to) in windows {
      try require(try canonical(expected, from, to, owner) == canonical(actual, from, to, owner), "\(label): samples \(owner ?? "unowned") \(from)..\(to)")
      try require(try csv(expected, from, to, owner) == csv(actual, from, to, owner), "\(label): export \(owner ?? "unowned") \(from)..\(to)")
    } }
    func summary(_ pool: DatabasePool) throws -> [String] {
      try pool.read { db in
        var out = ["\(try telemetrySampleCount(db))", "\(String(describing: try firstTelemetrySampleAt(db)))", "\(String(describing: try lastTelemetrySampleAt(db)))"]
        for at in [t0 - 1, t0 + 30_250, t0 + 59_999, t0 + 4 * minute] { out.append("\(String(describing: try firstTelemetrySampleAtOrAfter(db, at)))") }
        for at in [t0 + 30_500, t0 + 30_250, t0 + 2 * minute] { for owner in owners + ["other"] {
          out.append("\(try telemetrySampleExists(db, atMs: at, boardId: owner))")
        } }
        let every = try telemetryFrameRows(db, fromMs: t0, toMs: t0 + 4 * minute, boardId: nil, allBoards: true)
          .map { "\($0["captured_at_ms"] as Int64):\($0["board_id"] as String? ?? "")" }
        return out + every.sorted()
      }
    }
    try require(try summary(expected) == summary(actual), "\(label): summary, maintenance checks and every-Board read")
  }

  // Consecutive seals read exactly like the buffer, including deltas anchored across the boundary.
  let reference = try fresh(), sealed = try fresh()
  try seed(reference); try seed(sealed)
  try seal(sealed, 0...1)
  let buffered = try sealed.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms < ?", arguments: [t0 + 2 * minute]) }
  try require(buffered == 0, "sealed minutes leave the buffer")
  try assertSameReads(reference, sealed, "consecutive seals")
  let ids = try sealed.read { try telemetryFrameRows($0, fromMs: t0, toMs: t0 + 4 * minute, boardId: nil, allBoards: true).map { $0["id"] as Int64 } }
  try require(Set(ids).count == ids.count, "every sample has its own id")
  let bucketsBefore = try sealed.read { try Row.fetchAll($0, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms, board_id") }
  try seal(sealed, 2...3)
  let bucketsAfter = try sealed.read { try Row.fetchAll($0, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms, board_id") }
  try require(bucketsBefore == bucketsAfter, "sealing never rewrites buckets")
  try rebuildRideSummaries(reference); try rebuildRideSummaries(sealed)
  let rebuilt = try [reference, sealed].map { pool in
    try pool.read { try Row.fetchAll($0, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms, board_id") }
  }
  try require(rebuilt[0] == rebuilt[1] && !rebuilt[0].isEmpty, "ride summaries rebuild the same from chunks")

  // A limited read counts only samples in range, inside a sealed minute and just after one.
  for from in [t0 + 50_250, t0 + 2 * minute + 250] {
    let page = try sealed.read { try telemetryFrameRows($0, fromMs: from, toMs: t0 + 4 * minute, boardId: board, allBoards: false, limit: 10) }
    try require(page.map { $0["captured_at_ms"] as Int64 } == (1...10).map { from - 250 + Int64($0) * 500 }, "limited read from \(from)")
  }

  // A Board id with no boards row seals under a minted Board Tombstone instead of being dropped.
  let ghost = "board-without-row"
  let orphan = try fresh()
  try orphan.write { try insert($0, recording(ghost, minutes: 1)) }
  try orphan.write { db in
    try require(try sealTelemetryMinute(db, TelemetryMinuteKey(boardId: ghost, minuteStartMs: t0)) == 120, "unknown Board id sealed")
  }
  let ghostState = try orphan.read { db in
    try Row.fetchOne(db, sql: """
      SELECT b.deleted_at IS NOT NULL AS tombstoned, c.sample_count FROM boards b JOIN telemetry_chunks c ON c.board_key = b.key WHERE b.id = ?
      """, arguments: [ghost])
  }
  try require(ghostState?["tombstoned"] == true && ghostState?["sample_count"] == 120, "unknown Board id minted as a tombstone")

  // A late sample of a sealed minute stays readable and merges on the next seal.
  let late = recording(board, from: t0 + 250, minutes: 1)[20]
  for pool in [reference, sealed] { try pool.write { try insert($0, [late]) } }
  try assertSameReads(reference, sealed, "late sample")
  try sealed.write { db in
    try require(try sealTelemetryMinute(db, TelemetryMinuteKey(boardId: board, minuteStartMs: t0)) == 1, "late sample sealed")
  }
  try assertSameReads(reference, sealed, "late sample merged")

  // Deletes re-encode cut chunks; every surviving sample keeps the values it was recorded with.
  let truth = try Dictionary(uniqueKeysWithValues: owners.map { ($0 ?? "", try canonical(reference, t0, t0 + 4 * minute, $0)) })
  func assertSurvivors(_ label: String, _ kept: (Int64, String?) -> Bool) throws {
    for owner in owners {
      let expected = truth[owner ?? ""]!.filter { kept(Int64($0.split(separator: ":")[0])!, owner) }
      try require(try canonical(sealed, t0, t0 + 4 * minute, owner) == expected, "\(label): survivors \(owner ?? "unowned")")
    }
  }
  let maintenance = TelemetryMaintenancePersistence(writer: sealed)
  let deleted = try maintenance.deleteRanges([TelemetryTimeRange(startMs: t0 + 20_000, endMs: t0 + 80_000)], boardId: board, allBoards: false)
  try require(deleted == 121, "range delete counts sealed samples")
  let cut = { (at: Int64, owner: String?) in owner == board && (t0 + 20_000...t0 + 80_000).contains(at) }
  try assertSurvivors("partial delete") { !cut($0, $1) }
  try maintenance.clear(protectedRanges: [TelemetryTimeRange(startMs: t0 + 100_000, endMs: t0 + 130_000)])
  try assertSurvivors("favorite protection") { !cut($0, $1) && (t0 + 100_000...t0 + 130_000).contains($0) }
  _ = try maintenance.deleteBefore(t0 + 120_000)
  try assertSurvivors("delete before") { at, _ in (t0 + 120_000...t0 + 130_000).contains(at) }
  try maintenance.clear(protectedRanges: [])
  try require(try sealed.read { try telemetrySampleCount($0) } == 0, "clear all removes chunks")

  // Drain: every closed minute leaves the buffer (backlog, late sample, minutes a crash or a failed
  // seal left behind), a sealed minute merges instead of duplicating, and the open minute stays.
  let backlog = recording(board, from: t0 - 30 * minute, minutes: 2)
  let drainNow = t0 + 4 * minute
  let drainGapMs: Int64 = 500
  func leftovers(sealFirst: Bool) throws -> DatabasePool {
    let pool = try fresh()
    try seed(pool)
    try pool.write { try insert($0, backlog) }
    if sealFirst { try seal(pool, 0...0) }
    try pool.write { try insert($0, [late]) }
    return pool
  }
  func drainScope(_ pool: DatabasePool, _ fence: DatabaseReplacementFence, progress: @escaping (Int, Int) -> Void = { _, _ in }) -> MaintenanceJobScope {
    MaintenanceJobScope(writer: { pool }, fence: fence, ticket: fence.ticket(), nowMs: { drainNow }, progress: progress)
  }
  func bufferCount(_ pool: DatabasePool, _ from: Int64, _ to: Int64) throws -> Int {
    try pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms BETWEEN ? AND ?", arguments: [from, to])! }
  }
  func drainedMarker(_ pool: DatabasePool) throws -> String? {
    try pool.read { try storedMaintenanceFingerprint($0, id: "telemetryStorage") }
  }
  let drainReference = try leftovers(sealFirst: false)
  let drained = try leftovers(sealFirst: true)
  var failures: [TelemetryMinuteKey] = []
  let drainResult = try drainTelemetryBuffer(drainScope(drained, DatabaseReplacementFence()), gapMs: drainGapMs, batch: 3) { key, _ in failures.append(key) }
  try require(drainResult == TelemetryDrainResult(minutes: 7, sealedMinutes: 7, failures: 0, yielded: false), "drain result \(drainResult)")
  try require(failures.isEmpty, "drain failures")
  try require(try bufferCount(drained, Int64.min, t0 + 3 * minute - 1) == 0, "no closed minute left in the buffer")
  try require(try bufferCount(drained, t0 + 3 * minute, drainNow) == 2 * 120, "open minute untouched")
  let lateChunk = try drained.read { try Int.fetchAll($0, sql: "SELECT sample_count FROM telemetry_chunks c JOIN boards b ON b.key = c.board_key WHERE b.id = ? AND minute_start_ms = ?", arguments: [board, t0]) }
  try require(lateChunk == [121], "late sample merged, no second chunk")
  try assertSameReads(drainReference, drained, "drain")
  try require(try canonical(drainReference, 0, t0, board) == canonical(drained, 0, t0, board), "drained backlog reads")
  try require(try drainTelemetryBuffer(drainScope(drained, DatabaseReplacementFence()), gapMs: drainGapMs) { _, _ in }
    == TelemetryDrainResult(minutes: 0, sealedMinutes: 0, failures: 0, yielded: false), "second drain is a no-op")

  // A ride that may still be recording stops the drain before any write.
  let recordingPool = try fresh()
  try seed(recordingPool)
  let yielded = try drainTelemetryBuffer(drainScope(recordingPool, DatabaseReplacementFence()), gapMs: 10 * minute) { _, _ in }
  try require(yielded == TelemetryDrainResult(minutes: 6, sealedMinutes: 0, failures: 0, yielded: true), "drain yields to recording")
  try require(try bufferCount(recordingPool, Int64.min, Int64.max) == 4 * 2 * 120, "yielded drain wrote nothing")

  // Restore or Clear all fences a drain between batches: what committed stays, the next run finishes.
  let interruptedPool = try leftovers(sealFirst: false)
  let fence = DatabaseReplacementFence()
  let interrupted = drainScope(interruptedPool, fence) { done, _ in if done == 2 { fence.fence {} } }
  do { _ = try drainTelemetryBuffer(interrupted, gapMs: drainGapMs, batch: 2) { _, _ in }; throw Failure(description: "fenced drain reported success") } catch is MaintenanceRunFenced {}
  let chunksAfterFence = try interruptedPool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM telemetry_chunks") }
  try require(chunksAfterFence == 2, "only the first batch committed")
  try assertSameReads(drainReference, interruptedPool, "fenced drain")
  let resumed = try drainTelemetryBuffer(drainScope(interruptedPool, fence), gapMs: drainGapMs, batch: 2) { _, _ in }
  try require(resumed == TelemetryDrainResult(minutes: 6, sealedMinutes: 6, failures: 0, yielded: false), "resumed drain \(resumed)")
  try assertSameReads(drainReference, interruptedPool, "resumed drain")
  try require(try canonical(drainReference, 0, t0, board) == canonical(interruptedPool, 0, t0, board), "resumed backlog reads")

  // A codec failure (here an unreadable existing chunk) skips its minute; the minutes around it seal.
  let codecPool = try fresh()
  try codecPool.write { db in
    try db.execute(sql: "INSERT INTO boards (id,name,created_at) VALUES (?,'Board A',1)", arguments: [board])
    try insert(db, recording(board, from: t0 - 30 * minute, minutes: 1) + recording(nil, from: t0 - 20 * minute, minutes: 1)
      + recording(board, from: t0 - 10 * minute, minutes: 1))
    try sealTelemetryMinute(db, TelemetryMinuteKey(boardId: nil, minuteStartMs: t0 - 20 * minute))
    try db.execute(sql: "UPDATE telemetry_chunks SET payload = X'7F' WHERE board_key IS NULL")
    try insert(db, [recording(nil, from: t0 - 20 * minute + 250, minutes: 1)[20]])
  }
  var codecFailures: [TelemetryMinuteKey] = []
  let codecResult = try drainTelemetryBuffer(drainScope(codecPool, DatabaseReplacementFence()), gapMs: drainGapMs) { key, _ in codecFailures.append(key) }
  try require(codecResult == TelemetryDrainResult(minutes: 3, sealedMinutes: 2, failures: 1, yielded: false), "codec failure drain \(codecResult)")
  try require(codecFailures == [TelemetryMinuteKey(boardId: nil, minuteStartMs: t0 - 20 * minute)], "codec failure reported")
  let codecLeft = try codecPool.read { try Int64.fetchAll($0, sql: "SELECT captured_at_ms FROM telemetry_frames") }
  try require(codecLeft == [t0 - 20 * minute + 250 + 20 * 500], "only the failed minute stays buffered")

  let successPool = try fresh()
  try successPool.write { try insert($0, recording(board, from: t0 - 30 * minute, minutes: 1)) }
  let successJob = TelemetryStorageJob()
  var jobProgress: [(Int, Int)] = []
  var jobCommits = 0
  let successFence = DatabaseReplacementFence()
  let successScope = MaintenanceJobScope(writer: { successPool }, fence: successFence, ticket: successFence.ticket(),
    nowMs: { drainNow }, progress: { jobProgress.append(($0, $1)) }, committed: { jobCommits += 1 })
  let successSettings: [String: Any?] = ["rideSplitGapMinutes": 1]
  try require(try successJob.hasWork(successScope, settings: successSettings), "historic minute is work")
  try successJob.begin(successScope, settings: successSettings)
  try require(try successJob.run(successScope, settings: successSettings) == .completed, "successful seal completes job")
  try successJob.complete(successScope, settings: successSettings)
  try require(jobProgress.count == 1 && jobProgress[0].0 == 1 && jobProgress[0].1 == 1 && jobCommits == 1, "job progress and commit")
  try require(try !successJob.hasWork(successScope, settings: successSettings), "successful job stays done")

  // Registered job completes failed minutes, retries next launch and after replacement.
  let storageJob = TelemetryStorageJob()
  let storageFence = DatabaseReplacementFence()
  let storageScope = drainScope(codecPool, storageFence)
  let storageSettings: [String: Any?] = ["rideSplitGapMinutes": 1]
  try require(try storageJob.hasWork(storageScope, settings: storageSettings), "failed minute is work")
  try storageJob.begin(storageScope, settings: storageSettings)
  try require(try storageJob.run(storageScope, settings: storageSettings) == .completed, "failed minute finishes job")
  try storageJob.complete(storageScope, settings: storageSettings)
  try require(try !storageJob.hasWork(storageScope, settings: storageSettings), "failed minute does not rerun on trigger")
  try require(try TelemetryStorageJob().hasWork(storageScope, settings: storageSettings), "new launch retries failed minute")
  storageFence.fence {}
  try require(try storageJob.hasWork(drainScope(codecPool, storageFence), settings: storageSettings), "replacement retries failed minute")
  try codecPool.write { try publishMaintenanceFingerprint($0, id: "telemetryBacklogDrain", fingerprint: "drained", nowMs: drainNow) }
  _ = try storageJob.hasWork(drainScope(codecPool, storageFence), settings: storageSettings)
  try require(try codecPool.read { try storedMaintenanceFingerprint($0, id: "telemetryBacklogDrain") } == nil, "legacy marker removed")
  let openOnly = try fresh()
  try openOnly.write { try insert($0, [recording(board, from: drainNow - 500, minutes: 1)[0]]) }
  try require(try !TelemetryStorageJob().hasWork(drainScope(openOnly, DatabaseReplacementFence()), settings: storageSettings), "open minute alone is not work")

  // A minute that closes during the fixed run snapshot remains for the next drain.
  let advancing = try fresh()
  try seed(advancing)
  var advancingNow = drainNow
  let advancingFence = DatabaseReplacementFence()
  let advancingScope = MaintenanceJobScope(writer: { advancing }, fence: advancingFence, ticket: advancingFence.ticket(),
    nowMs: { advancingNow }, progress: { done, _ in if done == 2 { advancingNow += minute } })
  let advanced = try drainTelemetryBuffer(advancingScope, gapMs: drainGapMs, batch: 2) { _, _ in }
  try require(advanced == TelemetryDrainResult(minutes: 6, sealedMinutes: 6, failures: 0, yielded: false), "advancing drain \(advanced)")
  let caughtUp = try drainTelemetryBuffer(advancingScope, gapMs: drainGapMs) { _, _ in }
  try require(caughtUp == TelemetryDrainResult(minutes: 2, sealedMinutes: 2, failures: 0, yielded: false), "catch-up drain \(caughtUp)")

  // A future-dated sample (a wrong clock) is not a recording ride: the old backlog still drains.
  let futurePool = try fresh()
  try futurePool.write { try insert($0, recording(board, from: t0 - 30 * minute, minutes: 2) + [recording(board, from: drainNow + 60 * minute, minutes: 1)[7]]) }
  let future = try drainTelemetryBuffer(drainScope(futurePool, DatabaseReplacementFence()), gapMs: 10 * minute) { _, _ in }
  try require(future == TelemetryDrainResult(minutes: 2, sealedMinutes: 2, failures: 0, yielded: false), "future-dated drain \(future)")
  try require(try futurePool.read { try activeRideStartMs($0, nowMs: drainNow, gapMs: 10 * minute) } == nil, "future sample is not a ride")

  // Clear all forgets the drained marker in its own transaction, with or without protected Favorites.
  for protected in [[], [TelemetryTimeRange(startMs: t0, endMs: t0 + minute)]] {
    try drained.write { try publishMaintenanceFingerprint($0, id: "telemetryStorage", fingerprint: "drained", nowMs: drainNow) }
    try TelemetryMaintenancePersistence(writer: drained).clear(protectedRanges: protected)
    try require(try drainedMarker(drained) == nil, "clear all forgets the marker")
  }

  // An archive carries app_settings; the restored database must not inherit the drained marker.
  let archiveDir = FileManager.default.temporaryDirectory.appendingPathComponent("drained-restore-\(UUID().uuidString)", isDirectory: true)
  try FileManager.default.createDirectory(at: archiveDir, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: archiveDir) }
  let sourceURL = archiveDir.appendingPathComponent("source.sqlite")
  let source = try fresh()
  try source.write { try publishMaintenanceFingerprint($0, id: "telemetryStorage", fingerprint: "drained", nowMs: drainNow) }
  try source.write { db in
    try publishMaintenanceFingerprint(db, id: "telemetryBacklogDrain", fingerprint: "drained", nowMs: drainNow)
    try db.execute(sql: "INSERT INTO diagnostic_events (occurred_at_ms, elapsed_realtime_ms, event_name, properties_json) VALUES (1, 0, 'old', '{}')")
  }
  let sourceCopy = try DatabaseQueue(path: sourceURL.path)
  try source.backup(to: sourceCopy)
  try sourceCopy.close()
  let sourceData = try Data(contentsOf: sourceURL)
  let archive = DatabaseBackupArchive.archive(database: sourceData, manifest: try DatabaseBackupArchive.manifest(
    platform: "ios", schemaVersion: VESCAPE_DATABASE_VERSION, appVersion: "host", dbSizeBytes: Int64(sourceData.count), createdAt: 1))
  let staged = try DatabaseBackupManager.stageBackupArchive(archive, in: archiveDir)
  let restored = try VescapeDatabase.openRestoredDatabase(at: staged.database, schemaVersion: staged.roomVersion)
  try require(try drainedMarker(restored) == nil, "restore forgets the marker")

  try require(try restored.read { try storedMaintenanceFingerprint($0, id: "telemetryBacklogDrain") } == nil, "restore removes legacy marker")
  let pruneFence = DatabaseReplacementFence()
  pruneFence.fence {}
  let restoredScope = MaintenanceJobScope(writer: { restored }, fence: pruneFence, ticket: pruneFence.ticket(), nowMs: { 40 * 24 * 60 * minute })
  let cleanup = CleanupJob()
  try cleanup.begin(restoredScope, settings: [:])
  try require(try cleanup.run(restoredScope, settings: [:]) == .completed, "restored cleanup completes in same process")
  try cleanup.complete(restoredScope, settings: [:])
  try require(try restored.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM diagnostic_events") } == 0, "restored old event pruned")

  // Readers racing the sealer see every sample exactly once.
  let race = try fresh()
  try race.write { db in
    try db.execute(sql: "INSERT INTO boards (id,name,created_at) VALUES (?,'Board A',1)", arguments: [board])
    try insert(db, recording(board, minutes: 12))
  }
  let expected = recording(board, minutes: 12).map(\.capturedAtMs)
  let group = DispatchGroup()
  var sealError: Error?
  DispatchQueue.global().async(group: group) {
    do { for m in 0..<Int64(12) { try race.write { try sealTelemetryMinute($0, TelemetryMinuteKey(boardId: board, minuteStartMs: t0 + m * minute)) } } }
    catch { sealError = error }
  }
  var reads = 0
  repeat {
    let read = try race.read { try telemetryFrameRows($0, fromMs: t0, toMs: t0 + 12 * minute, boardId: board, allBoards: false).map { $0["captured_at_ms"] as Int64 } }
    try require(read == expected, "a read racing the sealer lost or duplicated a sample")
    reads += 1
  } while group.wait(timeout: .now()) == .timedOut || reads < 2
  if let sealError { throw sealError }
  let remaining = try race.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM telemetry_frames") }
  try require(remaining == 0, "every raced minute sealed")
}
