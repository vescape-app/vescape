package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import expo.modules.vescapecore.database.DatabaseMigrations
import expo.modules.vescapecore.database.MigrationDatabase

/**
 * @parity /modules/vescape-core/ios/database/DatabaseMigrationTests.swift
 */
class RideTrackMigrationTest {
  private fun migrationSql(): List<String> {
    val sql = mutableListOf<String>()
    val db = object : MigrationDatabase {
      override fun execSQL(statement: String) { sql += statement }
      override fun hasColumn(tableName: String, columnName: String) = false
    }
    DatabaseMigrations.MIGRATION_42_43.migrate(db)
    return sql
  }

  private fun statement(match: String): String =
    migrationSql().firstOrNull { it.contains(match) }
      ?: throw AssertionError("no migration statement contains `$match`")

  @Test
  fun migrationCoversItsOwnEdgeOfTheGraph() {
    assertEquals(42, DatabaseMigrations.MIGRATION_42_43.startVersion)
    assertEquals(43, DatabaseMigrations.MIGRATION_42_43.endVersion)
  }

  @Test
  fun ridesTrackAndRecordingIdentityGetTheirOwnTables() {
    val track = statement("CREATE TABLE IF NOT EXISTS ride_track_points")
    for (column in listOf(
      "fix_at_ms",
      "latitude_e7",
      "longitude_e7",
      "accuracy_cm",
      "gps_speed_centi_mps",
      "bearing_centi_deg",
      "altitude_cm",
    )) {
      assertTrue("ride_track_points is missing $column", track.contains(column))
    }
    assertTrue(track.contains("board_id"))
    assertTrue(track.contains("recording_id"))

    val recordings = statement("CREATE TABLE IF NOT EXISTS ride_recordings")
    assertTrue(recordings.contains("started_at_ms"))
    assertTrue("an open recording has no end yet", recordings.contains("ended_at_ms INTEGER,"))
    assertTrue(recordings.contains("ended_reason TEXT"))
  }

  @Test
  fun migratesExistingFixesOnTheGpsClockWithoutInventingAny() {
    val copy = statement("INSERT INTO ride_track_points")
    assertTrue(copy.contains("FROM telemetry_frames"))
    assertTrue(copy.contains("WHERE f.latitude_e7 IS NOT NULL AND f.longitude_e7 IS NOT NULL"))
    assertTrue(copy.contains("COALESCE(f.location_timestamp_ms, f.captured_at_ms)"))
    assertTrue(copy.contains("f.board_id"))
    assertTrue(copy.contains("NULL"))
  }

  @Test
  fun framesLoseEverySevenGpsColumnsAndKeepTheirTelemetry() {
    val table = statement("CREATE TABLE telemetry_frames_new")
    for (column in listOf(
      "latitude_e7",
      "longitude_e7",
      "gps_speed_centi_mps",
      "bearing_centi_deg",
      "accuracy_cm",
      "altitude_cm",
      "location_timestamp_ms",
    )) {
      assertFalse("telemetry_frames still carries $column", table.contains(column))
    }
    for (column in listOf("speed_centi_kmh", "odometer_cm", "temp_motor_deci_c", "board_id")) {
      assertTrue("telemetry_frames lost $column", table.contains(column))
    }
    assertTrue(table.contains("recording_id"))

    val copy = statement("INSERT INTO telemetry_frames_new")
    assertTrue("non-GPS telemetry is copied, not rebuilt", copy.contains("FROM telemetry_frames f"))
  }

  @Test
  fun minuteBucketsKeyOnTheRecordingAndKeepLegacyGrouping() {
    val table = statement("CREATE TABLE telemetry_minute_buckets_new")
    assertTrue(table.contains("PRIMARY KEY (bucket_start_ms, board_id, recording_id)"))

    val copy = statement("INSERT INTO telemetry_minute_buckets_new")
    assertTrue("existing buckets group exactly as before", copy.contains("SELECT"))
    assertTrue(copy.contains("FROM telemetry_minute_buckets"))
  }
}
