import Foundation
import GRDB

struct Failure: Error, CustomStringConvertible {
  let description: String
}

// The production repositories' default app adapter is not used by this host runner.
final class AppDataRepository {
  static let shared = AppDataRepository()
  func getSettings() -> [String: Any?] { [:] }
}

func telemetryInt(_ raw: Any?) -> Int? { (raw as? NSNumber)?.intValue }
func telemetryLong(_ raw: Any?) -> Int64? { (raw as? NSNumber)?.int64Value }

let started = Date()
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let fixtureURL = root.appendingPathComponent("shared/recording-persistence-contract.json")
let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as! [String: Any]
let samples = fixture["samples"] as! [[String: Any]]
let expected = fixture["expected"] as! [String: Any]
let boardId = fixture["boardId"] as! String
try require(fixture["scenario"] as? String == "moving-recording-close-reopen", "unknown scenario")
let databaseURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-contract-\(UUID().uuidString).db")
func int(_ value: Any?) -> Int { (value as! NSNumber).intValue }
let points = samples.map { sample in
  BucketTelemetryPoint(
    capturedAtMs: Int64(int(sample["capturedAtMs"])), boardId: boardId,
    speedCentiKmh: int(sample["speedCentiKmh"]), batteryVoltageMv: int(sample["batteryVoltageMv"]),
    motorCurrentMa: 5_000, batteryCurrentMa: 2_000, dutyPermille: 200,
    odometerCm: Int64(int(sample["odometerCm"])), tempMosfetDeciC: 300, tempMotorDeciC: 350,
    gpsSpeedCentiMps: nil, gpsTimestampMs: nil, gpsAccuracyCm: nil, latitudeE7: nil,
    longitudeE7: nil, bearingCentiDeg: nil, altitudeCm: nil, preciseGps: false
  )
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw Failure(description: message) }
}

var queue: DatabaseQueue? = try DatabaseQueue(path: databaseURL.path)
try TelemetryDatabase.migrator.migrate(queue!)
try queue!.write { db in
  var malformed = RecordingPersistenceSQL.insertFrame
  malformed.replace("?)", with: "?, ?)", maxReplacements: 1)
  do {
    try db.execute(sql: malformed, arguments: StatementArguments(Array(repeating: DatabaseValue.null, count: 31)))
    throw Failure(description: "original malformed frame insert unexpectedly succeeded")
  } catch is DatabaseError {}

  var malformedBucket = RecordingPersistenceSQL.upsertBucket
  malformedBucket.replace("?)", with: "?, ?)", maxReplacements: 1)
  do {
    try db.execute(sql: malformedBucket, arguments: StatementArguments(Array(repeating: DatabaseValue.null, count: 26)))
    throw Failure(description: "original malformed bucket insert unexpectedly succeeded")
  } catch is DatabaseError {}

  for sample in samples {
    let frame = RecordingPersistenceSQL.Frame(
      capturedAtMs: Int64(int(sample["capturedAtMs"])), elapsedRealtimeMs: Int64(int(sample["elapsedRealtimeMs"])),
      boardId: boardId, canId: nil, flags: 1, changedMask1: Int.max, changedMask2: 1,
      speedCentiKmh: int(sample["speedCentiKmh"]), batteryVoltageMv: int(sample["batteryVoltageMv"]),
      motorCurrentMa: 5000, batteryCurrentMa: 2000, dutyPermille: 200, pitchCentiDeg: 0,
      rollCentiDeg: 0, balancePitchCentiDeg: 0, balanceCurrentMa: 0, erpm: 1000, state: 1,
      switchState: 2, adc1Milli: 1000, adc2Milli: 1000, odometerCm: Int64(int(sample["odometerCm"])),
      tempMosfetDeciC: 300, tempMotorDeciC: 350, latitudeE7: nil, longitudeE7: nil,
      gpsSpeedCentiMps: nil, bearingCentiDeg: nil, accuracyCm: nil, altitudeCm: nil, locationTimestampMs: nil
    )
    try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(frame))
  }
  for bucket in buildTelemetryBuckets(points) {
    try db.execute(sql: RecordingPersistenceSQL.upsertBucket, arguments: RecordingPersistenceSQL.bucketArguments(bucket))
  }
}
try queue!.close()
queue = try DatabaseQueue(path: databaseURL.path)
try queue!.read { db in
  let frameCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_frames")
  try require(frameCount == expected["frameCount"] as? Int, "frame count")
  let bucketCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_minute_buckets")
  try require(bucketCount == expected["bucketCount"] as? Int, "bucket count")
  let row = try Row.fetchOne(db, sql: "SELECT * FROM telemetry_minute_buckets")!
  try require(row["sample_count"] as Int == expected["sampleCount"] as! Int, "ride sample count")
  try require(row["first_sample_at_ms"] as Int == expected["rideStartAtMs"] as! Int, "ride start")
  try require(row["last_sample_at_ms"] as Int == expected["rideEndAtMs"] as! Int, "ride end")
  try require(row["moving_speed_sample_count"] as Int == int(expected["movingSampleCount"]), "moving count")
  try require(row["sum_moving_abs_speed_centi_kmh"] as Int == int(expected["sumMovingSpeedCentiKmh"]), "moving speed sum")
  try require(row["max_abs_speed_centi_kmh"] as Int == int(expected["maxSpeedCentiKmh"]), "max speed")
  try require(row["min_battery_voltage_mv"] as Int == int(expected["minBatteryVoltageMv"]), "min voltage")
  try require(row["first_odometer_cm"] as Int == int(expected["firstOdometerCm"]), "first odometer")
  try require(row["last_odometer_cm"] as Int == int(expected["lastOdometerCm"]), "last odometer")
}
try queue!.close()
try FileManager.default.removeItem(at: databaseURL)

