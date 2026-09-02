package expo.modules.vescapecore.sync

import expo.modules.vescapecore.telemetry.SYNC_ACTIONS_UPLOADED_CURSOR
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The two contracts the uploader cannot express in code alone: the cursor key each table commits
 * under, and the promise that retention deletes nothing the uploader has not delivered.
 *
 * Room keeps its SQL out of reach of a JVM test, so the retention half is asserted against the DAO
 * source — the same technique the Sync Action classification test uses.
 *
 * @parity /modules/vescape-core/ios/sync/SyncCursorContractTests.swift
 */
class SyncCursorContractTest {
  private fun daoSource(): String =
    File("src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt").readText()

  private fun storeSource(): String = File("src/main/java/expo/modules/vescapecore/sync/SyncStore.kt").readText()

  /** The `@Query` text attached to a DAO method, whitespace-normalised across its string concatenation. */
  private fun query(method: String): String =
    daoSource()
      .substringBefore("suspend fun $method(")
      .substringAfterLast("@Query(")
      .replace("\" +", "")
      .replace("\"", "")
      .replace(Regex("\\s+"), " ")
      .trim()

  /** The table each scan method serves, read from the store rather than restated here. */
  private fun scanMethods(): Map<SyncTable, String> =
    Regex("""SyncTable\.(\w+) ->\s*database\(\)\.(\w+)\(cursor, limit\)""")
      .findAll(storeSource())
      .associate { SyncTable.valueOf(it.groupValues[1]) to it.groupValues[2] }

  /**
   * The forward scan, asserted against the SQL that actually runs. Room keeps its queries out of
   * reach of a JVM test, so this is the only place the comparison, the ordering and the limit are
   * checked at all — and each of the three is a silent data-loss bug on its own:
   *
   * - `>=` instead of `>` re-sends the row at the cursor on every pass, forever
   * - an unordered or descending scan hands out a row above one it skipped, and the commit then
   *   moves the cursor past the skipped row, which no later scan can reach
   * - a missing `LIMIT` ignores the batch budget the byte cap is built on
   */
  @Test
  fun `every scan reads strictly forward from its cursor, in order, under a limit`() {
    val methods = scanMethods()
    assertEquals(
      "every table needs a scan in SyncStore",
      SyncTable.entries.toSet(),
      methods.keys,
    )
    for ((table, method) in methods) {
      val sql = query(method)
      val column = table.cursorColumn
      // The bound parameter's name is the DAO's business; the comparison is the contract.
      assertTrue(
        "$method must read strictly past the cursor, not from it: $sql",
        sql.contains(Regex("WHERE $column > :\\w+")),
      )
      assertTrue("$method must order by $column ascending: $sql", sql.contains("ORDER BY $column ASC"))
      assertTrue("$method must respect the batch budget: $sql", sql.contains("LIMIT :limit"))
      assertTrue("$method must read $table's own table: $sql", sql.contains("FROM ${table.table} "))
    }
  }

  /**
   * The position reported for a row has to be the column the scan ordered on. Reporting a row id
   * from a `sync_seq` scan commits a cursor in the wrong number space — every row below it in the
   * other space becomes unreachable, with no error anywhere.
   */
  @Test
  fun `each row reports the cursor column its own scan ran on`() {
    val field = mapOf(SYNC_SEQ_COLUMN to "it.syncSeq", ROW_ID_COLUMN to "it.id")
    for ((table, method) in scanMethods()) {
      val mapping = storeSource().substringAfter("database().$method(cursor, limit)").substringBefore("\n")
      assertTrue(
        "$method must report ${field.getValue(table.cursorColumn)} — it scans on ${table.cursorColumn}: $mapping",
        mapping.contains("SyncPendingRow(${field.getValue(table.cursorColumn)},"),
      )
    }
  }

