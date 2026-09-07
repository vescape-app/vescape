import GRDB

/// Store-owned durable schema, isolated from UIKit/Expo and shared by app migrations + host contracts.
enum PersistenceSchema {
  static func createTuneProfiles(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE tune_profiles (id TEXT NOT NULL PRIMARY KEY, board_id TEXT NOT NULL, refloat_base_version TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'sliders-horizontal', color TEXT NOT NULL DEFAULT 'purple', fields_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
    try db.execute(sql: "CREATE INDEX index_tune_profiles_board_id ON tune_profiles(board_id)")
    try db.execute(sql: "CREATE INDEX index_tune_profiles_board_id_refloat_base_version ON tune_profiles(board_id, refloat_base_version)")
    try db.execute(sql: "CREATE TABLE tune_history_entries (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, profile_id TEXT NOT NULL, fields_json TEXT NOT NULL, created_at INTEGER NOT NULL)")
    try db.execute(sql: "CREATE INDEX index_tune_history_entries_profile_id ON tune_history_entries(profile_id)")
    try db.execute(sql: "CREATE INDEX index_tune_history_entries_created_at ON tune_history_entries(created_at)")
  }

  static func createBoardWarnings(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE board_warnings (board_id TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, first_detected_at INTEGER NOT NULL, last_detected_at INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (board_id, kind))")
    try db.execute(sql: "CREATE INDEX index_board_warnings_board_id ON board_warnings(board_id)")
  }

  static func createFavorites(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE favorites (id TEXT NOT NULL PRIMARY KEY, board_id TEXT, name TEXT, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sample_count INTEGER NOT NULL, gps_point_count INTEGER NOT NULL, distance_cm INTEGER, moving_duration_ms INTEGER NOT NULL, avg_speed_centi_kmh INTEGER NOT NULL, max_speed_centi_kmh INTEGER NOT NULL, battery_used_wh_milli INTEGER NOT NULL)")
    try db.execute(sql: "CREATE INDEX index_favorites_start_ms_end_ms ON favorites(start_ms, end_ms)")
    try db.execute(sql: "CREATE INDEX index_favorites_board_id ON favorites(board_id)")
  }

  static func createFavoriteMedia(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE favorite_media (id TEXT NOT NULL PRIMARY KEY, favorite_id TEXT NOT NULL, captured_at INTEGER, mime_type TEXT NOT NULL, media_kind TEXT NOT NULL, byte_count INTEGER NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL)")
    try db.execute(sql: "CREATE INDEX index_favorite_media_favorite_id_created_at ON favorite_media(favorite_id, created_at)")
  }

  static func createBoardConfig(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS board_config_values (board_id TEXT NOT NULL, refloat_base_version TEXT NOT NULL, values_json TEXT NOT NULL, captured_at INTEGER NOT NULL, PRIMARY KEY (board_id, refloat_base_version))")
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_board_config_values_board_id ON board_config_values(board_id)")
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS board_config_change_notices (board_id TEXT NOT NULL PRIMARY KEY, detected_at INTEGER NOT NULL, diffs_json TEXT NOT NULL)")
  }

  static func createMotorConfig(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS motor_config_values (board_id TEXT NOT NULL, mcconf_signature INTEGER NOT NULL, firmware TEXT NOT NULL, values_json TEXT NOT NULL, captured_at INTEGER NOT NULL, PRIMARY KEY (board_id, mcconf_signature))")
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_motor_config_values_board_id ON motor_config_values(board_id)")
  }

  static func createVescFaults(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS vesc_fault_occurrences (id TEXT NOT NULL PRIMARY KEY, board_id TEXT NOT NULL, code INTEGER NOT NULL, occurred_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL, cleared_at INTEGER, dismissed INTEGER NOT NULL)")
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_vesc_fault_occurrences_board_id_occurred_at ON vesc_fault_occurrences(board_id, occurred_at)")
  }

  static func createVescFaultCaptures(_ db: Database) throws {
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS vesc_fault_captures (occurrence_id TEXT NOT NULL PRIMARY KEY, board_id TEXT NOT NULL, started_at INTEGER NOT NULL, opened_at INTEGER NOT NULL, sample_count INTEGER NOT NULL)")
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_vesc_fault_captures_board_id ON vesc_fault_captures(board_id)")
    try db.execute(sql: "CREATE TABLE IF NOT EXISTS vesc_fault_capture_samples (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, occurrence_id TEXT NOT NULL, captured_at INTEGER NOT NULL, speed REAL, duty_cycle REAL, erpm REAL, battery_voltage REAL, battery_current REAL, motor_current REAL, temp_mosfet REAL, temp_motor REAL, pitch REAL, roll REAL, balance_pitch REAL, adc1 REAL, adc2 REAL, state INTEGER)")
    try db.execute(sql: "CREATE INDEX IF NOT EXISTS index_vesc_fault_capture_samples_occurrence_id_captured_at ON vesc_fault_capture_samples(occurrence_id, captured_at)")
  }
}
