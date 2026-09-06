import Foundation
import GRDB

struct Failure: Error, CustomStringConvertible {
  let description: String
}

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
print("recording-contract macOS runtimeMs=\(Int(Date().timeIntervalSince(started) * 1000)) scenario=\(fixture["scenario"]!)")

private extension String {
  mutating func replace(_ target: String, with replacement: String, maxReplacements: Int) {
    guard maxReplacements > 0, let range = range(of: target, options: .backwards) else { return }
    replaceSubrange(range, with: replacement)
  }
}