  /** A count that disagrees with the scan reports a drained backlog while rows are still waiting. */
  @Test
  fun `every pending count matches its scan's own predicate`() {
    val counts = Regex("""SyncTable\.(\w+) -> database\(\)\.(\w+)\(cursor\)""")
      .findAll(storeSource())
      .associate { SyncTable.valueOf(it.groupValues[1]) to it.groupValues[2] }
    assertEquals(SyncTable.entries.toSet(), counts.keys)
    for ((table, method) in counts) {
      val sql = query(method)
      val scan = query(scanMethods().getValue(table))
      assertTrue(
        "$method must count strictly past the cursor: $sql",
        sql.contains(Regex("WHERE ${table.cursorColumn} > :\\w+")),
      )
      // The unowned-telemetry exclusion is the one predicate that has to appear in both.
      for (extra in listOf("board_id IS NOT NULL", "board_id != ''")) {
        assertEquals(
          "$method and its scan must agree about `$extra`",
          scan.contains(extra),
          sql.contains(extra),
        )
      }
    }
  }

  /**
   * A Metric Exclusion Range written by a sanitizer with no Board connected carries the
   * unknown-Board sentinel, and the server's composite foreign key refuses it — a 409 that fails
   * the whole Sync Batch. The row is retained, so without this filter the same batch retries
   * forever and backup wedges permanently. An unattributed range names no Board, so there is
   * nothing for the server to hang it off; it is an unowned local row, exactly like an unowned
   * frame or bucket.
   */
  @Test
  fun `unowned rows are skipped by every scan the server keys on a Board`() {
    for (table in listOf(
      SyncTable.METRIC_EXCLUSION_RANGES,
      SyncTable.TELEMETRY_MINUTE_BUCKETS,
    )) {
      val method = scanMethods().getValue(table)
      assertTrue(
        "$method must skip the unknown-Board sentinel: ${query(method)}",
        query(method).contains("board_id != ''"),
      )
    }
  }

  /** The retained tables, and the column whose cursor decides what may be pruned. */
  private val gatedSweeps = mapOf(
    "deleteFramesBeforeUpTo" to "id <= :cursor",
    "deleteMarkersBeforeUpTo" to "id <= :cursor",
    "deleteBucketsBeforeUpTo" to "sync_seq <= :cursor",
    "deleteDiagnosticEventsBeforeUpTo" to "id <= :cursor",
    "deleteExclusionsBeforeUpTo" to "id <= :cursor",
  )

  @Test
  fun `every retained table prunes only up to its accepted cursor`() {
    val source = daoSource()
    for ((name, predicate) in gatedSweeps) {
      val declaration = source.substringBefore("suspend fun $name")
      val query = declaration.substringAfterLast("@Query(")
      assertTrue("$name must gate on $predicate", query.contains(predicate))
      assertTrue("$name must still apply the age cutoff", query.contains("< :beforeMs"))
    }
  }

  /**
   * A mutable bucket is protected by `sync_seq`, not by its row id: a bucket rewritten after an
   * earlier version uploaded gets a fresh position and has to survive until that one is accepted.
   */
  @Test
  fun `minute buckets are gated on the counter their scan runs on`() {
    assertEquals(SYNC_SEQ_COLUMN, SyncTable.TELEMETRY_MINUTE_BUCKETS.cursorColumn)
    assertEquals(ROW_ID_COLUMN, SyncTable.TELEMETRY_FRAMES.cursorColumn)
  }

  @Test
  fun `cursor keys are namespaced away from the write counters`() {
    val keys = SyncTable.entries.map { it.cursorKey }
    assertEquals(keys.size, keys.toSet().size)
    for (table in SyncTable.entries - SyncTable.DELETE_ACTIONS) {
      assertEquals("$SYNC_CURSOR_PREFIX${table.table}", table.cursorKey)
    }
    // Sync Actions keep the key #282 shipped, so the log's prune reads what the uploader commits.
    assertEquals(SYNC_ACTIONS_UPLOADED_CURSOR, SyncTable.DELETE_ACTIONS.cursorKey)
  }

  /** Parents before children, and Delete Actions last: the order the server applies a batch in. */
  @Test
  fun `table order matches the server's declared batch order`() {
    assertEquals(
      listOf(
        "appSettings",
        "boards",
        "boardSettings",
        "boardWarnings",
        "alerts",
        "tuneProfiles",
        "tuneHistoryEntries",
        "privacyZones",
        "telemetryMarkers",
        "metricExclusionRanges",
        "diagnosticEvents",
        "telemetryFrames",
        "telemetryMinuteBuckets",
        "favorites",
        "vescFaultOccurrences",
        "vescFaultCaptures",
        "vescFaultCaptureSamples",
        "deleteActions",
      ),
      SyncTable.entries.map { it.wire },
    )
  }
}
