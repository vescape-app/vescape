package expo.modules.vescapecore.telemetry

/** Schema generations with a complete production Room migration path to the current database. */
internal val SUPPORTED_ANDROID_DATABASE_VERSIONS: Set<Int> =
  ((3..36) + (40..TELEMETRY_DATABASE_VERSION)).toSet()

/** Android backup export first shipped with database version 14 (commit dc985d80). */
internal val EXPORTED_ANDROID_DATABASE_VERSIONS: Set<Int> =
  ((14..36) + (40..TELEMETRY_DATABASE_VERSION)).toSet()
internal val EXPORTED_IOS_DATABASE_VERSIONS: Set<Int> =
  (setOf(1) + (23..36) + (40..TELEMETRY_DATABASE_VERSION)).toSet()

internal fun roomVersionForBackup(platform: String, version: Int): Int = when (platform) {
  "android" -> version.also { require(it in EXPORTED_ANDROID_DATABASE_VERSIONS) }
  // A legacy iOS v1 manifest is resolved from its exact GRDB ledger after opening the candidate.
  "ios" -> version.also { require(it in EXPORTED_IOS_DATABASE_VERSIONS) }
  else -> throw IllegalArgumentException("Unsupported backup platform $platform")
}

internal fun requireSupportedAndroidDatabaseVersion(version: Int) {
  require(version in SUPPORTED_ANDROID_DATABASE_VERSIONS) {
    "Backup schema version $version has no supported migration path to app schema $TELEMETRY_DATABASE_VERSION"
  }
}

/** SQL shared by the Android adapter and JVM host when accepting a GRDB-owned schema. */
internal fun iosSchemaReconciliationStatements(
  hasDeletedAt: Boolean,
  hasFaultCaptures: Boolean,
  bootstrapLegacyTune: Boolean,
): List<String> = buildList {
  add("""INSERT OR REPLACE INTO board_settings (board_id,key,value_json,updated_at) SELECT id,'transport',json_quote(transport),created_at FROM boards WHERE transport IS NOT NULL""")
  add("DROP INDEX IF EXISTS index_boards_created_at")
  add("CREATE TABLE boards_room (id TEXT NOT NULL PRIMARY KEY,name TEXT NOT NULL,ble_id TEXT,created_at INTEGER NOT NULL,deleted_at INTEGER)")
  add("INSERT INTO boards_room SELECT id,name,ble_id,created_at,${if (hasDeletedAt) "deleted_at" else "NULL"} FROM boards")
  add("DROP TABLE boards")
  add("ALTER TABLE boards_room RENAME TO boards")
  add("CREATE INDEX index_boards_created_at ON boards(created_at)")
  // GRDB releases before this fix declared the auto-generated id nullable in SQLite metadata;
  // Room requires the entity's non-null contract. Rebuild preserves every evidence sample.
  if (hasFaultCaptures) {
    add("ALTER TABLE vesc_fault_capture_samples RENAME TO vesc_fault_capture_samples_ios")
    add("CREATE TABLE vesc_fault_capture_samples (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,occurrence_id TEXT NOT NULL,captured_at INTEGER NOT NULL,speed REAL,duty_cycle REAL,erpm REAL,battery_voltage REAL,battery_current REAL,motor_current REAL,temp_mosfet REAL,temp_motor REAL,pitch REAL,roll REAL,balance_pitch REAL,adc1 REAL,adc2 REAL,state INTEGER)")
    add("INSERT INTO vesc_fault_capture_samples SELECT * FROM vesc_fault_capture_samples_ios")
    add("DROP TABLE vesc_fault_capture_samples_ios")
    add("CREATE INDEX index_vesc_fault_capture_samples_occurrence_id_captured_at ON vesc_fault_capture_samples(occurrence_id,captured_at)")
  }
  if (bootstrapLegacyTune) {
    add("CREATE TABLE tune_profiles (id TEXT NOT NULL PRIMARY KEY,board_id TEXT NOT NULL,name TEXT NOT NULL,fields_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)")
    add("CREATE INDEX index_tune_profiles_board_id ON tune_profiles(board_id)")
    add("CREATE TABLE tune_history_entries (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,profile_id TEXT NOT NULL,fields_json TEXT NOT NULL,created_at INTEGER NOT NULL)")
    add("CREATE INDEX index_tune_history_entries_profile_id ON tune_history_entries(profile_id)")
    add("CREATE INDEX index_tune_history_entries_created_at ON tune_history_entries(created_at)")
  }
}
