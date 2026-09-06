import GRDB
import XCTest
@testable import VescapeCore

final class TelemetryPersistenceTests: XCTestCase {
  private var dbQueue: DatabaseQueue!

  override func setUpWithError() throws {
    dbQueue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(dbQueue)
  }

  private func state() -> FullTelemetryState {
    FullTelemetryState(capture: TelemetryCapture(
      capturedAtMs: 1_800_000, elapsedRealtimeMs: 100, boardId: "board-1", canId: nil,
      telemetry: RefloatTelemetry(
        hasFault: false, faultCode: 0, pitch: 0, roll: 0, balancePitch: 0,
        balanceCurrent: 0, speed: 15, batteryVoltage: 80, motorCurrent: 5,
        batteryCurrent: 2, erpm: 1000, dutyCycle: 0.2, state: 1, switchState: 2,
        adc1: 1, adc2: 1, odometer: 123, tempMosfet: 30, tempMotor: 35,
        avgLatency: nil, pullRateHz: nil, lastPacketAt: 1_800_000
      ), location: nil
    ))
  }

  func testRecordedFramePersistsOnCurrentSchema() throws {
    try dbQueue.write { db in
      try insertFrame(db, state())
      let row = try XCTUnwrap(Row.fetchOne(db, sql: "SELECT * FROM telemetry_frames"))
      XCTAssertEqual(row["board_id"] as String, "board-1")
      XCTAssertEqual(row["speed_centi_kmh"] as Int, 1500)
    }
  }

  func testRecordedBucketsPersistAndAppearInHistory() throws {
    try dbQueue.write { db in
      let bucket = try XCTUnwrap(buildTelemetryBuckets([state().toBucketPoint()]).first)
      try upsertBucket(db, bucket)
      try upsertBucket(db, bucket)
      let rows = try Row.fetchAll(db, sql: "SELECT * FROM telemetry_minute_buckets")
      let rides = groupRideSessions(buckets: rows, markers: [], gapMs: 1_800_000)
        .filter { $0.avgSpeedSampleCount > 0 }
      XCTAssertEqual(rides.count, 1)
      XCTAssertEqual(rides.first?.sampleCount, 2)
      XCTAssertEqual(rides.first?.avgSpeedSampleCount, 2)
      XCTAssertEqual(rides.first?.startAtMs, 1_800_000)
    }
  }
}
