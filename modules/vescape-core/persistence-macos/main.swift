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

final class TelemetryRepository {
  static let shared = TelemetryRepository()
  func flushBlocking() {}
  func beginDatabaseSwap() {}
  func endDatabaseSwap() {}
}

func telemetryInt(_ raw: Any?) -> Int? { (raw as? NSNumber)?.intValue }
func telemetryLong(_ raw: Any?) -> Int64? { (raw as? NSNumber)?.int64Value }

let started = Date()
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let remainingFixture = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("shared/remaining-stores-persistence-contract.json"))) as! [String: Any]
try require(remainingFixture["scenario"] as? String == "remaining-stores-close-reopen-rollback", "unknown remaining-store scenario")
let remainingZone = remainingFixture["privacyZone"] as! [String: Any]
let remainingDiagnostic = remainingFixture["diagnostic"] as! [String: Any]
let remainingWarning = remainingFixture["warning"] as! [String: Any]
let remainingFault = remainingFixture["fault"] as! [String: Any]
let remainingConfig = remainingFixture["config"] as! [String: Any]
let remainingNavigation = remainingFixture["navigation"] as! [String: Any]
let remainingMaintenance = remainingFixture["maintenance"] as! [String: Any]
let remainingURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-remaining-\(UUID().uuidString).db")
var remainingQueue: DatabaseQueue? = try DatabaseQueue(path: remainingURL.path)
try TelemetryDatabase.migrator.migrate(remainingQueue!)
var settingsStore = BoardSettingsPersistence(writer: remainingQueue!)
func encodedSetting(_ key: String) throws -> PersistedAppSetting {
  let data = try JSONSerialization.data(withJSONObject: remainingNavigation[key]!, options: [.fragmentsAllowed])
  return .init(key: key, valueJson: String(decoding: data, as: UTF8.self), updatedAt: 900)
}
try settingsStore.saveSettings([
  try encodedSetting("path"), try encodedSetting("profile"),
  try encodedSetting("latitude"), try encodedSetting("longitude"),
].enumerated().map { index, setting in
  let keys = ["navigationPath", "navigationProfile", "directionPointLatitude", "directionPointLongitude"]
  return .init(key: keys[index], valueJson: setting.valueJson, updatedAt: setting.updatedAt)
})
var zoneStore = PrivacyZonePersistence(writer: remainingQueue!)
try zoneStore.save(.init(id: remainingZone["id"] as! String, preset: remainingZone["preset"] as! String, name: remainingZone["name"] as! String, enabled: true, centerLatitudeE7: Int64(int(remainingZone["centerLatitudeE7"])), centerLongitudeE7: Int64(int(remainingZone["centerLongitudeE7"])), radiusMeters: Int64(int(remainingZone["radiusMeters"])), createdAt: Int64(int(remainingZone["createdAt"])), updatedAt: Int64(int(remainingZone["updatedAt"]))))
var diagnosticStore = DiagnosticEventPersistence(writer: remainingQueue!)
try diagnosticStore.insert(.init(id: nil, occurredAtMs: Int64(int(remainingDiagnostic["occurredAtMs"])), elapsedRealtimeMs: 1, eventName: remainingDiagnostic["eventName"] as! String, operation: nil, phase: nil, boardId: nil, message: nil, propertiesJson: "{}"))
try remainingQueue!.close()
remainingQueue = try DatabaseQueue(path: remainingURL.path)
settingsStore = BoardSettingsPersistence(writer: remainingQueue!)
let reopenedNavigationPath = try settingsStore.setting("navigationPath")?.valueJson
let expectedNavigationPath = try encodedSetting("path").valueJson
let reopenedNavigationProfile = try settingsStore.setting("navigationProfile")?.valueJson
let expectedNavigationProfile = try encodedSetting("profile").valueJson
try require(reopenedNavigationPath == expectedNavigationPath, "Navigation path reopen")
try require(reopenedNavigationProfile == expectedNavigationProfile, "Navigation profile reopen")
zoneStore = PrivacyZonePersistence(writer: remainingQueue!)
let reopenedZones = try zoneStore.zones()
try require(reopenedZones.first?.id == remainingZone["id"] as? String, "Privacy Zone reopen")
diagnosticStore = DiagnosticEventPersistence(writer: remainingQueue!)
let diagnosticName = try diagnosticStore.events(fromMs: 0, toMs: Int64.max, boardId: nil, limit: 10).first?.eventName
try require(diagnosticName == remainingDiagnostic["eventName"] as? String, "Diagnostic Event reopen")
try diagnosticStore.insert(.init(id: nil, occurredAtMs: 13_000, elapsedRealtimeMs: 2, eventName: "retained", operation: nil, phase: nil, boardId: nil, message: nil, propertiesJson: "{}"))
try diagnosticStore.delete(beforeMs: 5_000)
let diagnosticsAfterPrune = try diagnosticStore.events(fromMs: 0, toMs: Int64.max, boardId: nil, limit: 10)
try require(diagnosticsAfterPrune.map(\.eventName) == ["retained"], "Diagnostic Event prune")
var warningStore = BoardWarningStore(dbWriter: remainingQueue!)
let warningBoardId = remainingWarning["boardId"] as! String
let warningKind = remainingWarning["kind"] as! String
try warningStore.upsert(.init(boardId: warningBoardId, kind: warningKind, severity: remainingWarning["severity"] as! String, firstDetectedAtMs: Int64(int(remainingWarning["firstDetectedAtMs"])), lastDetectedAtMs: Int64(int(remainingWarning["lastDetectedAtMs"])), payloadJson: remainingWarning["payloadJson"] as! String))
try warningStore.upsert(.init(boardId: warningBoardId, kind: warningKind, severity: "critical", firstDetectedAtMs: Int64(int(remainingWarning["firstDetectedAtMs"])), lastDetectedAtMs: Int64(int(remainingWarning["updatedLastDetectedAtMs"])), payloadJson: remainingWarning["payloadJson"] as! String))
try remainingQueue!.write { db in try db.execute(sql: "UPDATE board_warnings SET severity = ? WHERE board_id = ? AND kind = ?", arguments: [remainingWarning["invalidSeverity"] as! String, warningBoardId, warningKind]) }
var invalidWarningSeverityFailed = false
do { _ = try warningStore.get(warningBoardId, warningKind) } catch { invalidWarningSeverityFailed = true }
try require(invalidWarningSeverityFailed, "invalid Board Warning severity accepted")
try remainingQueue!.write { db in try db.execute(sql: "UPDATE board_warnings SET severity = 'critical' WHERE board_id = ? AND kind = ?", arguments: [warningBoardId, warningKind]) }
let updatedWarnings = try warningStore.getForBoard(warningBoardId)
try require(updatedWarnings.first?.lastDetectedAtMs == Int64(int(remainingWarning["updatedLastDetectedAtMs"])), "Board Warning upsert")
let faultBoardId = remainingFault["boardId"] as! String
let firstFaultId = remainingFault["firstId"] as! String
var faultStore = VescFaultStore(dbWriter: remainingQueue!)
var firstFault = VescFaultOccurrence(id: firstFaultId, boardId: faultBoardId, code: int(remainingFault["firstCode"]), occurredAtMs: Int64(int(remainingFault["occurredAtMs"])), lastObservedAtMs: Int64(int(remainingFault["occurredAtMs"])), clearedAtMs: nil, dismissed: false)
try faultStore.upsert(firstFault)
let didDismissFault = try faultStore.setDismissed(firstFaultId, true)
try require(didDismissFault, "VESC Fault dismiss")
firstFault.lastObservedAtMs = Int64(int(remainingFault["advancedAtMs"])); firstFault.clearedAtMs = Int64(int(remainingFault["clearedAtMs"]))
try faultStore.upsert(firstFault)
let secondFault = VescFaultOccurrence(id: remainingFault["secondId"] as! String, boardId: faultBoardId, code: int(remainingFault["secondCode"]), occurredAtMs: Int64(int(remainingFault["secondOccurredAtMs"])), lastObservedAtMs: Int64(int(remainingFault["secondOccurredAtMs"])), clearedAtMs: nil, dismissed: false)
try faultStore.upsert(secondFault)
let openFault = try faultStore.openLive(faultBoardId)
let progressedFaults = try faultStore.getForBoard(faultBoardId)
try require(openFault?.id == secondFault.id, "VESC Fault live progression")
try require(progressedFaults.last?.dismissed == true, "VESC Fault lifecycle overwrote dismissal")
var captureStore = VescFaultCaptureStore(dbWriter: remainingQueue!)
let sampleValues = remainingFault["captureSamples"] as! [[String: Any]]
func faultSample(_ value: [String: Any]) -> VescFaultCaptureSample {
  .init(capturedAtMs: Int64(int(value["capturedAtMs"])), speed: (value["speed"] as! NSNumber).doubleValue, dutyCycle: nil, erpm: nil, batteryVoltage: nil, batteryCurrent: nil, motorCurrent: nil, tempMosfet: nil, tempMotor: nil, pitch: nil, roll: nil, balancePitch: nil, adc1: nil, adc2: nil, state: int(value["state"]))
}
try captureStore.saveCapture(.init(occurrenceId: firstFaultId, boardId: faultBoardId, startedAtMs: Int64(int(remainingFault["captureStartedAtMs"])), openedAtMs: Int64(int(remainingFault["occurredAtMs"])), sampleCount: sampleValues.count), samples: sampleValues.map(faultSample))
try remainingQueue!.close()
remainingQueue = try DatabaseQueue(path: remainingURL.path)
warningStore = BoardWarningStore(dbWriter: remainingQueue!); faultStore = VescFaultStore(dbWriter: remainingQueue!); captureStore = VescFaultCaptureStore(dbWriter: remainingQueue!)
zoneStore = PrivacyZonePersistence(writer: remainingQueue!)
diagnosticStore = DiagnosticEventPersistence(writer: remainingQueue!)
let reopenedWarning = try warningStore.get(warningBoardId, warningKind)
let reopenedFaults = try faultStore.getAll()
let reopenedCaptureSamples = try captureStore.getSamples(firstFaultId)
try require(reopenedWarning?.severity == "critical", "Board Warning reopen")
try require(reopenedFaults.count == 2, "VESC Fault reopen")
let didClearWarning = try warningStore.delete(warningBoardId, warningKind)
try require(didClearWarning, "Board Warning clear")
let clearedWarning = try warningStore.get(warningBoardId, warningKind)
try require(clearedWarning == nil, "Board Warning clear persisted")
try warningStore.upsert(.init(boardId: warningBoardId, kind: warningKind, severity: "critical", firstDetectedAtMs: Int64(int(remainingWarning["firstDetectedAtMs"])), lastDetectedAtMs: Int64(int(remainingWarning["updatedLastDetectedAtMs"])), payloadJson: remainingWarning["payloadJson"] as! String))
let reopenedCapture = try captureStore.getCapture(firstFaultId)
try require(reopenedCapture?.sampleCount == sampleValues.count, "VESC Fault Capture reopen")
try require(reopenedCaptureSamples.map(\.capturedAtMs) == [7800, 7900], "VESC Fault Capture ordering")
try remainingQueue!.write { db in try db.execute(sql: "CREATE TRIGGER fail_fault_sample BEFORE INSERT ON vesc_fault_capture_samples WHEN NEW.captured_at = 7900 BEGIN SELECT RAISE(FAIL, 'late fault capture failure'); END") }
do { try captureStore.saveCapture(.init(occurrenceId: secondFault.id, boardId: faultBoardId, startedAtMs: 6000, openedAtMs: 8000, sampleCount: sampleValues.count), samples: sampleValues.map(faultSample)); throw Failure(description: "failed VESC Fault Capture save reported success") } catch is DatabaseError {}
let failedCaptureSamples = try captureStore.getSamples(secondFault.id)
try require(failedCaptureSamples.isEmpty, "failed VESC Fault Capture append was not rolled back")
let failedCapture = try captureStore.getCapture(secondFault.id)
try require(failedCapture == nil, "failed VESC Fault Capture left metadata")
try remainingQueue!.write { db in try db.drop(table: "board_warnings") }
do { _ = try warningStore.getAll(); throw Failure(description: "Board Warning query failure became empty") } catch is DatabaseError {}
try remainingQueue!.write { db in try db.drop(table: "vesc_fault_occurrences") }
do { _ = try faultStore.getAll(); throw Failure(description: "VESC Fault query failure became empty") } catch is DatabaseError {}
try remainingQueue!.write { db in try db.execute(sql: "CREATE TRIGGER fail_zone_update BEFORE UPDATE ON privacy_zones BEGIN SELECT RAISE(FAIL, 'late zone failure'); END") }
do { try zoneStore.setEnabled(id: remainingZone["id"] as! String, enabled: false, updatedAt: 4000); throw Failure(description: "failed Privacy Zone update reported success") } catch is DatabaseError {}
let zonesAfterFailure = try zoneStore.zones()
try require(zonesAfterFailure.first?.enabled == true, "failed Privacy Zone update changed row")
try remainingQueue!.write { db in try db.execute(sql: "DROP TRIGGER fail_zone_update") }
try zoneStore.delete(id: remainingZone["id"] as! String)
let zonesAfterDelete = try zoneStore.zones()
try require(zonesAfterDelete.isEmpty, "Privacy Zone delete")
try diagnosticStore.clear()
let diagnosticsAfterClear = try diagnosticStore.events(fromMs: 0, toMs: Int64.max, boardId: nil, limit: 10)
try require(diagnosticsAfterClear.isEmpty, "Diagnostic Event clear")
try remainingQueue!.write { db in try db.execute(sql: "CREATE TRIGGER fail_diagnostic_insert BEFORE INSERT ON diagnostic_events BEGIN SELECT RAISE(FAIL, 'diagnostic unavailable'); END") }
do {
  try diagnosticStore.insert(.init(id: nil, occurredAtMs: 14_000, elapsedRealtimeMs: 3, eventName: "must-fail", operation: nil, phase: nil, boardId: nil, message: nil, propertiesJson: "{}"))
  throw Failure(description: "failed Diagnostic Event insert reported success")
} catch is DatabaseError {}
let configBoardId = remainingConfig["boardId"] as! String
let configBase = remainingConfig["baseVersion"] as! String
var boardConfigStore = BoardConfigStore(dbWriter: remainingQueue!)
var motorConfigStore = MotorConfigStore(dbWriter: remainingQueue!)
func boardValues(_ key: String, at: Int64, value: Double? = nil) -> BoardConfigValues {
  var json = remainingConfig[key] as! [String: Any]
  if let value { json["kp"] = value }
  return BoardConfigValues(boardId: configBoardId, refloatBaseVersion: configBase, capturedAtMs: at, freshness: .fresh, values: json, writeBase: nil)
}
func motorValues(_ key: String, at: Int64, value: Double? = nil) -> MotorConfigValues {
  var json = (remainingConfig[key] as! [String: Any]).mapValues { ($0 as! NSNumber).doubleValue }
  if let value { json["l_temp_fet_start"] = value }
  return MotorConfigValues(boardId: configBoardId, signature: UInt32(int(remainingConfig["signature"])), firmware: remainingConfig["firmware"] as! String, capturedAtMs: at, freshness: .fresh, values: json)
}
try boardConfigStore.saveFresh(boardValues("initialBoard", at: 1000))
let initialNotice = try boardConfigStore.loadNotice(boardId: configBoardId)
try require(initialNotice == nil, "first Board config created notice")
try boardConfigStore.saveFresh(boardValues("updatedBoard", at: 2000))
try motorConfigStore.saveFresh(motorValues("initialMotor", at: 3000))
try motorConfigStore.saveFresh(motorValues("updatedMotor", at: 4000))
try boardConfigStore.saveFresh(boardValues("updatedBoard", at: 4500, value: 3))
try remainingQueue!.close()
remainingQueue = try DatabaseQueue(path: remainingURL.path)
boardConfigStore = BoardConfigStore(dbWriter: remainingQueue!)
motorConfigStore = MotorConfigStore(dbWriter: remainingQueue!)
let reopenedBoardConfig = try boardConfigStore.load(boardId: configBoardId, refloatBaseVersion: configBase)
let reopenedMotorConfig = try motorConfigStore.loadLatest(boardId: configBoardId)
let reopenedConfigNotice = try boardConfigStore.loadNotice(boardId: configBoardId)
try require(reopenedBoardConfig?.number("kp") == 3, "Board config reopen")
try require(reopenedMotorConfig?.number("l_temp_fet_start") == 85, "Motor config reopen")
try require(reopenedConfigNotice?.diffs.map(\.fieldId) == ["kp", "l_temp_fet_start"], "Board/Motor notice merge")
try remainingQueue!.write { db in try db.execute(sql: "CREATE TRIGGER fail_motor_baseline BEFORE UPDATE ON motor_config_values BEGIN SELECT RAISE(FAIL, 'late config failure'); END") }
do { try motorConfigStore.saveFresh(motorValues("updatedMotor", at: 5000, value: 90)); throw Failure(description: "failed Motor config save reported success") } catch is DatabaseError {}
let motorAfterFailure = try motorConfigStore.loadLatest(boardId: configBoardId)
let noticeAfterFailure = try boardConfigStore.loadNotice(boardId: configBoardId)
try require(motorAfterFailure?.number("l_temp_fet_start") == 85, "failed Motor config changed baseline")
try require(noticeAfterFailure?.detectedAtMs == 4500, "failed Motor config changed notice")
try remainingQueue!.write { db in
  try db.execute(sql: "DROP TRIGGER fail_motor_baseline")
  try db.execute(sql: "UPDATE board_config_change_notices SET diffs_json = 'not-json' WHERE board_id = ?", arguments: [configBoardId])
}
do { try motorConfigStore.saveFresh(motorValues("updatedMotor", at: 6000, value: 90)); throw Failure(description: "corrupt notice accepted") } catch is DecodingError {}
let motorAfterCorruption = try motorConfigStore.loadLatest(boardId: configBoardId)
try require(motorAfterCorruption?.number("l_temp_fet_start") == 85, "corrupt notice changed baseline")
try remainingQueue!.write { db in try db.execute(sql: "UPDATE board_config_values SET values_json = 'not-json' WHERE board_id = ?", arguments: [configBoardId]) }
do { try boardConfigStore.saveFresh(boardValues("updatedBoard", at: 7000, value: 4)); throw Failure(description: "corrupt Board baseline accepted") } catch is CocoaError {} catch is ConfigStorageError {} catch is DecodingError {}
try boardConfigStore.clear(boardId: configBoardId)
try motorConfigStore.clear(boardId: configBoardId)
let clearedBoardConfig = try boardConfigStore.load(boardId: configBoardId, refloatBaseVersion: configBase)
let clearedMotorConfig = try motorConfigStore.loadLatest(boardId: configBoardId)
try require(clearedBoardConfig == nil, "Board config clear")
try require(clearedMotorConfig == nil, "Motor config clear")
try remainingQueue!.close()
try FileManager.default.removeItem(at: remainingURL)

let maintenanceURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-maintenance-\(UUID().uuidString).db")
var maintenanceQueue: DatabaseQueue? = try DatabaseQueue(path: maintenanceURL.path)
try TelemetryDatabase.migrator.migrate(maintenanceQueue!)
let maintenanceFrames = remainingMaintenance["frames"] as! [[String: Any]]
func maintenanceFrame(_ at: Int64, _ boardId: String) -> RecordingPersistenceSQL.Frame {
  .init(capturedAtMs: at, elapsedRealtimeMs: at, boardId: boardId, canId: nil, flags: 1,
        changedMask1: Int.max, changedMask2: 1, speedCentiKmh: Int(at), batteryVoltageMv: 80_000,
        motorCurrentMa: 1_000, batteryCurrentMa: 500, dutyPermille: 100, pitchCentiDeg: 0,
        rollCentiDeg: 0, balancePitchCentiDeg: 0, balanceCurrentMa: 0, erpm: 1_000, state: 1,
        switchState: 1, adc1Milli: 0, adc2Milli: 0, odometerCm: at, tempMosfetDeciC: 300,
        tempMotorDeciC: 300)
}
try maintenanceQueue!.write { db in
  for value in maintenanceFrames {
    let at = Int64(int(value["at"])); let board = value["boardId"] as! String
    let frame = maintenanceFrame(at, board)
    try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(frame))
    try insertMarker(db, ["occurredAtMs": at, "elapsedRealtimeMs": at, "type": "m\(at)", "boardId": board])
  }
  let delta = remainingMaintenance["deltaFrame"] as! [String: Any]
  let reconstructed = maintenanceFrame(Int64(int(delta["at"])), delta["boardId"] as! String)
  try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(reconstructed))
  try insertMarker(db, ["occurredAtMs": int(delta["at"]), "elapsedRealtimeMs": int(delta["at"]), "type": "m-delta", "boardId": delta["boardId"]])
  try insertExclusion(db, .init(boardId: "board-a", reason: "test", startMs: 900, endMs: 1_100, sampleCount: 1))
  try insertExclusion(db, .init(boardId: "board-a", reason: "overlap-a", startMs: 61_500, endMs: 62_500, sampleCount: 1))
  try insertExclusion(db, .init(boardId: "board-b", reason: "overlap-b", startMs: 61_500, endMs: 62_500, sampleCount: 1))
  try insertExclusion(db, .init(boardId: "board-b", reason: "test", startMs: 183_900, endMs: 184_100, sampleCount: 1))
}
var maintenance = TelemetryMaintenancePersistence(writer: maintenanceQueue!)
let boardRange = remainingMaintenance["boardRange"] as! [String: Any]
let allBoardRange = remainingMaintenance["allBoardRange"] as! [String: Any]
let favoriteRange = remainingMaintenance["favorite"] as! [String: Any]
let prunedCount = try maintenance.deleteBefore(Int64(int(remainingMaintenance["deleteBeforeMs"])))
let boardDeletedCount = try maintenance.deleteRanges([.init(startMs: Int64(int(boardRange["fromMs"])), endMs: Int64(int(boardRange["toMs"])))], boardId: boardRange["boardId"] as? String, allBoards: false)
let exclusionsAfterBoardDelete = try maintenanceQueue!.read { db in
  try String.fetchAll(db, sql: "SELECT reason FROM metric_exclusion_ranges WHERE start_ms = 61500 ORDER BY reason")
}
try require(exclusionsAfterBoardDelete == ["overlap-a"], "Board range preserves peer exclusions")
let allBoardDeletedCount = try maintenance.deleteRanges([.init(startMs: Int64(int(allBoardRange["fromMs"])), endMs: Int64(int(allBoardRange["toMs"])))], boardId: nil, allBoards: true)
try require(prunedCount == 1, "maintenance delete-before count")
try require(boardDeletedCount == 1, "maintenance Board range count")
try require(allBoardDeletedCount == 1, "maintenance all-Board range count")
let maintenanceFavoriteStore = FavoriteStore(dbWriter: maintenanceQueue!)
try maintenanceFavoriteStore.insert(.init(id: "pin", boardId: "board-b", name: nil, startMs: Int64(int(favoriteRange["fromMs"])), endMs: Int64(int(favoriteRange["toMs"])), createdAtMs: 4_000, updatedAtMs: 4_000, summary: .init()))
let pins = try maintenanceFavoriteStore.list().map { expandTelemetryRangeToBuckets(.init(startMs: $0.startMs, endMs: $0.endMs)) }
try maintenance.clear(protectedRanges: pins)
let rebuilt = try maintenance.rebuild(config: .init(), onProgress: { _, _ in })
try require(rebuilt == 1, "maintenance rebuild count")
try maintenanceQueue!.write { db in
  for at in [Int64(245_000), 305_000] {
    let frame = maintenanceFrame(at, "board-b")
    try db.execute(sql: RecordingPersistenceSQL.insertFrame, arguments: RecordingPersistenceSQL.frameArguments(frame))
    try insertMarker(db, ["occurredAtMs": at, "elapsedRealtimeMs": at, "type": "late", "boardId": "board-b"])
  }
  try db.execute(sql: "CREATE TRIGGER fail_maintenance_marker BEFORE DELETE ON telemetry_markers WHEN OLD.occurred_at_ms = 305000 BEGIN SELECT RAISE(FAIL, 'late maintenance failure'); END")
}
do {
  let rollback = remainingMaintenance["rollbackRanges"] as! [[String: Any]]
  _ = try maintenance.deleteRanges(rollback.map { .init(startMs: Int64(int($0["fromMs"])), endMs: Int64(int($0["toMs"]))) }, boardId: nil, allBoards: true)
  throw Failure(description: "late maintenance failure reported success")
} catch is DatabaseError {}
try maintenanceQueue!.close()
maintenanceQueue = try DatabaseQueue(path: maintenanceURL.path)
maintenance = TelemetryMaintenancePersistence(writer: maintenanceQueue!)
try maintenanceQueue!.read { db in
  let frames = try Row.fetchAll(db, sql: "SELECT captured_at_ms FROM telemetry_frames ORDER BY captured_at_ms").map { $0["captured_at_ms"] as Int64 }
  let markers = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_markers")
  let buckets = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_minute_buckets")
  let rebuiltSamples = try Int.fetchOne(db, sql: "SELECT sample_count FROM telemetry_minute_buckets")
  let expectedFrames = (remainingMaintenance["expectedRemainingFrameTimes"] as! [NSNumber]).map(\.int64Value)
  try require(frames == expectedFrames, "maintenance rollback/reopen frames")
  try require(markers == 4, "maintenance marker preservation")
  try require(buckets == int(remainingMaintenance["expectedRebuiltBuckets"]), "maintenance rebuilt bucket reopen")
  try require(rebuiltSamples == int(remainingMaintenance["expectedRebuiltSampleCount"]), "maintenance rebuilt samples")
}
try maintenanceQueue!.close()
try FileManager.default.removeItem(at: maintenanceURL)
// GPS-only writes retain poor fixes and roll back their bucket if a later track insert fails.
let trackURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-track-\(UUID().uuidString).db")
var trackQueue = try DatabaseQueue(path: trackURL.path)
try TelemetryDatabase.migrator.migrate(trackQueue)
let trackPoint = RideTrackPoint(recordingId: "ride-a", boardId: "board-a", fixAtMs: 2000, latitudeE7: 510000000, longitudeE7: 170000000, accuracyCm: 3500, gpsSpeedCentiMps: 400, bearingCentiDeg: nil, altitudeCm: nil)
try trackQueue.write { db in
  try insertRideRecording(db, RideRecording(id: "ride-a", boardId: "board-a", startedAtMs: 1000, endedAtMs: nil, endedReason: nil))
  for bucket in buildTelemetryBuckets([], locationPoints: rideTrackBucketPoints([trackPoint])) {
    try db.execute(sql: RecordingPersistenceSQL.upsertBucket, arguments: RecordingPersistenceSQL.bucketArguments(bucket))
  }
  try insertRideTrackPoint(db, trackPoint)
}
try trackQueue.close()
trackQueue = try DatabaseQueue(path: trackURL.path)
try trackQueue.read { db in
  let points = try fetchRideTrack(db, fromMs: 0, toMs: 10000, boardId: "board-a")
  try require(points.count == 1 && points[0]["accuracy_cm"] as Int? == 3500, "GPS-only reopen lost poor fix")
  let bucket = try Row.fetchOne(db, sql: "SELECT sample_count,gps_point_count FROM telemetry_minute_buckets")
  try require(bucket?["sample_count"] as Int? == 0 && bucket?["gps_point_count"] as Int? == 1, "GPS-only bucket invented telemetry")
}
try trackQueue.write { db in
  try db.execute(sql: "CREATE TRIGGER reject_track BEFORE INSERT ON ride_track_points BEGIN SELECT RAISE(FAIL, 'track failure'); END")
}
let lateTrackPoint = RideTrackPoint(recordingId: "ride-a", boardId: "board-a", fixAtMs: 62000, latitudeE7: 510000000, longitudeE7: 170000000, accuracyCm: 500, gpsSpeedCentiMps: 400, bearingCentiDeg: nil, altitudeCm: nil)
var trackCommitFailed = false
do {
  try trackQueue.write { db in
    for bucket in buildTelemetryBuckets([], locationPoints: rideTrackBucketPoints([lateTrackPoint])) {
      try db.execute(sql: RecordingPersistenceSQL.upsertBucket, arguments: RecordingPersistenceSQL.bucketArguments(bucket))
    }
    try insertRideTrackPoint(db, lateTrackPoint)
  }
} catch is DatabaseError { trackCommitFailed = true }
try require(trackCommitFailed, "GPS insert fault did not propagate")
try trackQueue.close()
trackQueue = try DatabaseQueue(path: trackURL.path)
try trackQueue.read { db in
  let buckets = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM telemetry_minute_buckets")
  let points = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ride_track_points")
  try require(buckets == 1 && points == 1, "GPS late failure leaked partial bucket")
}
try trackQueue.close()

