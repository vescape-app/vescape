import Foundation
import GRDB

func bucketPreviewFixture() throws -> [String: Any] {
  try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/bucket-route-preview-contract.json"))) as! [String: Any]
}

func bucketPreviewFixes() throws -> [RideTrackPoint] {
  let fixture = try bucketPreviewFixture()
  let board = fixture["boardId"] as! String, recording = fixture["recordingId"] as! String
  return (fixture["fixes"] as! [[NSNumber]]).map { p in
    RideTrackPoint(recordingId: recording, boardId: board, fixAtMs: p[0].int64Value,
      latitudeE7: p[1].int64Value, longitudeE7: p[2].int64Value, accuracyCm: p[3].intValue,
      gpsSpeedCentiMps: 400, bearingCentiDeg: nil, altitudeCm: nil)
  }
}

func runBucketRoutePreviewContract() throws {
  let fixture = try bucketPreviewFixture()
  let board = fixture["boardId"] as! String, recording = fixture["recordingId"] as! String
  let fixes = try bucketPreviewFixes()
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("bucket-preview-\(UUID().uuidString).db")
  defer { try? FileManager.default.removeItem(at: url) }
  var queue = try DatabaseQueue(path: url.path)
  try TelemetryDatabase.migrator.migrate(queue)
  try queue.write { db in try insertRideRecording(db, RideRecording(id: recording, boardId: board, startedAtMs: 0)) }
  func flush(_ points: [RideTrackPoint]) throws {
    try queue.write { db in
      try RecordingPersistenceSQL.insertTrackAndBuckets(db, track: points, buckets: buildTelemetryBuckets([], locationPoints: rideTrackBucketPoints(points)))
    }
  }
  try flush(Array(fixes.prefix(3)))
  try queue.read { db in
    let preview = try String.fetchOne(db, sql: "SELECT route_preview FROM telemetry_minute_buckets")!
    try require(try BucketRoutePreview.decode(preview).first!.points.count == 2, "preview first batch simplifies straight stretch")
  }
  try queue.close(); queue = try DatabaseQueue(path: url.path)
  try flush(Array(fixes.dropFirst(5)))
  try flush(Array(fixes[3..<5]))
  let rows = try queue.read { try Row.fetchAll($0, sql: "SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms") }
  let expected = fixture["expectedMinuteSegments"] as! [[[String: Any]]]
  try require(rows.count == expected.count, "preview minute count")
  for (index, bucket) in rows.enumerated() {
    let segments = try BucketRoutePreview.decode(bucket["route_preview"] as String)
    try require(segments.count == expected[index].count, "preview gap segments")
    for (i, segment) in segments.enumerated() {
      let value = expected[index][i]
      let points = (value["fixIndices"] as! [Int]).map { fixes[$0] }.map {
        BucketRoutePreview.Coordinate(latitudeE7: $0.latitudeE7, longitudeE7: $0.longitudeE7)
      }
      try require(segment.points == points, "preview original corners and loop after restart")
      try require(segment.firstAtMs == (value["firstMs"] as! NSNumber).int64Value && segment.lastAtMs == (value["lastMs"] as! NSNumber).int64Value, "preview segment endpoints")
    }
  }
  let session = try groupRideSessions(buckets: rows, markers: [], gapMs: 1_800_000).first!
  try require(session.routePoints.count == 8, "preview joined point count")
  try require(session.routePoints.enumerated().compactMap { $0.element.breakBefore ? $0.offset : nil } == [5], "preview joins minutes without bridging gaps")
  let previews = rows.map { $0["route_preview"] as String }
  let telemetry = BucketTelemetryPoint(capturedAtMs: 3000, boardId: board, recordingId: recording, speedCentiKmh: 1500,
    batteryVoltageMv: 80000, motorCurrentMa: 1000, batteryCurrentMa: 500, dutyPermille: 100, odometerCm: nil, tempMosfetDeciC: nil, tempMotorDeciC: nil)
  try queue.write { db in try RecordingPersistenceSQL.insertTrackAndBuckets(db, track: [], buckets: buildTelemetryBuckets([telemetry])) }
  func readPreviews() throws -> [String] { try queue.read { try String.fetchAll($0, sql: "SELECT route_preview FROM telemetry_minute_buckets ORDER BY bucket_start_ms") } }
  try require(try readPreviews() == previews, "telemetry-only flush preserves preview")
  _ = try TelemetryMaintenancePersistence(writer: queue).rebuild(config: MetricSanitizerConfig(), onProgress: { _, _ in })
  try require(try readPreviews() == previews, "explicit rebuild backfills original geometry")
  try queue.write { db in
    try db.execute(sql: "CREATE TRIGGER reject_preview BEFORE UPDATE OF route_preview ON telemetry_minute_buckets BEGIN SELECT RAISE(FAIL, 'preview failure'); END")
  }
  let later = RideTrackPoint(recordingId: recording, boardId: board, fixAtMs: 63000, latitudeE7: 520030000,
    longitudeE7: 180030000, accuracyCm: 500, gpsSpeedCentiMps: 400, bearingCentiDeg: nil, altitudeCm: nil)
  var failures = 0
  do { try flush([later]) } catch { failures += 1 }
  try require(failures == 1, "preview write failure propagates")
  try queue.close(); queue = try DatabaseQueue(path: url.path)
  try require(try readPreviews() == previews, "preview failure rolls back geometry")
  try queue.read { db in
    try require(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ride_track_points") == fixes.count, "preview failure rolls back raw fixes")
  }
  try queue.close()

  let straight = (0..<60).map { i in RideTrackPoint(recordingId: recording, boardId: board, fixAtMs: Int64(i * 1000), latitudeE7: -520000001,
    longitudeE7: Int64(-180000003 + i * 100), accuracyCm: 500, gpsSpeedCentiMps: 400, bearingCentiDeg: nil, altitudeCm: nil) }
  let encoded = try BucketRoutePreview.build(straight)
  let decoded = try BucketRoutePreview.decode(encoded)
  try require(decoded.first!.points == [straight.first!, straight.last!].map { BucketRoutePreview.Coordinate(latitudeE7: $0.latitudeE7, longitudeE7: $0.longitudeE7) }, "preview negative E7 codec and simplification")
  try require(encoded.utf8.count < 60, "preview compact encoding")
  print("PASS bucket-route-preview-multiple-flushes-reopen-rollback")
}

func runRecordingFlushTimerContract() throws {
  let queue = DispatchQueue(label: "flush-timer-contract")
  let timer = RecordingFlushTimer(queue: queue, delay: 0.02)
  let fired = DispatchSemaphore(value: 0)
  var events: [String] = []
  queue.sync {
    timer.schedule { events.append("cancelled") }
    timer.cancel()
    timer.schedule { events.append("first"); fired.signal() }
    timer.schedule { events.append("duplicate") }
  }
  try require(fired.wait(timeout: .now() + 2) == .success, "sparse recording timer flushes")
  queue.sync { timer.schedule { events.append("second"); fired.signal() } }
  try require(fired.wait(timeout: .now() + 2) == .success, "timer schedules the next batch")
  try queue.sync { try require(events == ["first", "second"], "timer cancels old batches and coalesces pending work") }
  print("PASS recording-flush-timer")
}
