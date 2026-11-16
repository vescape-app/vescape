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

  // Restart: only closed minutes newer than the newest chunk are leftovers; the backlog stays.
  let restartPath = FileManager.default.temporaryDirectory.appendingPathComponent("chunks-restart-\(UUID().uuidString).db").path
  let backlog = recording(board, from: t0 - 30 * minute, minutes: 2)
  let restartReference = try fresh()
  try seed(restartReference); try restartReference.write { try insert($0, backlog) }
  var restarted = try fresh(restartPath)
  try seed(restarted); try restarted.write { try insert($0, backlog) }
  try seal(restarted, 0...0)
  try restarted.close()
  restarted = try fresh(restartPath)
  let fence = DatabaseReplacementFence()
  let pool = restarted
  let scope = MaintenanceJobScope(writer: { pool }, fence: fence, ticket: fence.ticket(), nowMs: { t0 + 3 * minute + 30_000 })
  var failures: [TelemetryMinuteKey] = []
  try require(try sealLeftoverTelemetry(scope) { key, _ in failures.append(key) } == 2 * 2 * 120, "restart seals leftover minutes")
  try require(failures.isEmpty, "leftover seal failures")
  let backlogLeft = try restarted.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms < ?", arguments: [t0]) }
  try require(backlogLeft == backlog.count, "backlog stays in the buffer")
  try assertSameReads(restartReference, restarted, "restart")

  // Restore or Clear all fenced after the run started: no seal reaches the database.
  try restarted.write { try insert($0, recording(board, from: t0 + 4 * minute, minutes: 1)) }
  let stale = MaintenanceJobScope(writer: { pool }, fence: fence, ticket: fence.ticket(), nowMs: { t0 + 6 * minute })
  fence.fence {}
  do { _ = try sealLeftoverTelemetry(stale) { _, _ in }; throw Failure(description: "fenced seal reported success") } catch is MaintenanceRunFenced {}
  let unsealed = try restarted.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM telemetry_frames WHERE captured_at_ms >= ?", arguments: [t0 + 4 * minute]) }
  try require(unsealed == 120, "fenced seal kept its rows")

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
