package expo.modules.vescapecore.telemetry

import android.database.Cursor
import androidx.sqlite.db.SupportSQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.lang.reflect.Proxy
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.database.VescapeDatabase

/**
 * @parity /modules/vescape-core/ios/database/DatabaseMigrationTests.swift
 */
class TelemetryBoardIdMigrationTest {
  private fun migrationSql(): List<String> {
    val sql = mutableListOf<String>()
    val db = Proxy.newProxyInstance(
      SupportSQLiteDatabase::class.java.classLoader,
      arrayOf(SupportSQLiteDatabase::class.java),
    ) { _, method, args ->
      when (method.name) {
        "execSQL" -> {
          sql += args?.firstOrNull() as String
          null
        }
        "query" -> emptyCursor()
        else -> throw UnsupportedOperationException(method.name)
      }
    } as SupportSQLiteDatabase
    VescapeDatabase.MIGRATION_41_42.migrate(db)
    return sql
  }

  private fun emptyCursor(): Cursor = Proxy.newProxyInstance(
    Cursor::class.java.classLoader,
    arrayOf(Cursor::class.java),
  ) { _, method, _ ->
    when (method.name) {
      "getColumnIndex" -> 0
      "moveToNext" -> false
      "close" -> null
      else -> throw UnsupportedOperationException(method.name)
    }
  } as Cursor

  private fun daoSource(): String =
    File("src/main/java/expo/modules/vescapecore/database/VescapeDao.kt").readText()

  private fun statement(match: String): String =
    migrationSql().firstOrNull { it.contains(match) }
      ?: throw AssertionError("no migration statement contains `$match`")

  @Test
  fun migrationSpansTheBoardIdSchemaStep() {
    assertEquals(41, VescapeDatabase.MIGRATION_41_42.startVersion)
    assertEquals(42, VescapeDatabase.MIGRATION_41_42.endVersion)
  }

  @Test
  fun bothTablesBackfillBoardIdByMatchingTheBleIdentifier() {
    for (match in listOf("INSERT INTO telemetry_frames_new", "INSERT INTO telemetry_minute_buckets_new")) {
      val sql = statement(match)
      assertTrue(
        "$match does not resolve device_id through the shared identifier map",
        sql.contains("SELECT m.board_id FROM telemetry_device_board_map m WHERE m.device_id ="),
      )
    }
  }

  @Test
  fun aDuplicatedIdentifierIsResolvedOnceSoTheTwoRebuildsCannotDiverge() {
    val sql = migrationSql()
    val map = sql.indexOfFirst { it.startsWith("INSERT INTO telemetry_device_board_map") }
    val firstRebuild = sql.indexOfFirst { it.contains("INSERT INTO telemetry_frames_new") }

    assertTrue("the identifier is never resolved into a shared decision", map >= 0)
    assertTrue("the map is filled after the rebuilds have already read it", map < firstRebuild)
    assertTrue(
      "claimants are not folded to one deterministic pick per identifier",
      sql[map].contains("MIN(b.id)") && sql[map].contains("GROUP BY b.ble_id"),
    )
    for (match in listOf("INSERT INTO telemetry_frames_new", "INSERT INTO telemetry_minute_buckets_new")) {
      assertFalse(
        "$match still resolves the identifier against boards, so it can pick its own claimant",
        statement(match).contains("FROM boards"),
      )
    }
  }

  @Test
  fun theIdentifierMapIsBuiltAfterTheOrphanMintAndDroppedAfterTheRebuilds() {
    val sql = migrationSql()
    val mint = sql.indexOfFirst { it.startsWith("INSERT OR IGNORE INTO boards") }
    val map = sql.indexOfFirst { it.startsWith("CREATE TEMP TABLE telemetry_device_board_map") }
    val dropped = sql.indexOfFirst { it.contains("DROP TABLE IF EXISTS telemetry_device_board_map") }
    val lastRebuild = sql.indexOfLast { it.contains("INSERT INTO telemetry_minute_buckets_new") }

    assertTrue("the map is built before the mint, so minted Boards are missing from it", mint < map)
    assertTrue("the scratch map outlives the migration", dropped > lastRebuild)
  }

  @Test
  fun framesWithNoIdentifierBackfillToNullAndBucketsToTheUnknownSentinel() {
    assertTrue(
      "frames without a device_id do not backfill to NULL",
      statement("INSERT INTO telemetry_frames_new").contains("device_id = '' THEN NULL"),
    )
    assertTrue(
      "buckets without a device_id do not backfill to the unknown sentinel",
      statement("INSERT INTO telemetry_minute_buckets_new").contains("device_id = '' THEN ''"),
    )
  }

  @Test
  fun unresolvedIdentifiersMintATombstonedBoardNamedFromTheHistoricalDeviceName() {
    for (table in listOf("telemetry_frames", "telemetry_minute_buckets", "telemetry_markers", "diagnostic_events")) {
      val sql = migrationSql().firstOrNull {
        it.startsWith("INSERT OR IGNORE INTO boards") && it.contains("FROM $table t")
      } ?: throw AssertionError("no orphan mint sourced from $table")

      assertTrue(
        "the mint does not skip identifiers a Board still claims",
        sql.contains("NOT EXISTS (SELECT 1 FROM boards b WHERE b.ble_id = t.device_id)"),
      )
      assertTrue(
        "the minted Board is not named from the telemetry's own device_name",
        sql.contains("SELECT n.device_name FROM $table n"),
      )
      assertTrue(
        "the minted Board id is not derived from the identifier, so re-running duplicates it",
        sql.contains("'$ORPHAN_BOARD_ID_PREFIX' || t.device_id"),
      )
    }
  }

