import Foundation
import GRDB

/// DB-backed storage for VESC Fault Captures: one metadata row per occurrence plus its append-only
/// decoded samples. Deliberately outside Ride History — no GPS, no telemetry frames, no minute
/// buckets, and no retention pruning ever touches these rows.
///
/// Overlapping captures duplicate samples on purpose, so a sample row belongs to exactly one
/// occurrence and each occurrence stays independently inspectable.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt
struct VescFaultCaptureStore: VescFaultCaptureStoring {
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
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS vesc_fault_captures (
        occurrence_id TEXT NOT NULL PRIMARY KEY,
        board_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        opened_at INTEGER NOT NULL,
        sample_count INTEGER NOT NULL
      )
      """)
    try db.execute(sql: """
      CREATE INDEX IF NOT EXISTS index_vesc_fault_captures_board_id
      ON vesc_fault_captures(board_id)
      """)
    try db.execute(sql: """
      CREATE TABLE IF NOT EXISTS vesc_fault_capture_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurrence_id TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        speed REAL,
        duty_cycle REAL,
        erpm REAL,
        battery_voltage REAL,
        battery_current REAL,
        motor_current REAL,
        temp_mosfet REAL,
        temp_motor REAL,
        pitch REAL,
        roll REAL,
        balance_pitch REAL,
        adc1 REAL,
        adc2 REAL,
        state INTEGER
      )
      """)
    try db.execute(sql: """
      CREATE INDEX IF NOT EXISTS index_vesc_fault_capture_samples_occurrence_id_captured_at
      ON vesc_fault_capture_samples(occurrence_id, captured_at)
      """)
  }

  // MARK: - Writes

  func upsertCapture(_ capture: VescFaultCapture) {
    guard let writer = resolveWriter() else { return }
    try? writer.write { db in
      try db.execute(
        sql: """
          INSERT INTO vesc_fault_captures
            (occurrence_id, board_id, started_at, opened_at, sample_count)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(occurrence_id) DO UPDATE SET
            sample_count = excluded.sample_count
          """,
        arguments: [
          capture.occurrenceId, capture.boardId, capture.startedAtMs, capture.openedAtMs,
          capture.sampleCount,
        ]
      )
    }
  }

  func appendSamples(_ occurrenceId: String, _ samples: [VescFaultCaptureSample]) {
    guard !samples.isEmpty, let writer = resolveWriter() else { return }
    try? writer.write { db in
      for sample in samples {
        try db.execute(
          sql: """
            INSERT INTO vesc_fault_capture_samples
              (occurrence_id, captured_at, speed, duty_cycle, erpm, battery_voltage, battery_current,
               motor_current, temp_mosfet, temp_motor, pitch, roll, balance_pitch, adc1, adc2, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
          arguments: [
            occurrenceId, sample.capturedAtMs, sample.speed, sample.dutyCycle, sample.erpm,
            sample.batteryVoltage, sample.batteryCurrent, sample.motorCurrent, sample.tempMosfet,
            sample.tempMotor, sample.pitch, sample.roll, sample.balancePitch, sample.adc1,
            sample.adc2, sample.state,
          ]
        )
      }
    }
  }

  // MARK: - Reads

  func getCapture(_ occurrenceId: String) -> VescFaultCapture? {
    guard let writer = resolveWriter() else { return nil }
    return try? writer.read { db in
      try Row.fetchOne(
        db,
        sql: "SELECT * FROM vesc_fault_captures WHERE occurrence_id = ? LIMIT 1",
        arguments: [occurrenceId]
      ).map { row in
        VescFaultCapture(
          occurrenceId: row["occurrence_id"] as String,
          boardId: row["board_id"] as String,
          startedAtMs: row["started_at"] as Int64,
          openedAtMs: row["opened_at"] as Int64,
          sampleCount: row["sample_count"] as Int
        )
      }
    } ?? nil
  }

  func getSamples(_ occurrenceId: String) -> [VescFaultCaptureSample] {
    guard let writer = resolveWriter() else { return [] }
    return (try? writer.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT * FROM vesc_fault_capture_samples WHERE occurrence_id = ?
          ORDER BY captured_at ASC, id ASC
          """,
        arguments: [occurrenceId]
      ).map { row in
        VescFaultCaptureSample(
          capturedAtMs: row["captured_at"] as Int64,
          speed: row["speed"] as Double?,
          dutyCycle: row["duty_cycle"] as Double?,
          erpm: row["erpm"] as Double?,
          batteryVoltage: row["battery_voltage"] as Double?,
          batteryCurrent: row["battery_current"] as Double?,
          motorCurrent: row["motor_current"] as Double?,
          tempMosfet: row["temp_mosfet"] as Double?,
          tempMotor: row["temp_motor"] as Double?,
          pitch: row["pitch"] as Double?,
          roll: row["roll"] as Double?,
          balancePitch: row["balance_pitch"] as Double?,
          adc1: row["adc1"] as Double?,
          adc2: row["adc2"] as Double?,
          state: row["state"] as Int?
        )
      }
    }) ?? []
  }
}
