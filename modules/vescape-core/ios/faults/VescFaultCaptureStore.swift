import Foundation
import GRDB

/// DB-backed storage for VESC Fault Captures: one metadata row per occurrence plus its retained
/// decoded samples. Deliberately outside Ride History — no GPS, no telemetry frames, no minute
/// buckets, and no retention pruning ever touches these rows.
///
/// Overlapping captures duplicate samples on purpose, so a sample row belongs to exactly one
/// occurrence and each occurrence stays independently inspectable.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct VescFaultCaptureStore: VescFaultCaptureStoring {
  private struct WriterUnavailable: Error {}
  private struct CaptureRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "vesc_fault_captures"
    let occurrenceId: String; let boardId: String; let startedAt: Int64; let openedAt: Int64
    let sampleCount: Int
    enum CodingKeys: String, CodingKey {
      case occurrenceId = "occurrence_id", boardId = "board_id", startedAt = "started_at"
      case openedAt = "opened_at", sampleCount = "sample_count"
    }
    init(_ value: VescFaultCapture) { occurrenceId = value.occurrenceId; boardId = value.boardId; startedAt = value.startedAtMs; openedAt = value.openedAtMs; sampleCount = value.sampleCount }
    var capture: VescFaultCapture { .init(occurrenceId: occurrenceId, boardId: boardId, startedAtMs: startedAt, openedAtMs: openedAt, sampleCount: sampleCount) }
  }
  private struct SampleRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "vesc_fault_capture_samples"
    var id: Int64? = nil
    let occurrenceId: String; let capturedAt: Int64
    let speed, dutyCycle, erpm, batteryVoltage, batteryCurrent, motorCurrent: Double?
    let tempMosfet, tempMotor, pitch, roll, balancePitch, adc1, adc2: Double?
    let state: Int?
    enum CodingKeys: String, CodingKey {
      case id, speed, erpm, pitch, roll, state
      case occurrenceId = "occurrence_id", capturedAt = "captured_at", dutyCycle = "duty_cycle"
      case batteryVoltage = "battery_voltage", batteryCurrent = "battery_current", motorCurrent = "motor_current"
      case tempMosfet = "temp_mosfet", tempMotor = "temp_motor", balancePitch = "balance_pitch", adc1, adc2
    }
    init(_ occurrenceId: String, _ value: VescFaultCaptureSample) {
      self.occurrenceId = occurrenceId; capturedAt = value.capturedAtMs; speed = value.speed
      dutyCycle = value.dutyCycle; erpm = value.erpm; batteryVoltage = value.batteryVoltage
      batteryCurrent = value.batteryCurrent; motorCurrent = value.motorCurrent; tempMosfet = value.tempMosfet
      tempMotor = value.tempMotor; pitch = value.pitch; roll = value.roll; balancePitch = value.balancePitch
      adc1 = value.adc1; adc2 = value.adc2; state = value.state
    }
    var sample: VescFaultCaptureSample { .init(capturedAtMs: capturedAt, speed: speed, dutyCycle: dutyCycle, erpm: erpm, batteryVoltage: batteryVoltage, batteryCurrent: batteryCurrent, motorCurrent: motorCurrent, tempMosfet: tempMosfet, tempMotor: tempMotor, pitch: pitch, roll: roll, balancePitch: balancePitch, adc1: adc1, adc2: adc2, state: state) }
  }
  /// Resolves the shared GRDB writer at call time so it always sees the current pool (swapped on
  /// database restore). `nil` while the pool failed to open.
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = VescFaultCaptureStore { TelemetryDatabase.pool }

  init(_ resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  /// Test seam: bind to an explicit writer (e.g. an in-memory `DatabaseQueue`).
  init(dbWriter: DatabaseWriter) {
    self.resolveWriter = { dbWriter }
  }

  // MARK: - Schema

  /// Create the VESC Fault Capture tables. Called from the app-data `DatabaseMigrator` and reused by
  /// tests so the schema stays single-source.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `VescFaultCaptureEntity`
  static func createTables(_ db: Database) throws {
    try PersistenceSchema.createVescFaultCaptures(db)
  }

  // MARK: - Writes

  func saveCapture(_ capture: VescFaultCapture, samples: [VescFaultCaptureSample]) throws {
    try writer().write { db in
      if try CaptureRecord.fetchOne(db, key: capture.occurrenceId) == nil {
        try CaptureRecord(capture).insert(db)
      } else {
        try CaptureRecord.filter(key: capture.occurrenceId).updateAll(
          db, Column("sample_count").set(to: capture.sampleCount)
        )
      }
      for sample in samples { try SampleRecord(capture.occurrenceId, sample).insert(db) }
    }
  }

  // MARK: - Reads

  func getCapture(_ occurrenceId: String) throws -> VescFaultCapture? {
    try writer().read { db in try CaptureRecord.fetchOne(db, key: occurrenceId)?.capture }
  }

  func getSamples(_ occurrenceId: String) throws -> [VescFaultCaptureSample] {
    try writer().read { db in
      try SampleRecord.filter(Column("occurrence_id") == occurrenceId)
        .order(Column("captured_at"), Column("id")).fetchAll(db).map(\.sample)
    }
  }

  private func writer() throws -> DatabaseWriter {
    guard let writer = resolveWriter() else { throw WriterUnavailable() }
    return writer
  }
}
