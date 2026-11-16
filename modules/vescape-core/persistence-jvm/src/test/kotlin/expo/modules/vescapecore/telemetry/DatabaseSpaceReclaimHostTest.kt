package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.room.execSQL
import androidx.room.useWriterConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import expo.modules.vescapecore.database.AppSettingEntity
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeRoomDatabase
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/**
 * Database space reclaim (#686, ADR 0045) through the production Room database on a real file.
 * @parity /modules/vescape-core/persistence-macos/DatabaseSpaceReclaimContract.swift `runDatabaseSpaceReclaimContract`
 */
class DatabaseSpaceReclaimHostTest {
  private val now = 1_000_000_000L
  private val gapMs = 10 * 60_000L
  private val threshold = DatabaseSpaceReclaimThreshold(minFreeBytes = 1024 * 1024, minFreeFraction = 0.5)

  private fun <T> withDatabase(block: suspend (VescapeRoomDatabase, File) -> T): T = runBlocking {
    val directory = Files.createTempDirectory("vescape-reclaim").toFile()
    val path = directory.resolve("vescape.db")
    val db = Room.databaseBuilder<VescapeRoomDatabase>(path.path).setDriver(BundledSQLiteDriver()).build()
    try { block(db, path) } finally { db.close(); directory.deleteRecursively() }
  }

  /**
   * ~8 MB of rows, deleted again: the pages stay in the file as free pages. The bundled driver
   * creates `auto_vacuum = FULL` files, which shrink on commit; this database is switched to
   * `NONE`, as one created by GRDB on iOS and restored here is.
   */
  private suspend fun VescapeRoomDatabase.freePages() {
    useWriterConnection {
      it.execSQL("PRAGMA auto_vacuum = NONE")
      it.execSQL("VACUUM")
    }
    val dao = vescapeDao()
    val blob = "\"" + "x".repeat(8_000) + "\""
    repeat(1_000) { dao.upsertAppSetting(AppSettingEntity("bloat.$it", blob, now)) }
    repeat(1_000) { dao.deleteAppSetting("bloat.$it") }
  }

  private suspend fun VescapeRoomDatabase.markDrained() =
    vescapeDao().publishMaintenanceFingerprint(TELEMETRY_DRAINED_JOB_ID, "drained", now)

  private suspend fun VescapeRoomDatabase.reclaim(
    fence: DatabaseReplacementFence = DatabaseReplacementFence(),
    ticket: Long = fence.ticket(),
    disk: Long = Long.MAX_VALUE,
  ) = reclaimDatabaseSpace({ this }, fence, ticket, gapMs, { disk }, { now }, threshold)

  private suspend fun VescapeRoomDatabase.reclaimed() = vescapeDao().storedMaintenanceFingerprint(DATABASE_SPACE_RECLAIMED_JOB_ID)

  @Test fun vacuumShrinksTheFileOnceAfterTheDrain() = withDatabase { db, path ->
    db.freePages()
    assertEquals(DatabaseSpaceReclaimResult.Skipped("not_drained"), db.reclaim())
    db.markDrained()
    val before = path.length()
    val result = db.reclaim() as DatabaseSpaceReclaimResult.Reclaimed
    assertTrue("before ${result.beforeBytes}", result.beforeBytes > 8_000_000)
    assertTrue("after ${result.afterBytes}", result.afterBytes < 1_000_000)
    assertTrue("file ${path.length()} of $before", path.length() < before / 4)
    assertEquals("reclaimed", db.reclaimed())
    db.freePages()
    assertEquals(DatabaseSpaceReclaimResult.Skipped("already_reclaimed"), db.reclaim())
  }

  @Test fun recordingRideLowDiskAndFewFreePagesSkipWithoutTheMarker() = withDatabase { db, _ ->
    db.markDrained()
    assertEquals("below_threshold", (db.reclaim() as DatabaseSpaceReclaimResult.Skipped).reason)
    db.freePages()
    assertEquals("low_disk", (db.reclaim(disk = 1_000_000) as DatabaseSpaceReclaimResult.Skipped).reason)
    db.useWriterConnection {
      it.execSQL(
        "INSERT INTO telemetry_frames (captured_at_ms, elapsed_realtime_ms, flags, changed_mask_1, changed_mask_2) " +
          "VALUES (${now - 1_000}, 1, 0, 0, 0)",
      )
    }
    assertEquals(DatabaseSpaceReclaimResult.Skipped("recording"), db.reclaim())
    assertNull(db.reclaimed())
  }

  @Test fun fencedReclaimNeverTouchesTheDatabase() = withDatabase { db, _ ->
    db.freePages()
    db.markDrained()
    val fence = DatabaseReplacementFence()
    val ticket = fence.ticket()
    fence.fence { }
    assertThrows(MaintenanceRunFenced::class.java) { runBlocking { db.reclaim(fence, ticket) } }
    assertNull(db.reclaimed())
    assertTrue(db.reclaim(fence) is DatabaseSpaceReclaimResult.Reclaimed)
  }
}