  @Test
  fun aMintedBoardIsTombstonedAndCarriesNoBoardLink() {
    val sql = statement("FROM telemetry_frames t")
    val columns = sql.substringAfter("(").substringBefore(")").split(",").map { it.trim() }
    val selected = sql.substringBefore("FROM telemetry_frames t").lines()
      .map { it.trim().trimEnd(',') }
      .filter { it.isNotEmpty() }
      .takeLast(3)

    assertEquals(
      listOf("id", "name", "ble_id", "created_at", "deleted_at"),
      columns,
    )
    assertEquals("a minted Board carries a Board Link", "NULL", selected.first())
    assertTrue("a minted Board is not tombstoned", selected.last().toLongOrNull() != null)
    assertTrue(
      "the Rider's Board list would show minted Boards",
      daoSource().contains("SELECT * FROM boards WHERE deleted_at IS NULL ORDER BY created_at ASC"),
    )
  }

  @Test
  fun theBucketRebuildMovesThePrimaryKey() {
    val create = statement("CREATE TABLE telemetry_minute_buckets_new")
    val copy = statement("INSERT INTO telemetry_minute_buckets_new")

    assertTrue(
      "the bucket primary key is not (bucket_start_ms, board_id)",
      create.contains("PRIMARY KEY (bucket_start_ms, board_id)"),
    )
    assertFalse("the rebuilt bucket table still carries the BLE identifier", create.contains("device_id"))
    assertFalse("the bucket rebuild still copies the Board name", copy.contains("device_name"))
    assertTrue(
      "the rebuilt table is not swapped in",
      migrationSql().contains("ALTER TABLE telemetry_minute_buckets_new RENAME TO telemetry_minute_buckets"),
    )
  }

  @Test
  fun theBucketCopyIsGroupedSoAKeyCollisionCannotAbortTheRebuild() {
    val copy = statement("INSERT INTO telemetry_minute_buckets_new")

    assertTrue("colliding buckets are not folded", copy.contains("GROUP BY b.bucket_start_ms, board_id"))
    assertTrue("sample counts are not summed on a fold", copy.contains("SUM(b.sample_count)"))
    assertTrue("peak speed is not kept on a fold", copy.contains("MAX(b.max_abs_speed_centi_kmh)"))
  }

  @Test
  fun bothRebuiltTablesDropTheBleIdentifierAndTheDenormalizedName() {
    for (table in listOf("telemetry_frames", "telemetry_minute_buckets")) {
      val create = statement("CREATE TABLE ${table}_new")
      assertFalse("$table keeps device_id", create.contains("device_id"))
      assertFalse("$table keeps device_name", create.contains("device_name"))
      assertTrue("$table has no board_id", create.contains("board_id"))
      assertTrue(
        "the rebuilt $table is not swapped in",
        migrationSql().contains("ALTER TABLE ${table}_new RENAME TO $table"),
      )
    }
  }

  @Test
  fun theFrameLookupIndexMovesOntoBoardId() {
    val sql = migrationSql()

    assertTrue(
      "the old device_id index survives the rebuild",
      sql.contains("DROP INDEX IF EXISTS index_telemetry_frames_device_id_captured_at_ms"),
    )
    assertTrue(
      "frames have no board_id lookup index",
      sql.any { it.contains("index_telemetry_frames_board_id_captured_at_ms") },
    )
  }

  @Test
  fun markersDiagnosticEventsAndExclusionRangesMoveOntoBoardIdToo() {
    for (table in listOf("telemetry_markers", "diagnostic_events", "metric_exclusion_ranges")) {
      val create = statement("CREATE TABLE ${table}_new")
      val copy = statement("INSERT INTO ${table}_new")

      assertFalse("$table keeps device_id", create.contains("device_id"))
      assertFalse("$table keeps device_name", create.contains("device_name"))
      assertTrue("$table has no board_id", create.contains("board_id"))
      assertTrue(
        "$table does not resolve its identifier through the shared map",
        copy.contains("SELECT m.board_id FROM telemetry_device_board_map m WHERE m.device_id ="),
      )
      assertTrue(
        "the rebuilt $table is not swapped in",
        migrationSql().contains("ALTER TABLE ${table}_new RENAME TO $table"),
      )
    }
  }

  @Test
  fun markersWithoutABoardStayNullAndRangesTakeTheUnknownSentinel() {
    assertTrue(
      "markers without a device_id do not backfill to NULL",
      statement("INSERT INTO telemetry_markers_new").contains("device_id = '' THEN NULL"),
    )
    assertTrue(
      "ranges without a device_id do not backfill to the unknown sentinel",
      statement("INSERT INTO metric_exclusion_ranges_new").contains("device_id = '' THEN ''"),
    )
  }
}
