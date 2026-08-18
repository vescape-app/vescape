package expo.modules.vescapecore.telemetry

import android.database.Cursor
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.lang.reflect.Proxy

/**
 * Incremental-sync cursors: schema 31→32 adds `updated_at` to `boards`, `alerts` and
 * `telemetry_minute_buckets`, backfills it from each table's best evidence of last change, and
 * indexes it. Schema 32→33 then splits the two jobs that column was doing — `sync_seq` carries the
 * Sync Cursor, `updated_at` stays the last-write-wins timestamp. Every write path has to move both.
 *
 * @parity /modules/vescape-core/ios/telemetry/SyncCursorMigrationTests.swift
 */
class SyncCursorMigrationTest {
  /** Table → the column its pre-32 rows backfill from. */
  private val backfillSource = mapOf(
    "boards" to "created_at",
    "alerts" to "created_at",
    "telemetry_minute_buckets" to "last_sample_at_ms",
  )

  private fun migrationSql(migration: Migration): List<String> {
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
    migration.migrate(db)
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

  private fun migrationSql(): List<String> = migrationSql(TelemetryDatabase.MIGRATION_31_32)

  private fun daoSource(): String =
    File("src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt").readText()

  @Test
  fun migrationAddsUpdatedAtColumnAndIndexToEverySyncedTable() {
    val sql = migrationSql()

    for (table in backfillSource.keys) {
      assertTrue(
        "missing updated_at column on $table",
        sql.any { it == "ALTER TABLE $table ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0" },
      )
      assertTrue(
        "missing updated_at index on $table",
        sql.any {
          it == "CREATE INDEX IF NOT EXISTS index_${table}_updated_at ON $table(updated_at)"
        },
      )
    }
  }

  /**
   * The backfill is the whole point of shipping this as a migration rather than a plain column add:
   * a row left at the `DEFAULT 0` would report epoch zero to the server and get re-synced forever.
   */
  @Test
  fun migrationBackfillsExistingRowsInsteadOfLeavingThemAtZero() {
    val sql = migrationSql()

    for ((table, source) in backfillSource) {
      val added = sql.indexOf("ALTER TABLE $table ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
      val backfilled = sql.indexOf("UPDATE $table SET updated_at = $source")
      assertTrue("missing backfill for $table", backfilled >= 0)
      // The backfill only works once the column exists.
      assertTrue("backfill for $table runs before the column is added", backfilled > added)
    }
  }

  @Test
  fun migrationsTargetTheCurrentSchemaVersion() {
    assertEquals(39, TELEMETRY_DATABASE_VERSION)
    assertEquals(31, TelemetryDatabase.MIGRATION_31_32.startVersion)
    assertEquals(32, TelemetryDatabase.MIGRATION_31_32.endVersion)
    assertEquals(32, TelemetryDatabase.MIGRATION_32_33.startVersion)
    assertEquals(33, TelemetryDatabase.MIGRATION_32_33.endVersion)
    assertEquals(35, TelemetryDatabase.MIGRATION_35_36.startVersion)
    assertEquals(36, TelemetryDatabase.MIGRATION_35_36.endVersion)
  }

  /**
   * The regression this whole change exists to prevent. `setAlertRuleEnabled` is a targeted UPDATE
   * rather than an entity round-trip, so it is the one write path that can silently skip both sync
   * columns — toggling an alert would then never reach the server.
   *
   * Asserted against the DAO source because Room's `@Query` has BINARY retention (invisible to
   * runtime reflection) and its generated implementation keeps the SQL in a method-local string.
   * A JVM unit test has no other handle on the statement Room will actually run.
   */
  @Test
  fun setAlertRuleEnabledQueryMovesBothSyncColumns() {
    // The statement is written as a concatenation to stay inside the line limit; join it back up
    // before matching so the test sees the string Room will compile.
    val dao = daoSource().replace(Regex("""\"\s*\+\s*\""""), "")
    val query = Regex("""\"(UPDATE alerts SET[^"]*)\"""").find(dao)?.groupValues?.get(1)

    assertEquals(
      "UPDATE alerts SET enabled = :enabled, updated_at = MAX(updated_at + 1, :updatedAt), " +
        "sync_seq = :syncSeq WHERE board_id = :boardId AND id = :id",
      query,
    )
  }

  // MARK: Sync Cursor sequence (#275)

  /**
   * The Sync Cursor scan runs on `sync_seq`, not on `updated_at`. A wall clock that steps backwards
   * lands a write below a cursor the phone has already passed, and the scan never picks it up; a
   * counter cannot regress.
   */
  @Test
  fun syncSeqMigrationAddsColumnIndexAndCounterToEverySyncedTable() {
    val sql = migrationSql(TelemetryDatabase.MIGRATION_32_33)

    assertTrue(
      "missing sync_sequences table",
      sql.any { it.contains("CREATE TABLE IF NOT EXISTS sync_sequences") },
    )
    for (table in SYNC_SEQ_TABLES_V33) {
      assertTrue(
        "missing sync_seq column on $table",
        sql.any { it == "ALTER TABLE $table ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0" },
      )
      assertTrue(
        "missing sync_seq index on $table",
        sql.any { it == "CREATE INDEX IF NOT EXISTS index_${table}_sync_seq ON $table(sync_seq)" },
      )
      assertTrue(
        "missing counter seed for $table",
        sql.any { it.contains("INSERT OR REPLACE INTO sync_sequences") && it.contains("'$table'") },
      )
    }
  }

  /**
   * Existing rows need distinct, increasing positions and the counter has to resume above all of
   * them, or the first writes after upgrade reuse numbers the scan would order wrongly.
   */
  @Test
  fun syncSeqMigrationBackfillsExistingRowsBeforeSeedingTheCounter() {
    val sql = migrationSql(TelemetryDatabase.MIGRATION_32_33)

    for (table in SYNC_SEQ_TABLES_V33) {
      val backfilled = sql.indexOf("UPDATE $table SET sync_seq = rowid")
      val seeded = sql.indexOfFirst {
        it.contains("INSERT OR REPLACE INTO sync_sequences") && it.contains("'$table'")
      }
      assertTrue("missing sync_seq backfill for $table", backfilled >= 0)
      assertTrue("counter for $table is seeded before its rows are numbered", seeded > backfilled)
    }
  }

  /** Every entity write path stamps a fresh position, including the merge branch for buckets. */
  @Test
  fun everyEntityWritePathAllocatesASyncSeq() {
    val dao = daoSource()

    for (marker in listOf(
      "syncSeq = nextSyncSeq(SYNC_SEQ_BOARDS)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_ALERTS)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_MINUTE_BUCKETS)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_BOARD_SETTINGS)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_BOARD_WARNINGS)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_PRIVACY_ZONES)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_TUNE_PROFILES)",
      "syncSeq = nextSyncSeq(SYNC_SEQ_FAVORITES)",
    )) {
      assertTrue("no write path allocates via `$marker`", dao.contains(marker))
    }
    // The bucket merge folds into the stored row, so the fresh position has to survive the fold.
    assertTrue("bucket merge drops the new sync_seq", dao.contains("syncSeq = next.syncSeq"))
  }

  // MARK: The six remaining mutable tables (#281)

  private fun remainingTablesSql(): List<String> =
    migrationSql(TelemetryDatabase.MIGRATION_35_36)

  @Test
  fun remainingTablesGainColumnIndexAndCounter() {
    val sql = remainingTablesSql()

    for (table in SYNC_SEQ_TABLES_V36) {
      assertTrue(
        "missing sync_seq column on $table",
        sql.any { it == "ALTER TABLE $table ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0" },
      )
      assertTrue(
        "missing sync_seq index on $table",
        sql.any { it == "CREATE INDEX IF NOT EXISTS index_${table}_sync_seq ON $table(sync_seq)" },
      )
      val backfilled = sql.indexOf("UPDATE $table SET sync_seq = rowid")
      val seeded = sql.indexOfFirst {
        it.contains("INSERT OR REPLACE INTO sync_sequences") && it.contains("'$table'")
      }
      assertTrue("missing sync_seq backfill for $table", backfilled >= 0)
      assertTrue("counter for $table is seeded before its rows are numbered", seeded > backfilled)
    }
  }

  /**
   * `board_warnings` is the one table of the six that never had a wall-clock stamp: without it the
   * server has nothing to compare and every re-detection would win or lose arbitrarily.
   */
  @Test
  fun boardWarningsGainUpdatedAtBackfilledFromItsNewestDetection() {
    val sql = remainingTablesSql()

    val added = sql.indexOf("ALTER TABLE board_warnings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
    val backfilled = sql.indexOf("UPDATE board_warnings SET updated_at = last_detected_at")
    assertTrue("missing updated_at on board_warnings", added >= 0)
    assertTrue("backfill runs before the column is added", backfilled > added)
  }

  /**
   * Every step is guarded on the column being absent, so a re-run adds nothing and renumbers
   * nothing — the counter would otherwise be re-seeded below positions already handed out.
   */
  @Test
  fun remainingTablesMigrationIsGuardedForReRun() {
    val guarded = TelemetryDatabase.MIGRATION_35_36
    val sql = migrationSql(guarded)

    // `migrationSql` answers every column probe with an empty cursor, i.e. "column absent", so this
    // run is the first-time path. The guarded statements are exactly the ones missing from a re-run.
    assertTrue(
      "column adds are unguarded",
      sql.any { it.startsWith("ALTER TABLE") },
    )
    for (statement in sql.filter { it.startsWith("CREATE INDEX") }) {
      assertTrue("index create is not idempotent: $statement", statement.contains("IF NOT EXISTS"))
    }
  }

  /**
   * Rider identity and this phone's session state live in `app_settings` but name the phone, not the
   * Rider (#277). They are excluded by never being given a cursor position: 0 sits below every Sync
   * Cursor, so no scan sees the row. The migration's `rowid` backfill has to be undone for them.
   */
  @Test
  fun phoneLocalSettingsKeysAreExcludedFromTheCursor() {
    val sql = remainingTablesSql()

    val reset = sql.single { it.startsWith("UPDATE app_settings SET sync_seq = 0") }
    for (key in NOT_SYNCED_SETTING_KEYS) {
      assertTrue("phone-local key $key is left syncable", reset.contains("'$key'"))
    }
    assertTrue("riderName must stay on the phone", "riderName" in NOT_SYNCED_SETTING_KEYS)
    assertTrue("liveHistoryLimit is Rider config, not phone state", "liveHistoryLimit" !in NOT_SYNCED_SETTING_KEYS)

    assertTrue(
      "app settings write path ignores the phone-local list",
      daoSource().contains("if (phoneLocal) 0L else nextSyncSeq(SYNC_SEQ_APP_SETTINGS)"),
    )
  }

  /**
   * Every targeted `UPDATE` on the six tables bypasses the entity round-trip, which is exactly the
   * shape that made `setAlertRuleEnabled` regress: it has to move both columns in its own SQL.
   */
  @Test
  fun targetedUpdatesOnTheSixTablesMoveBothSyncColumns() {
    val dao = daoSource().replace(Regex("""\"\s*\+\s*\""""), "")

    for (statement in Regex("""\"(UPDATE (?:privacy_zones|tune_profiles) SET[^"]*)\"""").findAll(dao)) {
      val sql = statement.groupValues[1]
      assertTrue("targeted update does not ratchet: $sql", sql.contains("MAX(updated_at + 1, :updatedAt)"))
      assertTrue("targeted update does not move the cursor: $sql", sql.contains("sync_seq = :syncSeq"))
    }
  }

  /**
   * The bucket merge used to freeze `updated_at` at the stored value on a backwards clock step, on
   * the premise that the server upserts this table unconditionally. It does not — the same
   * last-write-wins guard applies, so a frozen stamp is a scanned, sent, silently dropped row.
   */
  @Test
  fun bucketMergeRatchetsLikeBoardsAndAlerts() {
    val dao = daoSource()

    assertTrue(
      "bucket merge does not ratchet",
      dao.contains("updatedAt = ratchetUpdatedAt(updatedAt, next.updatedAt)"),
    )
    assertTrue(
      "the retired unconditional-upsert claim is still in the source",
      !dao.contains("unconditional upsert"),
    )
  }

  // MARK: Last-write-wins ratchet (#275)

  /**
   * The server keeps its stored row unless the incoming stamp is strictly newer, so a rewound clock
   * that stamps at or below it is a silently dropped edit — freezing the value is not enough.
   */
  @Test
  fun ratchetStepsPastAStampTheClockCannotBeat() {
    assertEquals(1_000L, ratchetUpdatedAt(null, 1_000L))
    // Clock ahead of the stored row: truthful wall clock, no inflation.
    assertEquals(5_000L, ratchetUpdatedAt(1_000L, 5_000L))
    // Clock rewound below it, or stalled on it: strictly above.
    assertEquals(5_001L, ratchetUpdatedAt(5_000L, 1_000L))
    assertEquals(5_001L, ratchetUpdatedAt(5_000L, 5_000L))
  }

  @Test
  fun boardAndAlertUpsertsRatchetAgainstTheStoredStamp() {
    val dao = daoSource()

    assertTrue(
      "board upsert does not ratchet",
      dao.contains("ratchetUpdatedAt(getBoardUpdatedAt(board.id), board.updatedAt)"),
    )
    assertTrue(
      "alert upsert does not ratchet",
      dao.contains("ratchetUpdatedAt(getAlertRuleUpdatedAt(rule.boardId, rule.id), rule.updatedAt)"),
    )
  }

  @Test
  fun boardAndAlertRuleBridgeShapesCarryTheCursor() {
    val board = mapOf(
      "id" to "board-1",
      "name" to "ADV",
      "createdAt" to 1_000L,
      // Native ignores a bridge-supplied cursor and stamps its own.
      "updatedAt" to 1L,
    ).toBoardEntity(now = 2_000L)

    assertEquals(1_000L, board.createdAt)
    assertEquals(2_000L, board.updatedAt)
    assertEquals(2_000L, board.toMap(emptyList())["updatedAt"])

    val rule = mapOf(
      "boardId" to "board-1",
      "id" to "rule-1",
      "controlId" to "duty",
      "threshold" to 70.0,
      "enabled" to true,
      "createdAt" to 1_000L,
      "updatedAt" to 1L,
    ).toAlertRuleEntity(now = 2_000L)

    assertEquals(1_000L, rule.createdAt)
    assertEquals(2_000L, rule.updatedAt)
    assertEquals(2_000L, rule.toMap()["updatedAt"])
  }
}
