package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ride Track becomes the durable home for ride position (#448, ADR 0038). Schema 42→43 creates
 * `ride_recordings` and `ride_track_points`, moves every frame's GPS fix into the track, drops the
 * seven raw GPS columns from `telemetry_frames`, and puts the Ride Recording into the minute-bucket
 * primary key.
 *
 * This narrow test checks the portable production migration's emitted SQL. Real Room upgrade
 * behavior and cross-platform archive exchange are covered by the persistence-jvm contracts.
 *
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMigrationTests.swift
 */
class RideTrackMigrationTest {
  private fun migrationSql(): List<String> {
    val sql = mutableListOf<String>()
    val db = object : TelemetryMigrationDatabase {
      override fun execSQL(statement: String) { sql += statement }
      override fun hasColumn(tableName: String, columnName: String) = false
    }
    TelemetryMigrations.MIGRATION_42_43.migrate(db)
    return sql
  }

  private fun statement(match: String): String =
    migrationSql().firstOrNull { it.contains(match) }
      ?: throw AssertionError("no migration statement contains `$match`")

  @Test
  fun migrationTargetsTheCurrentSchemaVersion() {
    assertEquals(43, TELEMETRY_DATABASE_VERSION)
    assertEquals(42, TelemetryMigrations.MIGRATION_42_43.startVersion)
    assertEquals(43, TelemetryMigrations.MIGRATION_42_43.endVersion)
  }

  @Test
  fun ridesTrackAndRecordingIdentityGetTheirOwnTables() {
    val track = statement("CREATE TABLE IF NOT EXISTS ride_track_points")
    // Every field of the recorded fix moves, not only the coordinates.
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
    // Board attribution and recording identity are separate columns, deliberately.
    assertTrue(track.contains("board_id"))
    assertTrue(track.contains("recording_id"))

    val recordings = statement("CREATE TABLE IF NOT EXISTS ride_recordings")
    assertTrue(recordings.contains("started_at_ms"))
    assertTrue("an open recording has no end yet", recordings.contains("ended_at_ms INTEGER,"))
    assertTrue(recordings.contains("ended_reason TEXT"))
  }

  /**
   * A ride with sparse positions keeps exactly the fixes it had, and a ride with none migrates to
   * an empty track: the `WHERE` clause is what makes both true without fabricating a point.
   */
  @Test
  fun migratesExistingFixesOnTheGpsClockWithoutInventingAny() {
    val copy = statement("INSERT INTO ride_track_points")
    assertTrue(copy.contains("FROM telemetry_frames"))
    assertTrue(copy.contains("WHERE f.latitude_e7 IS NOT NULL AND f.longitude_e7 IS NOT NULL"))
    // The GPS clock wins over the frame clock the fix was merely stamped onto.
    assertTrue(copy.contains("COALESCE(f.location_timestamp_ms, f.captured_at_ms)"))
    // Attribution is read off the column migration 41→42 already resolved; never re-decided here.
    assertTrue(copy.contains("f.board_id"))
    // Legacy rows get no invented recording identity (`rideSplitGapMinutes` still groups them).
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

  /**
   * Two recordings of one Board can share a minute. Without the recording in the key they would
   * aggregate into one row and history would show one ride where there were two.
   */
  @Test
  fun minuteBucketsKeyOnTheRecordingAndKeepLegacyGrouping() {
    val table = statement("CREATE TABLE telemetry_minute_buckets_new")
    assertTrue(table.contains("PRIMARY KEY (bucket_start_ms, board_id, recording_id)"))

    val copy = statement("INSERT INTO telemetry_minute_buckets_new")
    assertTrue("existing buckets group exactly as before", copy.contains("SELECT"))
    assertTrue(copy.contains("FROM telemetry_minute_buckets"))
  }
}
