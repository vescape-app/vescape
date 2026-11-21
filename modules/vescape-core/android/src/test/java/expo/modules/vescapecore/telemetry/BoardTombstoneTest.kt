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
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.database.VescapeDatabase

/**
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
    File("src/main/java/expo/modules/vescapecore/database/VescapeDao.kt").readText()

  @Test
  fun migrationAddsNullableDeletedAtColumn() {
    val sql = migrationSql(VescapeDatabase.MIGRATION_40_41)

    assertEquals(listOf("ALTER TABLE boards ADD COLUMN deleted_at INTEGER"), sql)
  }

  @Test
  fun migrationTargetsTheCurrentSchemaVersion() {
    assertEquals(40, VescapeDatabase.MIGRATION_40_41.startVersion)
    assertEquals(41, VescapeDatabase.MIGRATION_40_41.endVersion)
  }

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

  @Test
  fun deleteTombstonesTheBoardInsteadOfRemovingTheRow() {
    val dao = daoSource()

    assertFalse("a DELETE on boards survives", dao.contains("DELETE FROM boards"))
    assertTrue(
      "the delete path does not stamp a tombstone",
      dao.contains("saveBoardRow(board.copy(deletedAt = deletedAt))"),
    )
  }

  @Test
  fun deleteStillRemovesBoardConfiguration() {
    val dao = daoSource()
    val body = dao.substringAfter("suspend fun deleteBoardWithSettings").substringBefore("\n  }")

    for (call in listOf("deleteBoardSettings(id)", "deleteBoardWarnings(id)", "deleteAlertRules(id)")) {
      assertTrue("the delete path dropped `$call`", body.contains(call))
    }
  }

  @Test
  fun upsertPreservesAnExistingTombstone() {
    val dao = daoSource()

    assertTrue(
      "upsertBoard can resurrect a deleted Board",
      dao.contains("deletedAt = board.deletedAt ?: getBoardDeletedAt(board.id)"),
    )
  }
}