// Identical timestamps belong to separate recordings, including queries with a small limit.
let identityQueue = try DatabaseQueue(path: trackURL.path)
try identityQueue.write { db in
  try db.execute(sql: "DROP TRIGGER reject_track")
  try insertRideRecording(db, RideRecording(id: "ride-b", boardId: "board-a", startedAtMs: 1000, endedAtMs: 3000, endedReason: "stopped"))
  let other = RideTrackPoint(recordingId: "ride-b", boardId: "board-a", fixAtMs: 2000, latitudeE7: 510000000, longitudeE7: 170000000, accuracyCm: 500, gpsSpeedCentiMps: 400, bearingCentiDeg: nil, altitudeCm: nil)
  try insertRideTrackPoint(db, other)
  for bucket in buildTelemetryBuckets([], locationPoints: rideTrackBucketPoints([other])) {
    try db.execute(sql: RecordingPersistenceSQL.upsertBucket, arguments: RecordingPersistenceSQL.bucketArguments(bucket))
  }
}
try identityQueue.read { db in
  let selected = try fetchRideTrack(db, fromMs: 0, toMs: 10000, boardId: "board-a", recordingId: "ride-b", limit: 1)
  try require(selected.count == 1 && selected[0]["recording_id"] as String? == "ride-b", "Recording filter applied after limit")
}
let identityMaintenance = TelemetryMaintenancePersistence(writer: identityQueue)
_ = try identityMaintenance.deleteRanges([TelemetryTimeRange(startMs: 0, endMs: 10000)], boardId: "board-a", allBoards: false, recordingId: "ride-a")
try identityQueue.read { db in
  let remaining = try fetchRideTrack(db, fromMs: 0, toMs: 10000, boardId: "board-a")
  try require(remaining.count == 1 && remaining[0]["recording_id"] as String? == "ride-b", "Recording deletion removed adjacent GPS")
  let ids = try String.fetchAll(db, sql: "SELECT recording_id FROM telemetry_minute_buckets")
  try require(ids == ["ride-b"], "Recording deletion removed adjacent bucket")
}
try identityQueue.close()
try FileManager.default.removeItem(at: trackURL)

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
    odometerCm: Int64(int(sample["odometerCm"])), tempMosfetDeciC: 300, tempMotorDeciC: 350
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
      tempMosfetDeciC: 300, tempMotorDeciC: 350
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
    odometerCm: Int64(int(sample["odometerCm"])) + 100, tempMosfetDeciC: 300, tempMotorDeciC: 350
  )
}
let currentNext = buildTelemetryBuckets(nextPoints).first!
let offset = Int64(int(historyFixture["olderRideOffsetMs"]))
let olderPoints = samples.map { sample in
  BucketTelemetryPoint(
    capturedAtMs: Int64(int(sample["capturedAtMs"])) - offset, boardId: boardId,
    speedCentiKmh: int(sample["speedCentiKmh"]), batteryVoltageMv: int(sample["batteryVoltageMv"]),
    motorCurrentMa: 5_000, batteryCurrentMa: 2_000, dutyPermille: 200,
    odometerCm: Int64(int(sample["odometerCm"])), tempMosfetDeciC: 300, tempMotorDeciC: 350
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

let favoriteFixtureURL = root.appendingPathComponent("shared/favorite-persistence-contract.json")
let favoriteFixture = try JSONSerialization.jsonObject(with: Data(contentsOf: favoriteFixtureURL)) as! [String: Any]
try require(favoriteFixture["scenario"] as? String == "favorite-create-rename-trim-delete-reopen", "unknown Favorite scenario")
let favoriteInput = favoriteFixture["input"] as! [String: Any]
let favoriteExpected = favoriteFixture["expected"] as! [String: Any]
let favoriteURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-favorite-\(UUID().uuidString).db")
var favoriteQueue: DatabaseQueue? = try DatabaseQueue(path: favoriteURL.path)
try TelemetryDatabase.migrator.migrate(favoriteQueue!)
var favoriteStore = FavoriteStore(dbWriter: favoriteQueue!)
let favoriteId = favoriteInput["id"] as! String
let favoriteCreatedAt = Int64(int(favoriteInput["startMs"]))
let favoriteSamples = favoriteInput["samples"] as! [[String: Any]]
let favoritePoints = favoriteSamples.map { sample in
  BucketTelemetryPoint(
    capturedAtMs: Int64(int(sample["capturedAtMs"])), boardId: nil,
    speedCentiKmh: int(sample["speedCentiKmh"]), batteryVoltageMv: 80_000,
    motorCurrentMa: 0, batteryCurrentMa: 0, dutyPermille: 100,
    odometerCm: Int64(int(sample["odometerCm"])), tempMosfetDeciC: 300, tempMotorDeciC: 300
  )
}
let contractSummary = buildFavoriteSummary(buildTelemetryBuckets(favoritePoints))
try require(contractSummary.sampleCount == int(favoriteExpected["sampleCount"]), "Favorite derived sample count")
try require(contractSummary.distanceCm == Int64(int(favoriteExpected["distanceCm"])), "Favorite derived distance")
try require(contractSummary.avgSpeedCentiKmh == int(favoriteExpected["avgSpeedCentiKmh"]), "Favorite derived average")
let createdRange = TelemetryTimeRange(startMs: Int64(int(favoriteInput["startMs"])), endMs: Int64(int(favoriteInput["endMs"])))
let createdFavorite = try persistFavorite(store: favoriteStore, existingId: nil, range: createdRange, boardId: favoriteInput["boardId"] as? String, name: favoriteInput["name"] as? String, nowMs: favoriteCreatedAt, newId: { favoriteId }) { requested, owner in
  try require(requested == createdRange, "Favorite create query range")
  try require(owner == favoriteInput["boardId"] as? String, "Favorite create Board")
  return contractSummary
}!
let trimmedRange = TelemetryTimeRange(startMs: Int64(int(favoriteInput["trimmedStartMs"])), endMs: Int64(int(favoriteInput["trimmedEndMs"])))
let updatedFavorite = try persistFavorite(store: favoriteStore, existingId: favoriteId, range: trimmedRange, boardId: nil, name: favoriteInput["renamed"] as? String, nowMs: createdFavorite.updatedAtMs + 1, newId: { fatalError("must preserve id") }) { requested, owner in
  try require(requested == trimmedRange, "Favorite trim query range")
  try require(owner == favoriteInput["boardId"] as? String, "Favorite trim Board")
  return contractSummary
}
try require(updatedFavorite?.id == favoriteId, "Favorite rename/trim")
try require(updatedFavorite?.boardId == favoriteInput["boardId"] as? String, "Favorite trim ownership")
let conflictingFavorite = try persistFavorite(store: favoriteStore, existingId: favoriteId, range: trimmedRange, boardId: "conflicting-board", name: favoriteInput["renamed"] as? String, nowMs: createdFavorite.updatedAtMs + 2, newId: { fatalError("must preserve id") }) { _, owner in
  try require(owner == favoriteInput["boardId"] as? String, "Favorite conflicting Board ignored")
  return contractSummary
}
try require(conflictingFavorite?.boardId == favoriteInput["boardId"] as? String, "Favorite conflicting ownership preserved")
let ownerless = try persistFavorite(store: favoriteStore, existingId: nil, range: createdRange, boardId: nil, name: nil, nowMs: favoriteCreatedAt, newId: { "ownerless-favorite" }) { _, owner in
  try require(owner == nil, "Favorite ownerless create")
  return contractSummary
}!
let ownerlessUpdated = try persistFavorite(store: favoriteStore, existingId: ownerless.id, range: trimmedRange, boardId: "conflicting-board", name: nil, nowMs: favoriteCreatedAt + 1, newId: { fatalError("must preserve id") }) { _, owner in
  try require(owner == nil, "Favorite ownerless update")
  return contractSummary
}
try require(ownerlessUpdated?.boardId == nil, "Favorite ownerless ownership preserved")
_ = try favoriteStore.delete(ownerless.id)
try favoriteQueue!.close()
favoriteQueue = try DatabaseQueue(path: favoriteURL.path)
favoriteStore = FavoriteStore(dbWriter: favoriteQueue!)
let reopenedFavorite = try favoriteStore.list().first
try require(reopenedFavorite?.id == favoriteId, "Favorite reopen identity")
try require(reopenedFavorite?.name == favoriteInput["renamed"] as? String, "Favorite reopen name")
try require(reopenedFavorite?.startMs == Int64(int(favoriteInput["trimmedStartMs"])), "Favorite reopen range")
try require(reopenedFavorite?.summary.sampleCount == int(favoriteExpected["sampleCount"]), "Favorite reopen summary")
let protectedFavoriteRange = expandTelemetryRangeToBuckets(TelemetryTimeRange(startMs: reopenedFavorite!.startMs, endMs: reopenedFavorite!.endMs))
let deletableAroundFavorite = subtractProtectedTelemetryRanges(
  deleteRange: TelemetryTimeRange(startMs: 0, endMs: 120_000), protectedRanges: [protectedFavoriteRange]
)
try require(deletableAroundFavorite.allSatisfy { $0.endMs < protectedFavoriteRange.startMs || $0.startMs > protectedFavoriteRange.endMs }, "Favorite pin allowed deletion")
try favoriteQueue!.write { db in
  try db.execute(sql: "INSERT INTO favorite_media (id, favorite_id, mime_type, media_kind, byte_count, content_hash, created_at) VALUES ('owned-media', ?, 'image/jpeg', 'photo', 1, '00', ?)", arguments: [favoriteId, favoriteCreatedAt])
  try db.execute(sql: "CREATE TRIGGER fail_favorite_delete BEFORE DELETE ON favorites BEGIN SELECT RAISE(FAIL, 'late Favorite delete failure'); END")
}
do { _ = try favoriteStore.delete(favoriteId); throw Failure(description: "failed Favorite delete reported success") } catch is DatabaseError {}
let retainedMedia = try favoriteQueue!.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM favorite_media WHERE favorite_id = ?", arguments: [favoriteId]) }
try require(retainedMedia == 1, "failed Favorite delete removed media manifest")
try favoriteQueue!.write { db in try db.execute(sql: "DROP TRIGGER fail_favorite_delete") }
let deletedFavorite = try favoriteStore.delete(favoriteId)
try require(deletedFavorite, "Favorite delete")
let remainingFavorites = try favoriteStore.list()
try require(remainingFavorites.isEmpty, "Favorite deleted row reopened")
let mediaRoot = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-favorite-media-\(UUID().uuidString)", isDirectory: true)
let mediaDirectory = mediaRoot.appendingPathComponent("preserved", isDirectory: true)
let preservedMedia = mediaDirectory.appendingPathComponent("existing.jpg")
try FileManager.default.createDirectory(at: mediaDirectory, withIntermediateDirectories: true)
try Data([1, 2, 3]).write(to: preservedMedia)
let mediaStore = FavoriteMediaStore(dbWriter: favoriteQueue!, rootURL: mediaRoot)
try favoriteQueue!.write { db in try db.drop(table: "favorite_media") }
do { try mediaStore.reconcile(favoriteId: "preserved"); throw Failure(description: "Favorite Media lookup failure became empty") } catch is DatabaseError {}
try require(FileManager.default.fileExists(atPath: preservedMedia.path), "failed Favorite Media lookup deleted file")
try FileManager.default.removeItem(at: mediaRoot)
try favoriteQueue!.close()
try FileManager.default.removeItem(at: favoriteURL)

let tuneURL = FileManager.default.temporaryDirectory.appendingPathComponent("vescape-tune-contract-\(UUID().uuidString).db")
let tuneAlertFixtureURL = root.appendingPathComponent("shared/tune-alert-persistence-contract.json")
let tuneAlertFixture = try JSONSerialization.jsonObject(with: Data(contentsOf: tuneAlertFixtureURL)) as! [String: Any]
try require(tuneAlertFixture["scenario"] as? String == "tune-history-alert-close-reopen-rollback", "unknown Tune/Alert scenario")
let tuneAlertBoardId = tuneAlertFixture["boardId"] as! String
let tuneValues = tuneAlertFixture["profile"] as! [String: Any]
let alertValues = tuneAlertFixture["alert"] as! [String: Any]
let tuneAlertExpected = tuneAlertFixture["expected"] as! [String: Any]
var tuneQueue: DatabaseQueue? = try DatabaseQueue(path: tuneURL.path)
try TelemetryDatabase.migrator.migrate(tuneQueue!)
var tuneStore = TuneProfileStore(dbWriter: tuneQueue!)
let tune = try tuneStore.createProfile(boardId: tuneAlertBoardId, name: tuneValues["name"] as! String, fields: ["kp": 1], refloatBaseVersion: tuneValues["refloatBaseVersion"] as! String)
let tuneId = tune["id"] as! String
_ = try tuneStore.saveProfile(profileId: tuneId, fields: ["kp": 2])
var alertPersistence = AlertRulePersistence(writer: tuneQueue!)
try alertPersistence.save(PersistedAlertRule(boardId: tuneAlertBoardId, id: alertValues["id"] as! String, controlId: alertValues["controlId"] as! String, threshold: alertValues["threshold"] as! Double, thresholdMax: nil, enabled: true, soundType: alertValues["soundType"] as! String, createdAt: 1, repeatEverySeconds: nil, beepCount: 1, source: alertValues["source"] as? String, thresholdKind: "fixed", configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil))
try alertPersistence.setEnabled(boardId: tuneAlertBoardId, id: alertValues["id"] as! String, enabled: false)
try tuneQueue!.close()
tuneQueue = try DatabaseQueue(path: tuneURL.path)
tuneStore = TuneProfileStore(dbWriter: tuneQueue!)
alertPersistence = AlertRulePersistence(writer: tuneQueue!)
let reopenedTune = try tuneStore.getTuneProfile(tuneId)
let reopenedTuneHistory = try tuneStore.getProfileHistory(tuneId)
try require(reopenedTune?["boardId"] as? String == tuneAlertBoardId, "Tune Profile ownership/reopen")
try require((reopenedTune?["fields"] as? [String: Any])?["kp"] as? Int == 2, "Tune Profile values/reopen")
try require(reopenedTuneHistory.count == int(tuneAlertExpected["historyCount"]), "Tune History/reopen")
let reopenedAlerts = try alertPersistence.rules(boardId: tuneAlertBoardId)
try require(reopenedAlerts.count == int(tuneAlertExpected["alertCount"]), "Alert count/reopen")
try require(reopenedAlerts.first?.id == alertValues["id"] as? String, "Alert identity/reopen")
try require(reopenedAlerts.first?.enabled == tuneAlertExpected["alertEnabled"] as? Bool, "Alert update/reopen")
let absentTune = try tuneStore.getTuneProfile("absent")
try require(absentTune == nil, "absent Tune Profile")
try tuneQueue!.write { db in
  try db.execute(sql: "CREATE TRIGGER fail_tune_update BEFORE UPDATE ON tune_profiles BEGIN SELECT RAISE(FAIL, 'late Tune failure'); END")
}
do { _ = try tuneStore.saveProfile(profileId: tuneId, fields: ["kp": 3]); throw Failure(description: "failed Tune save reported success") } catch is DatabaseError {}
let historyAfterFailedSave = try tuneStore.getProfileHistory(tuneId)
try require(historyAfterFailedSave.count == int(tuneAlertExpected["historyCount"]), "failed Tune save retained history row")
try tuneQueue!.write { db in
  try db.execute(sql: "DROP TRIGGER fail_tune_update")
  try db.execute(sql: "UPDATE tune_profiles SET fields_json = 'not-json' WHERE id = ?", arguments: [tuneId])
}
var malformedTuneFailed = false
do { _ = try tuneStore.getTuneProfile(tuneId) } catch { malformedTuneFailed = true }
try require(malformedTuneFailed, "malformed Tune became empty")
try tuneQueue!.write { db in try db.drop(table: "alerts") }
var alertQueryFailed = false
do { _ = try alertPersistence.rules(boardId: tuneAlertBoardId) } catch { alertQueryFailed = true }
try require(alertQueryFailed, "Alert query failure became empty")
try tuneQueue!.close()
try FileManager.default.removeItem(at: tuneURL)

// Every registered GRDB prefix is a supported restore start. Seed values available at that prefix,
// run the remaining production migrator, and prove both preservation and the final ledger here in
// the fast macOS host command.
let migrationManifest = try JSONSerialization.jsonObject(
  with: Data(contentsOf: root.appendingPathComponent("shared/migration-fixture-manifest.json"))
) as! [String: Any]
let grdbManifest = migrationManifest["grdb"] as! [String: Any]
let migrationIdentifiers = TelemetryDatabase.migrator.migrations
try require(
  Set(grdbManifest["migrationIdentifiers"] as! [String]) == Set(migrationIdentifiers),
  "shared GRDB migration manifest differs from production registry"
)
for start in migrationIdentifiers {
  let migrationQueue = try DatabaseQueue()
  try TelemetryDatabase.migrator.migrate(migrationQueue, upTo: start)
  let available = try migrationQueue.write { db -> (tune: Bool, favorite: Bool, config: Bool) in
    try db.execute(sql: "INSERT INTO boards (id,name,ble_id,created_at) VALUES ('matrix-board','Matrix Board','matrix-ble',100)")
    try db.execute(sql: "INSERT INTO app_settings VALUES ('matrix-setting','\"preserved\"',101)")
    try db.execute(sql: "INSERT INTO alerts (board_id,id,control_id,threshold,enabled,sound_type,created_at) VALUES ('matrix-board','matrix-alert','speed',24.5,1,'beep',102)")
    let frameColumns = try db.columns(in: "telemetry_frames").map(\.name)
    if frameColumns.contains("board_id") {
      try db.execute(sql: "INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,board_id,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'matrix-board',1,1,0,2468)")
    } else {
      try db.execute(sql: "INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,device_id,device_name,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'matrix-ble','Matrix Board',1,1,0,2468)")
    }
    let hasTune = try db.tableExists("tune_profiles")
    if hasTune {
      let columns = try db.columns(in: "tune_profiles").map(\.name)
      var names = ["id", "board_id", "name", "fields_json", "created_at", "updated_at"]
      var values = ["'matrix-tune'", "'matrix-board'", "'Matrix Tune'", "'{}'", "103", "104"]
      if columns.contains("icon") { names.append("icon"); values.append("'gauge'") }
      if columns.contains("color") { names.append("color"); values.append("'orange'") }
      if columns.contains("refloat_base_version") { names.append("refloat_base_version"); values.append("'2.0'") }
      try db.execute(sql: "INSERT INTO tune_profiles (\(names.joined(separator: ","))) VALUES (\(values.joined(separator: ",")))")
    }
    let hasFavorite = try db.tableExists("favorites")
    if hasFavorite {
      try db.execute(sql: "INSERT INTO favorites (id,board_id,name,start_ms,end_ms,created_at,updated_at,sample_count,gps_point_count,moving_duration_ms,avg_speed_centi_kmh,max_speed_centi_kmh,battery_used_wh_milli) VALUES ('matrix-favorite','matrix-board','Matrix Favorite',900,1100,105,106,1,0,100,2400,2468,2)")
    }
    let hasConfig = try db.tableExists("board_config_values")
    if hasConfig {
      try db.execute(sql: "INSERT INTO board_config_values VALUES ('matrix-board','2.0','{\"motor_current_max\":55.5}',107)")
    }
    return (hasTune, hasFavorite, hasConfig)
  }
  try TelemetryDatabase.migrator.migrate(migrationQueue)
  try migrationQueue.read { db in
    let boardName = try String.fetchOne(db, sql: "SELECT name FROM boards WHERE id='matrix-board'")
    let settingValue = try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key='matrix-setting'")
    let speed = try Int.fetchOne(db, sql: "SELECT speed_centi_kmh FROM telemetry_frames WHERE captured_at_ms=1000")
    let frameBoard = try String.fetchOne(db, sql: "SELECT board_id FROM telemetry_frames WHERE captured_at_ms=1000")
    let alertId = try String.fetchOne(db, sql: "SELECT id FROM alerts WHERE id='matrix-alert'")
    try require(boardName == "Matrix Board", "\(start) lost Board")
    try require(settingValue == "\"preserved\"", "\(start) lost setting")
    try require(speed == 2468, "\(start) lost telemetry")
    try require(frameBoard == "matrix-board", "\(start) lost telemetry owner")
    try require(alertId == "matrix-alert", "\(start) lost Alert Rule")
    if available.tune { let value = try String.fetchOne(db, sql: "SELECT name FROM tune_profiles WHERE id='matrix-tune'"); try require(value == "Matrix Tune", "\(start) lost Tune Profile") }
    if available.favorite { let value = try String.fetchOne(db, sql: "SELECT name FROM favorites WHERE id='matrix-favorite'"); try require(value == "Matrix Favorite", "\(start) lost Favorite") }
    if available.config { let value = try String.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id='matrix-board'"); try require(value == "{\"motor_current_max\":55.5}", "\(start) lost config") }
    let ledger = try TelemetryDatabase.migrator.appliedIdentifiers(db)
    try require(ledger == Set(migrationIdentifiers), "\(start) final ledger")
  }
  try migrationQueue.close()
}

// Reconstruct the original db6e9b9 v1 release shape, including global Alert Rules and the legacy
// telemetry fault columns, then run the real destructive/preserving migrations.
let authenticV1 = try DatabaseQueue()
try TelemetryDatabase.migrator.migrate(authenticV1, upTo: "v1")
try authenticV1.write { db in
  try db.execute(sql: "DROP TABLE alerts")
  try db.execute(sql: "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY,control_id TEXT NOT NULL,threshold REAL NOT NULL,threshold_max REAL,enabled INTEGER NOT NULL,sound_type TEXT NOT NULL,created_at INTEGER NOT NULL,source TEXT)")
  try db.execute(sql: "ALTER TABLE telemetry_frames ADD COLUMN fault_code INTEGER")
  try db.execute(sql: "ALTER TABLE telemetry_minute_buckets ADD COLUMN fault_count INTEGER NOT NULL DEFAULT 0")
  try db.execute(sql: "INSERT INTO alerts VALUES ('legacy-global','speed',20,NULL,1,'beep',100,NULL)")
  try db.execute(sql: "INSERT INTO boards (id,name,ble_id,created_at) VALUES ('historical-board','Historical','historical-ble',100)")
  try db.execute(sql: "INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,device_id,device_name,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'historical-ble','Historical',1,1,0,2468)")
}
try TelemetryDatabase.migrator.migrate(authenticV1)
try authenticV1.read { db in
  let alertCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM alerts")
  let frameBoard = try String.fetchOne(db, sql: "SELECT board_id FROM telemetry_frames WHERE captured_at_ms=1000")
  let frameColumns = try db.columns(in: "telemetry_frames").map(\.name)
  let ledger = try TelemetryDatabase.migrator.appliedIdentifiers(db)
  try require(alertCount == 0, "authentic v1 retained unowned global Alert Rule")
  try require(frameBoard == "historical-board", "authentic v1 lost telemetry ownership")
  try require(!frameColumns.contains("fault_code"), "authentic v1 retained fault column")
  try require(ledger == Set(migrationIdentifiers), "authentic v1 final ledger")
}
try authenticV1.close()

let swapDirectory = FileManager.default.temporaryDirectory
  .appendingPathComponent("vescape-host-swap-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: swapDirectory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: swapDirectory) }
let swapTarget = swapDirectory.appendingPathComponent("vescape.db")
let swapWal = URL(fileURLWithPath: swapTarget.path + "-wal")
let swapShm = URL(fileURLWithPath: swapTarget.path + "-shm")
let swapCandidate = swapDirectory.appendingPathComponent("candidate.db")
try Data("original".utf8).write(to: swapTarget)
try Data("original-wal".utf8).write(to: swapWal)
try Data("original-shm".utf8).write(to: swapShm)
try Data("candidate".utf8).write(to: swapCandidate)
do {
  _ = try replacingDatabaseFiles(source: swapCandidate, target: swapTarget) { _ in
    throw Failure(description: "forced installed-candidate validation failure")
  }
  throw Failure(description: "failed database swap reported success")
} catch let error as Failure where error.description == "forced installed-candidate validation failure" {}
let swappedTargetData = try Data(contentsOf: swapTarget)
let swappedWalData = try Data(contentsOf: swapWal)
let swappedShmData = try Data(contentsOf: swapShm)
try require(swappedTargetData == Data("original".utf8), "database swap lost original database")
try require(swappedWalData == Data("original-wal".utf8), "database swap lost original WAL")
try require(swappedShmData == Data("original-shm".utf8), "database swap lost original SHM")

let invalidArchiveDatabase = try DatabaseQueue()
try TelemetryDatabase.migrator.migrate(invalidArchiveDatabase)
let invalidArchiveURL = swapDirectory.appendingPathComponent("archive.sqlite")
try invalidArchiveDatabase.backup(to: DatabaseQueue(path: invalidArchiveURL.path))
try invalidArchiveDatabase.close()
let invalidDatabaseData = try Data(contentsOf: invalidArchiveURL)
for (version, format) in [(44, "vesc-db-backup"), (43, "unknown-format")] {
  let manifest = try JSONSerialization.data(withJSONObject: [
    "format": format, "platform": "android", "schemaVersion": version,
  ])
  let archive = DatabaseBackupArchive.archive(database: invalidDatabaseData, manifest: manifest)
  let invalidStage = swapDirectory.appendingPathComponent("invalid-\(version)-\(format)", isDirectory: true)
  try FileManager.default.createDirectory(at: invalidStage, withIntermediateDirectories: true)
  var rejected = false
  do { _ = try DatabaseBackupManager.stageBackupArchive(archive, in: invalidStage) } catch { rejected = true }
  try require(rejected, "invalid or unsupported archive was accepted")
}

if let exchangePath = ProcessInfo.processInfo.environment["VESCAPE_BACKUP_EXCHANGE"] {
  let exchange = URL(fileURLWithPath: exchangePath, isDirectory: true)
  let stage = exchange.appendingPathComponent("swift-stage", isDirectory: true)
  try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
  let androidArchive = try Data(contentsOf: exchange.appendingPathComponent("android.zip"))
  let staged = try DatabaseBackupManager.stageBackupArchive(androidArchive, in: stage)
  let importedAndroid = try TelemetryDatabase.openRestoredDatabase(
    at: staged.database,
    schemaVersion: staged.roomVersion
  )
  try importedAndroid.read { db in
    let board = try String.fetchOne(db, sql: "SELECT name FROM boards WHERE id='cross-board'")
    let setting = try String.fetchOne(db, sql: "SELECT value_json FROM board_settings WHERE board_id='cross-board' AND key='description'")
    let tune = try String.fetchOne(db, sql: "SELECT name FROM tune_profiles WHERE id='cross-tune'")
    let favorite = try String.fetchOne(db, sql: "SELECT name FROM favorites WHERE id='cross-favorite'")
    let config = try String.fetchOne(db, sql: "SELECT values_json FROM board_config_values WHERE board_id='cross-board'")
    let speed = try Int.fetchOne(db, sql: "SELECT speed_centi_kmh FROM telemetry_frames WHERE captured_at_ms=1000")
    try require(board == "Cross Board", "Android archive lost Board on iOS")
    try require(setting == "\"durable\"", "Android archive lost Board setting on iOS")
    try require(tune == "Cross Tune", "Android archive lost Tune Profile on iOS")
    try require(favorite == "Cross Favorite", "Android archive lost Favorite on iOS")
    try require(config == "{\"motor_current_max\":55.5}", "Android archive lost config on iOS")
    try require(speed == 2468, "Android archive lost Ride Recording on iOS")
    let track = try fetchRideTrack(db, fromMs: 0, toMs: 2000, boardId: "cross-board")
    try require(track.count == 1, "Android archive lost independent GPS fix")
    try require(track.first?["recording_id"] as String? == "cross-recording", "Android archive lost GPS recording identity")
    try require(track.first?["accuracy_cm"] as Int? == 3500, "Android archive discarded poor GPS accuracy")
    let endReason = try String.fetchOne(db, sql: "SELECT ended_reason FROM ride_recordings WHERE id='cross-recording'")
    try require(endReason == "stopped", "Android archive lost recording end intent")
  }
  try importedAndroid.close()

  let androidV14Archive = try Data(contentsOf: exchange.appendingPathComponent("android-v14.zip"))
  let v14Stage = exchange.appendingPathComponent("swift-v14-stage", isDirectory: true)
  try FileManager.default.createDirectory(at: v14Stage, withIntermediateDirectories: true)
  let stagedV14 = try DatabaseBackupManager.stageBackupArchive(androidV14Archive, in: v14Stage)
  try require(stagedV14.roomVersion == 14, "first Android archive generation resolved incorrectly")
  let importedV14 = try TelemetryDatabase.openRestoredDatabase(
    at: stagedV14.database,
    schemaVersion: stagedV14.roomVersion
  )
  try importedV14.read { db in
    let board = try String.fetchOne(db, sql: "SELECT name FROM boards WHERE id='board-era3'")
    let description = try String.fetchOne(db, sql: "SELECT value_json FROM board_settings WHERE board_id='board-era3' AND key='description'")
    let eraSetting = try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key='era-setting'")
    let tune = try String.fetchOne(db, sql: "SELECT name FROM tune_profiles WHERE id='v14-tune'")
    let speed = try Int.fetchOne(db, sql: "SELECT speed_centi_kmh FROM telemetry_frames WHERE captured_at_ms=1000")
    let minVoltage = try Int.fetchOne(db, sql: "SELECT min_battery_voltage_mv FROM telemetry_minute_buckets WHERE bucket_start_ms=960")
    let gpsDistance = try Int.fetchOne(db, sql: "SELECT gps_distance_cm FROM telemetry_minute_buckets WHERE bucket_start_ms=960")
    let privacyZonesExist = try db.tableExists("privacy_zones")
    let ledger = try TelemetryDatabase.migrator.appliedIdentifiers(db)
    try require(board == "Era Three", "v14 archive lost Board")
    try require(description == "\"kept\"", "v14 archive lost migrated Board setting")
    try require(eraSetting == "\"preserved\"", "v14 archive lost app setting")
    try require(tune == "V14 Tune", "v14 archive lost pre-presentation Tune Profile")
    try require(speed == 1234, "v14 archive lost Ride Recording")
    try require(minVoltage == 50000, "v14 archive lost bucket battery value")
    try require(gpsDistance == 20, "v14 archive lost bucket GPS value")
    try require(privacyZonesExist, "v14 archive skipped privacy-zone migration")
    try require(ledger == Set(migrationIdentifiers), "v14 archive did not reach final GRDB ledger")
  }
  try importedV14.close()

  for version in [18, 19, 20] {
    let archive = try Data(contentsOf: exchange.appendingPathComponent("android-v\(version).zip"))
    let stage = exchange.appendingPathComponent("swift-v\(version)-stage", isDirectory: true)
    try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
    let staged = try DatabaseBackupManager.stageBackupArchive(archive, in: stage)
    let imported = try TelemetryDatabase.openRestoredDatabase(
      at: staged.database,
      schemaVersion: staged.roomVersion
    )
    try imported.read { db in
      let zone = try Row.fetchOne(db, sql: "SELECT * FROM privacy_zones WHERE id='era-zone'")
      let battery = try String.fetchOne(db, sql: "SELECT value_json FROM board_settings WHERE board_id='board-era3' AND key='batteryConfig'")
      let ledger = try TelemetryDatabase.migrator.appliedIdentifiers(db)
      try require(zone?["name"] as String? == "Era Zone", "v\(version) archive lost Privacy Zone name")
      try require(zone?["enabled"] as Int? == 1, "v\(version) archive lost Privacy Zone state")
      try require(zone?["center_latitude_e7"] as Int64? == 510_000_000, "v\(version) archive lost Privacy Zone latitude")
      try require(zone?["center_longitude_e7"] as Int64? == 170_000_000, "v\(version) archive lost Privacy Zone longitude")
      try require(zone?["radius_meters"] as Int64? == 250, "v\(version) archive lost Privacy Zone radius")
      if version >= 19 {
        try require(battery == "{\"cells\":20}", "v\(version) archive lost migrated battery config")
      }
      try require(ledger == Set(migrationIdentifiers), "v\(version) archive did not reach final GRDB ledger")
    }
    try imported.close()
  }

  let iosDatabaseURL = exchange.appendingPathComponent("ios.sqlite")
  let iosDatabase = try DatabaseQueue(path: iosDatabaseURL.path)
  try TelemetryDatabase.migrator.migrate(iosDatabase)
  try iosDatabase.write { db in
    try db.execute(sql: "INSERT INTO boards (id,name,ble_id,transport,created_at) VALUES ('cross-board','Cross Board','cross-ble','direct',100)")
    try db.execute(sql: "INSERT INTO board_settings VALUES ('cross-board','description','\"durable\"',101)")
    try db.execute(sql: "INSERT INTO app_settings VALUES ('cross-setting','\"ios\"',102)")
    try db.execute(sql: "INSERT INTO tune_profiles (id,board_id,name,icon,color,fields_json,created_at,updated_at,refloat_base_version) VALUES ('cross-tune','cross-board','Cross Tune','gauge','orange','{\"kp\":2}',103,104,'2.0')")
    try db.execute(sql: "INSERT INTO favorites (id,board_id,name,start_ms,end_ms,created_at,updated_at,sample_count,gps_point_count,distance_cm,moving_duration_ms,avg_speed_centi_kmh,max_speed_centi_kmh,battery_used_wh_milli) VALUES ('cross-favorite','cross-board','Cross Favorite',900,1100,105,106,1,0,200,100,2400,2468,2)")
    try db.execute(sql: "INSERT INTO board_config_values VALUES ('cross-board','2.0','{\"motor_current_max\":55.5}',107)")
    try db.execute(sql: "INSERT INTO telemetry_frames (captured_at_ms,elapsed_realtime_ms,board_id,flags,changed_mask_1,changed_mask_2,speed_centi_kmh) VALUES (1000,10,'cross-board',1,1,0,2468)")
    try db.execute(sql: "INSERT INTO vesc_fault_occurrences VALUES ('cross-fault','cross-board',7,1000,1001,NULL,0)")
    try db.execute(sql: "INSERT INTO vesc_fault_captures VALUES ('cross-fault','cross-board',900,1000,1)")
    try db.execute(sql: "INSERT INTO vesc_fault_capture_samples (occurrence_id,captured_at,speed,state) VALUES ('cross-fault',1000,24.68,1)")
    try insertRideRecording(db, RideRecording(id: "cross-recording", boardId: "cross-board", startedAtMs: 900, endedAtMs: 1500, endedReason: "stopped"))
    try insertRideTrackPoint(db, RideTrackPoint(recordingId: "cross-recording", boardId: "cross-board", fixAtMs: 1200, latitudeE7: 510000000, longitudeE7: 170000000, accuracyCm: 3500, gpsSpeedCentiMps: 400, bearingCentiDeg: 9000, altitudeCm: 12300))
    try db.execute(sql: "PRAGMA user_version = \(TELEMETRY_SCHEMA_VERSION)")
  }
  try iosDatabase.close()
  let iosData = try Data(contentsOf: iosDatabaseURL)
  let iosManifest = try DatabaseBackupArchive.manifest(
    platform: "ios", schemaVersion: TELEMETRY_SCHEMA_VERSION, appVersion: "host",
    dbSizeBytes: Int64(iosData.count), createdAt: 1
  )
  try DatabaseBackupArchive.archive(database: iosData, manifest: iosManifest)
    .write(to: exchange.appendingPathComponent("ios.zip"), options: .atomic)
}
print("recording-contract macOS runtimeMs=\(Int(Date().timeIntervalSince(started) * 1000)) scenario=\(fixture["scenario"]!)")

private extension String {
  mutating func replace(_ target: String, with replacement: String, maxReplacements: Int) {
    guard maxReplacements > 0, let range = range(of: target, options: .backwards) else { return }
    replaceSubrange(range, with: replacement)
  }
}
