package expo.modules.vescapecore.telemetry

import android.database.Cursor
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.lang.reflect.Proxy

/**
 * Board tombstones (ADR 0027): deleting a Board stamps `boards.deleted_at` instead of removing the
 * row, so Ride History outlives the Board that produced it. Configuration still goes; telemetry and
 * Tune Profiles never did and still do not.
 *
 * Room's `@Query` has BINARY retention and its generated implementation keeps the SQL in a
 * method-local string, so a JVM unit test has no runtime handle on the statements Room will run —
 * the read/delete contracts are asserted against the DAO source.
 *
 * @parity /modules/vescape-core/ios/telemetry/BoardTombstoneTests.swift
 */
class BoardTombstoneTest {
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

  private fun daoSource(): String =
    File("src/main/java/expo/modules/vescapecore/telemetry/TelemetryDao.kt").readText()

  /**
   * Additive and nullable: existing rows stay null, which is what "alive" means. A `NOT NULL DEFAULT`
   * would tombstone every Board on the device the moment it upgraded.
   */
  @Test
  fun migrationAddsNullableDeletedAtColumn() {
    val sql = migrationSql(TelemetryDatabase.MIGRATION_40_41)

    assertEquals(listOf("ALTER TABLE boards ADD COLUMN deleted_at INTEGER"), sql)
  }

  @Test
  fun migrationTargetsTheCurrentSchemaVersion() {
    assertEquals(40, TelemetryDatabase.MIGRATION_40_41.startVersion)
    assertEquals(41, TelemetryDatabase.MIGRATION_40_41.endVersion)
  }

  /** The Rider-facing list drops tombstones; lookup by id keeps them so history can name them. */
  @Test
  fun listReadFiltersTombstonesAndLookupByIdDoesNot() {
    val dao = daoSource()

    assertTrue(
      "getBoards() does not filter tombstones",
      dao.contains("SELECT * FROM boards WHERE deleted_at IS NULL ORDER BY created_at ASC"),
    )
    assertTrue(
      "getBoard(id) stopped resolving tombstones",
      dao.contains("SELECT * FROM boards WHERE id = :id LIMIT 1"),
    )
  }

  /**
   * The regression this change exists to prevent: a Board delete that still removes the row takes
   * Ride History with it on the server, and the phone can never re-upload it.
   */
  @Test
  fun deleteTombstonesTheBoardInsteadOfRemovingTheRow() {
    val dao = daoSource()

    assertFalse("a DELETE on boards survives", dao.contains("DELETE FROM boards"))
    assertTrue(
      "the delete path does not stamp a tombstone",
      dao.contains("insertBoardRow(board.copy(deletedAt = deletedAt))"),
    )
  }

  /** Configuration is still hard-deleted — only the Board row survives. */
  @Test
  fun deleteStillRemovesBoardConfiguration() {
    val dao = daoSource()
    val body = dao.substringAfter("suspend fun deleteBoardWithSettings").substringBefore("\n  }")

    for (call in listOf("deleteBoardSettings(id)", "deleteBoardWarnings(id)", "deleteAlertRules(id)")) {
      assertTrue("the delete path dropped `$call`", body.contains(call))
    }
  }

  /** Deletion is terminal: an ordinary upsert must not clear a tombstone already on the row. */
  @Test
  fun upsertPreservesAnExistingTombstone() {
    val dao = daoSource()

    assertTrue(
      "upsertBoard can resurrect a deleted Board",
      dao.contains("deletedAt = board.deletedAt ?: getBoardDeletedAt(board.id)"),
    )
  }
}
