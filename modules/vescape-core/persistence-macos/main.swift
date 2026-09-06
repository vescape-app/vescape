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
try historyPool.write { db in try db.drop(table: "board_settings") }
do { _ = try historyPool.read(historyBatteryConfigs); throw Failure(description: "battery-config query failure became empty") } catch is DatabaseError {}
try historyPool.write { db in try db.drop(table: "boards") }
do { _ = try historyPool.read(historyBoardNames); throw Failure(description: "board-name query failure became empty") } catch is DatabaseError {}
do { _ = try history.getPage([:]); throw Failure(description: "history auxiliary query failure became empty") } catch is DatabaseError {}
try historyPool.write { db in try db.drop(table: "telemetry_minute_buckets") }
do { _ = try profile.getProfileStatsSnapshot([:]); throw Failure(description: "profile query failure became empty") } catch is DatabaseError {}
try historyPool.close()
try FileManager.default.removeItem(at: historyURL)

let boardFixtureURL = root.appendingPathComponent("shared/board-settings-persistence-contract.json")
let boardFixture = try JSONSerialization.jsonObject(with: Data(contentsOf: boardFixtureURL)) as! [String: Any]
try require(boardFixture["scenario"] as? String == "board-settings-close-reopen", "unknown Board/settings scenario")
let boardValues = boardFixture["board"] as! [String: Any]
let settingValues = boardFixture["setting"] as! [String: Any]
let boardURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-board-settings-\(UUID().uuidString).db")
var boardQueue: DatabaseQueue? = try DatabaseQueue(path: boardURL.path)
try TelemetryDatabase.migrator.migrate(boardQueue!)
var boardPersistence = BoardSettingsPersistence(writer: boardQueue!)
let contractBoardId = boardValues["id"] as! String
let contractCreatedAt = Int64(int(boardValues["createdAt"]))
try boardPersistence.upsertBoard(
  PersistedBoard(id: contractBoardId, name: boardValues["name"] as! String, bleId: "AA:BB", transport: "direct", createdAt: contractCreatedAt, deletedAt: nil),
  settings: [PersistedBoardSetting(boardId: contractBoardId, key: "description", valueJson: "\"\(boardValues["description"] as! String)\"", updatedAt: contractCreatedAt)],
  deletedKeys: []
)
try boardQueue!.write { db in
  try db.execute(sql: "INSERT INTO board_config_values (board_id, refloat_base_version, values_json, captured_at) VALUES (?, ?, ?, ?)", arguments: ["delete-rollback", "1.0", "{}", contractCreatedAt])
  try db.execute(sql: "INSERT INTO board_config_change_notices (board_id, detected_at, diffs_json) VALUES (?, ?, ?)", arguments: ["delete-rollback", contractCreatedAt, "[]"])
}
try boardPersistence.saveSetting(PersistedAppSetting(key: settingValues["key"] as! String, valueJson: settingValues["valueJson"] as! String, updatedAt: contractCreatedAt))
try boardPersistence.upsertBoard(
  PersistedBoard(id: contractBoardId, name: boardValues["renamed"] as! String, bleId: "AA:BB", transport: "direct", createdAt: contractCreatedAt, deletedAt: nil),
  settings: [], deletedKeys: []
)
try boardPersistence.saveSetting(PersistedAppSetting(key: settingValues["key"] as! String, valueJson: settingValues["updatedValueJson"] as! String, updatedAt: contractCreatedAt + 1))
try boardQueue!.close()
boardQueue = try DatabaseQueue(path: boardURL.path)
boardPersistence = BoardSettingsPersistence(writer: boardQueue!)
let reopenedBoards = try boardPersistence.liveBoards()
let reopenedBoardSettings = try boardPersistence.boardSettings(ids: [contractBoardId])
let reopenedSettings = try boardPersistence.settings()
try require(reopenedBoards.first?.name == boardValues["renamed"] as? String, "Board rename/reopen")
try require(reopenedBoardSettings.first?.valueJson == "\"\(boardValues["description"] as! String)\"", "Board setting reopen")
try require(reopenedSettings.first { $0.key == settingValues["key"] as! String }?.valueJson == settingValues["updatedValueJson"] as? String, "setting update/reopen")
try boardPersistence.deleteSetting(settingValues["key"] as! String)
let absentSettings = try boardPersistence.settings()
try require(absentSettings.isEmpty, "absent setting must remain absent for default projection")
let defaultedSettings = try boardPersistence.settings(defaults: [settingValues["key"] as! String: "system"])
try require(defaultedSettings[settingValues["key"] as! String] as? String == "system", "absent setting default")
try boardPersistence.saveSetting(PersistedAppSetting(key: settingValues["key"] as! String, valueJson: settingValues["malformedValueJson"] as! String, updatedAt: contractCreatedAt + 2))
do { _ = try boardPersistence.settings(defaults: [settingValues["key"] as! String: "system"]); throw Failure(description: "malformed setting became default") } catch is CocoaError {}
try boardPersistence.deleteSetting(settingValues["key"] as! String)
try boardPersistence.tombstoneBoard(id: contractBoardId, deletedAt: contractCreatedAt + 2)
let liveAfterDelete = try boardPersistence.liveBoards()
let tombstone = try boardPersistence.board(id: contractBoardId)
let boardSettingsAfterDelete = try boardPersistence.boardSettings(ids: [contractBoardId])
try require(liveAfterDelete.isEmpty, "tombstoned Board visible")
try require(tombstone?.id == contractBoardId, "tombstone identity lost")
try require(boardSettingsAfterDelete.isEmpty, "tombstone retained settings")
try boardQueue!.write { db in
  try db.execute(sql: "CREATE TRIGGER fail_board_setting BEFORE INSERT ON board_settings BEGIN SELECT RAISE(FAIL, 'deterministic failure'); END")
}
do {
  try boardPersistence.upsertBoard(
    PersistedBoard(id: "rollback", name: "Must Roll Back", bleId: nil, transport: nil, createdAt: contractCreatedAt, deletedAt: nil),
    settings: [PersistedBoardSetting(boardId: "rollback", key: "description", valueJson: "\"fail\"", updatedAt: contractCreatedAt)],
    deletedKeys: []
  )
  throw Failure(description: "failed Board save reported success")
} catch is DatabaseError {}
let rolledBackBoard = try boardPersistence.board(id: "rollback")
try require(rolledBackBoard == nil, "failed Board transaction did not roll back")
try boardQueue!.write { db in
  try db.execute(sql: "DROP TRIGGER fail_board_setting")
  try db.execute(sql: "CREATE TRIGGER fail_board_tombstone BEFORE UPDATE ON boards WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'late delete failure'); END")
}
try boardPersistence.upsertBoard(
  PersistedBoard(id: "delete-rollback", name: "Keep", bleId: nil, transport: nil, createdAt: contractCreatedAt, deletedAt: nil),
  settings: [PersistedBoardSetting(boardId: "delete-rollback", key: "description", valueJson: "\"keep\"", updatedAt: contractCreatedAt)],
  deletedKeys: []
)
do { try boardPersistence.tombstoneBoard(id: "delete-rollback", deletedAt: contractCreatedAt + 3); throw Failure(description: "failed Board delete reported success") } catch is DatabaseError {}
let deleteRollbackBoard = try boardPersistence.board(id: "delete-rollback")
let deleteRollbackSettings = try boardPersistence.boardSettings(ids: ["delete-rollback"])
try require(deleteRollbackBoard?.deletedAt == nil, "failed Board delete kept tombstone")
try require(deleteRollbackSettings.count == 1, "failed Board delete removed settings")
let preservedConfig = try boardQueue!.read { db in try String.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id = ?", arguments: ["delete-rollback"]) }
let preservedNotice = try boardQueue!.read { db in try String.fetchOne(db, sql: "SELECT diffs_json FROM board_config_change_notices WHERE board_id = ?", arguments: ["delete-rollback"]) }
try require(preservedConfig == "{}", "failed Board delete removed config values")
try require(preservedNotice == "[]", "failed Board delete removed config notice")
try boardQueue!.write { db in
  try db.execute(sql: "DROP TRIGGER fail_board_tombstone")
  try db.drop(table: "app_settings")
}
do { _ = try boardPersistence.settings(); throw Failure(description: "settings query failure became defaults") } catch is DatabaseError {}
try boardQueue!.close()
try FileManager.default.removeItem(at: boardURL)
print("recording-contract macOS runtimeMs=\(Int(Date().timeIntervalSince(started) * 1000)) scenario=\(fixture["scenario"]!)")

private extension String {
  mutating func replace(_ target: String, with replacement: String, maxReplacements: Int) {
    guard maxReplacements > 0, let range = range(of: target, options: .backwards) else { return }
    replaceSubrange(range, with: replacement)
  }
}