let historyFixtureURL = root.appendingPathComponent("shared/history-read-contract.json")
let historyFixture = try JSONSerialization.jsonObject(with: Data(contentsOf: historyFixtureURL)) as! [String: Any]
try require(historyFixture["scenario"] as? String == "precomputed-history-reads", "unknown history scenario")
let historyExpected = historyFixture["expected"] as! [String: Any]
let gapMs = Int64(int(historyFixture["gapMs"]))
let historyURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-history-\(UUID().uuidString).db")
let historyPool = try DatabasePool(path: historyURL.path)
try TelemetryDatabase.migrator.migrate(historyPool)
let history = RideHistoryRepository(poolProvider: { historyPool }, gapMsProvider: { gapMs })
let profile = ProfileStatsRepository(poolProvider: { historyPool }, gapMsProvider: { gapMs })
let emptyPage = try history.getPage(["limit": int(historyFixture["pageSize"])])
try require((emptyPage["sessions"] as! [[String: Any?]]).count == int(historyExpected["emptySessionCount"]), "empty history")
let emptyStats = try profile.getProfileStatsSnapshot([:])
try require((emptyStats["total"] as! [String: Any?])["rideCount"] as! Int == int(historyExpected["emptyRideCount"]), "empty profile")

let current = buildTelemetryBuckets(points).first!
let nextPoints = samples.map { sample in
  BucketTelemetryPoint(
    capturedAtMs: Int64(int(sample["capturedAtMs"])) + 60_000, boardId: boardId,
    speedCentiKmh: int(sample["speedCentiKmh"]), batteryVoltageMv: int(sample["batteryVoltageMv"]),
    motorCurrentMa: 5_000, batteryCurrentMa: 2_000, dutyPermille: 200,
    odometerCm: Int64(int(sample["odometerCm"])) + 100, tempMosfetDeciC: 300, tempMotorDeciC: 350,
    gpsSpeedCentiMps: nil, gpsTimestampMs: nil, gpsAccuracyCm: nil, latitudeE7: nil,
    longitudeE7: nil, bearingCentiDeg: nil, altitudeCm: nil, preciseGps: false
  )
}
let currentNext = buildTelemetryBuckets(nextPoints).first!
let offset = Int64(int(historyFixture["olderRideOffsetMs"]))
let olderPoints = samples.map { sample in
  BucketTelemetryPoint(
    capturedAtMs: Int64(int(sample["capturedAtMs"])) - offset, boardId: boardId,
    speedCentiKmh: int(sample["speedCentiKmh"]), batteryVoltageMv: int(sample["batteryVoltageMv"]),
    motorCurrentMa: 5_000, batteryCurrentMa: 2_000, dutyPermille: 200,
    odometerCm: Int64(int(sample["odometerCm"])), tempMosfetDeciC: 300, tempMotorDeciC: 350,
    gpsSpeedCentiMps: nil, gpsTimestampMs: nil, gpsAccuracyCm: nil, latitudeE7: nil,
    longitudeE7: nil, bearingCentiDeg: nil, altitudeCm: nil, preciseGps: false
  )
}
let older = buildTelemetryBuckets(olderPoints).first!
try historyPool.write { db in
  for bucket in [current, currentNext, older] {
    try db.execute(sql: RecordingPersistenceSQL.upsertBucket, arguments: RecordingPersistenceSQL.bucketArguments(bucket))
  }
}
let firstPage = try history.getPage(["limit": int(historyFixture["pageSize"])])
try require((firstPage["sessions"] as! [[String: Any?]]).count == int(historyExpected["firstPageSessionCount"]), "first page count")
try require(firstPage["hasMore"] as? Bool == historyExpected["firstPageHasMore"] as? Bool, "first page hasMore")
let currentSession = (firstPage["sessions"] as! [[String: Any?]]).first!
try require(currentSession["startAtMs"] as? Int64 == Int64(int(historyExpected["currentStartAtMs"])), "current start")
try require(currentSession["endAtMs"] as? Int64 == Int64(int(historyExpected["currentEndAtMs"])), "current end")
try require(currentSession["sampleCount"] as? Int == int(historyExpected["currentSampleCount"]), "current samples")
try require(currentSession["distanceM"] as? Double == historyExpected["currentDistanceM"] as? Double, "current distance")
let secondPage = try history.getPage(["limit": int(historyFixture["pageSize"]), "cursorBeforeMs": firstPage["nextCursorBeforeMs"] as Any])
try require((secondPage["sessions"] as! [[String: Any?]]).count == int(historyExpected["secondPageSessionCount"]), "second page count")
try require(secondPage["hasMore"] as? Bool == historyExpected["secondPageHasMore"] as? Bool, "second page hasMore")
try require((secondPage["sessions"] as! [[String: Any?]]).first?["startAtMs"] as? Int64 == older.firstSampleAtMs, "older ride")
let populatedStats = try profile.getProfileStatsSnapshot([:])
let total = populatedStats["total"] as! [String: Any?]
try require(total["rideCount"] as! Int == int(historyExpected["profileRideCount"]), "profile ride count")
try require(total["rideTimeMs"] as! Int64 == Int64(int(historyExpected["profileRideTimeMs"])), "profile ride time")
try require(total["distanceM"] as? Double == historyExpected["profileDistanceM"] as? Double, "profile distance")
try require(total["topSpeedKmh"] as? Double == historyExpected["profileTopSpeedKmh"] as? Double, "profile top speed")
try require(total["avgSpeedKmh"] as? Double == historyExpected["profileAvgSpeedKmh"] as? Double, "profile average speed")
try require((populatedStats["months"] as! [[String: Int]]).count == int(historyExpected["profileMonthCount"]), "profile months")
let selectedMonth = populatedStats["selectedMonth"] as! [String: Int]
try require(selectedMonth["year"] == int(historyExpected["selectedYear"]), "selected year")
try require(selectedMonth["month"] == int(historyExpected["selectedMonth"]), "selected month")
try historyPool.write { db in try db.drop(table: "telemetry_minute_buckets") }
do { _ = try history.getPage([:]); throw Failure(description: "history query failure became empty") } catch is DatabaseError {}
do { _ = try profile.getProfileStatsSnapshot([:]); throw Failure(description: "profile query failure became empty") } catch is DatabaseError {}
try historyPool.close()
try FileManager.default.removeItem(at: historyURL)
print("recording-contract macOS runtimeMs=\(Int(Date().timeIntervalSince(started) * 1000)) scenario=\(fixture["scenario"]!)")

private extension String {
  mutating func replace(_ target: String, with replacement: String, maxReplacements: Int) {
    guard maxReplacements > 0, let range = range(of: target, options: .backwards) else { return }
    replaceSubrange(range, with: replacement)
  }
}
