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
 * The Sync Action log (#282): an append-only record of semantic removals, which no surviving row can
 * express. A deleted row cannot carry a Change Timestamp saying it is gone.
 *
 * Room's `@Query` has BINARY retention and its generated implementation keeps the SQL in a
 * method-local string, so a JVM unit test has no runtime handle on the statements Room will run —
 * the classification contract is asserted against the DAO source, as in [BoardTombstoneTest]. The
 * behavioural half (which action lands, with which stamp) runs against a real database on iOS.
 *
 * @parity /modules/vescape-core/ios/telemetry/SyncActionLogTests.swift
 */
class SyncActionLogTest {
  /**
   * Every DAO function that removes rows from a syncable table, and why it is allowed to.
   *
   * `semantic` appends a Sync Action; `parentCascade` and `maintenance` deliberately do not. A new
   * delete has to be classified here before the source scan below will accept it — that is the whole
   * point of the map, and it mirrors the server's own structural test.
   */
  private val semantic = setOf(
    "deletePrivacyZone",
    "deleteBoardSetting",
    "deleteAlertRule",
    "deleteAppSetting",
    "deleteTuneProfileSafe",
    "deleteBoardWarning",
    "deleteBoardWarnings",
    "deleteFavorite",
    // Tombstones the Board and raw-deletes its configuration under one Board action.
    "deleteBoardWithSettings",
  )

  private val parentCascade = setOf(
    "deleteBoardSettingsRaw",
    "deleteAlertRulesRaw",
    "deleteBoardWarningsRaw",
    "deleteTuneHistoryForProfileRaw",
    "deleteFavoriteMediaForFavoriteRaw",
    // The row-level primitives the semantic wrappers above own; never called from outside the DAO.
    "deletePrivacyZoneRow",
    "deleteBoardSettingRow",
    "deleteAlertRuleRow",
    "deleteAppSettingRow",
    "deleteTuneProfileRow",
    "deleteBoardWarningRow",
    "deleteFavoriteRow",
  )

  /** Retention, orphan sweeps and the wipe behind a database restore. Never Rider intent. */
  private val maintenance = setOf(
    "deleteExclusionsRange",
    "clearExclusions",
    "deleteExclusionsBefore",
    "deleteFramesBefore",
    "deleteMarkersBefore",
    "deleteBucketsBefore",
    "deleteDiagnosticEventsBefore",
    "deleteBefore",
    // Cursor-gated retention (#284): the same sweep, refusing to prune a row the uploader has not
    // delivered yet.
    "deleteBeforeGated",
    "deleteFramesBeforeUpTo",
    "deleteMarkersBeforeUpTo",
    "deleteBucketsBeforeUpTo",
    "deleteDiagnosticEventsBeforeUpTo",
    "deleteExclusionsBeforeUpTo",
    "deleteFramesRange",
    "deleteMarkersRange",
    "deleteBucketsRange",
    "deleteRange",
    "deleteFramesRangeAllDevices",
    "deleteMarkersRangeAllDevices",
    "deleteBucketsRangeAllDevices",
    "deleteRangeAllDevices",
    "clearFrames",
    "clearMarkers",
    "clearBuckets",
    "clearDiagnosticEvents",
    "clearAll",
    "deleteFavoriteMedia",
    "deleteOrphanFavoriteMedia",
    // Board-owned decode caches, rebuilt from the board on the next read. A removal is never
    // durable state the server has to learn, which holds at every call site alike: dropped with
    // the Board, on a link mismatch, and on a Rider dismissing a change notice.
    "deleteBoardConfigValues",
    "deleteMotorConfigValues",
    "deleteBoardConfigChangeNotice",
    // Transport state, pruned only behind the accepted-action cursor.
    "deleteSyncActionsThrough",
    "pruneUploadedSyncActions",
  )

  private fun daoSource(): String =
    File("src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt").readText()

  /**
   * DAO source split into `fun name` -> that declaration, its body, and the annotation block above
   * it — `@Query` is where a raw delete keeps its SQL.
   */
  private fun daoFunctions(): Map<String, String> {
    val source = daoSource()
    val starts = Regex("suspend fun (\\w+)").findAll(source).toList()
    return starts.mapIndexed { index, match ->
      val next = starts.getOrNull(index + 1)?.range?.first ?: source.length
      var chunk = source.substring(match.range.first, next)
      // Trailing text belongs to the next declaration's annotations, not to this body.
      chunk.lastIndexOf("\n  @").takeIf { it >= 0 }?.let { chunk = chunk.substring(0, it) }
      val annotations = source.substring(0, match.range.first)
        .substringAfterLast("\n\n")
      match.groupValues[1] to annotations + chunk
    }.toMap()
  }

  private fun deletingFunctions(): Map<String, String> =
    daoFunctions().filter { (_, body) -> body.contains("DELETE FROM") }

  @Test
  fun `every delete against a table is classified`() {
    val classified = semantic + parentCascade + maintenance
    val unclassified = deletingFunctions().keys - classified
    assertTrue(
      "Unclassified deletes in TelemetryDao: $unclassified — classify each as semantic, " +
        "parent cascade or maintenance",
      unclassified.isEmpty(),
    )
    val stale = classified - daoFunctions().keys
    assertTrue("Classified names that no longer exist: $stale", stale.isEmpty())
  }

  @Test
  fun `semantic removals append an action and maintenance never does`() {
    val functions = daoFunctions()
    for (name in semantic) {
      val body = functions.getValue(name)
      // Either it appends the action itself, or it delegates to a wrapper that does — a clear-all is
      // one action per removed row, not one for the sweep.
      val delegates = (semantic - name).any { body.contains("$it(") }
      assertTrue(
        "$name is classified semantic but appends no Sync Action",
        body.contains("appendDeleteAction") || delegates,
      )
    }
    for (name in parentCascade + maintenance) {
      assertTrue(
        "$name is a raw delete but appends a Sync Action",
        !functions.getValue(name).contains("appendDeleteAction"),
      )
    }
  }

  /**
   * The retention boundary, made structural: a target can only name configuration or current state.
   * Giving one of the pruned tables a target would make the server delete exactly the rides the
   * backup exists to preserve. Mirrors the server's `DELETE_ACTION_TARGETS` test.
   */
  @Test
  fun `no retained table can be named by a delete target`() {
    val retained = setOf(
      "telemetry_frames",
      "telemetry_markers",
      "telemetry_minute_buckets",
      "metric_exclusion_ranges",
      "diagnostic_events",
      "tune_history_entries",
      "favorite_media",
      "sync_actions",
      "sync_sequences",
    )
    val named = DeleteTarget.entries.map { it.table }.toSet()
    assertEquals(emptySet<String>(), named intersect retained)
    assertEquals(DeleteTarget.entries.size, named.size)
  }

  /** The log is append-only and keyed on its own cursor; no trigger writes it. */
  @Test
  fun `migration creates the log keyed on an autoincrement cursor`() {
    val sql = migrationSql(TelemetryDatabase.MIGRATION_45_46).joinToString("\n")
    assertTrue(sql, sql.contains("CREATE TABLE IF NOT EXISTS sync_actions"))
    assertTrue(sql, sql.contains("id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL"))
    assertTrue(sql, sql.contains("deleted_at INTEGER NOT NULL"))
    assertTrue("the log must not be driven by a trigger", !sql.contains("CREATE TRIGGER"))
  }

  /** Additive and guarded, so re-running the migration is a no-op rather than a duplicate table. */
  @Test
  fun `migration is additive and re-runnable`() {
    val sql = migrationSql(TelemetryDatabase.MIGRATION_45_46)
    assertTrue(sql.isNotEmpty())
    for (statement in sql) {
      assertTrue("not guarded: $statement", statement.contains("IF NOT EXISTS"))
      assertTrue("not additive: $statement", !statement.contains("DROP ") && !statement.contains("DELETE "))
    }
  }

  /** The accepted cursor is checkpointed first; pruning reads it back rather than trusting a caller. */
  @Test
  fun `pruning is gated on the committed cursor`() {
    val prune = daoFunctions().getValue("pruneUploadedSyncActions")
    assertTrue(prune, prune.contains("getSyncSequence(SYNC_ACTIONS_UPLOADED_CURSOR)"))
    val commit = daoFunctions().getValue("commitSyncActionCursorRow")
    assertTrue("the cursor must never move backwards", commit.contains("MAX(:value"))
  }

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
}
