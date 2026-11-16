package expo.modules.vescapecore.telemetry

import androidx.room.execSQL
import androidx.room.useWriterConnection
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeRoomDatabase
import java.io.File

/**
 * Native-owned `app_settings` row recording that this database's freed pages were returned to the
 * OS once after the backlog drain (ADR 0045). Restore and Clear all delete it with the drained marker.
 * @parity /modules/vescape-core/ios/telemetry/DatabaseSpaceReclaim.swift `DATABASE_SPACE_RECLAIMED_JOB_ID`
 */
internal const val DATABASE_SPACE_RECLAIMED_JOB_ID = "databaseSpaceReclaim"

/**
 * Every marker Restore and Clear all forget inside their fenced replacement.
 * @parity /modules/vescape-core/ios/telemetry/DatabaseSpaceReclaim.swift `TELEMETRY_MAINTENANCE_MARKER_IDS`
 */
internal val TELEMETRY_MAINTENANCE_MARKER_IDS = listOf(TELEMETRY_DRAINED_JOB_ID, DATABASE_SPACE_RECLAIMED_JOB_ID)

/**
 * Free pages must exceed both bounds before a `VACUUM` is worth its rewrite.
 * @parity /modules/vescape-core/ios/telemetry/DatabaseSpaceReclaim.swift `DatabaseSpaceReclaimThreshold`
 */
internal data class DatabaseSpaceReclaimThreshold(val minFreeBytes: Long = 50L * 1024 * 1024, val minFreeFraction: Double = 0.5)

/** @parity /modules/vescape-core/ios/telemetry/DatabaseSpaceReclaim.swift `DatabaseSpaceReclaimResult` */
internal sealed class DatabaseSpaceReclaimResult {
  data class Reclaimed(val beforeBytes: Long, val afterBytes: Long) : DatabaseSpaceReclaimResult()
  /**
   * Not done; [reason] is one of `not_drained`, `already_reclaimed`, `recording`, `session_active`,
   * `interrupted` (iOS only), `checkpoint_busy`, `below_threshold`, `low_disk`.
   */
  data class Skipped(val reason: String, val fileBytes: Long = 0, val freeBytes: Long = 0) : DatabaseSpaceReclaimResult()
}

/**
 * Native Board Session state the space reclaim yields to: a Board linked or connecting, or recording
 * armed. The Board phase writer and the recording coordinator set it; recording always wins over a
 * reclaim, which is only allowed while it is [idle].
 * @parity /modules/vescape-core/ios/telemetry/DatabaseSpaceReclaim.swift `BoardSessionActivity`
 * @platform-diff Room's bundled driver exposes no `sqlite3_interrupt`, so Android cannot cut a running
 * `VACUUM` short when a session starts mid-run; it re-checks [idle] right before the `VACUUM` instead.
 */
internal class BoardSessionActivity {
  @Volatile private var linked = false
  @Volatile private var recording = false

  val idle: Boolean get() = !linked && !recording

  fun setLinked(value: Boolean) { linked = value }

  fun setRecording(value: Boolean) { recording = value }

  companion object {
    val process = BoardSessionActivity()
  }
}

/**
 * Return the pages the Diagnostic Event prune and the backlog drain freed to the OS with one
 * `VACUUM`, once per database generation: only after the drained marker, while no ride may be
 * recording and while the Board Session [activity] is idle, when free pages pass [threshold] and [availableDiskBytes] can hold a full copy of the
 * file. Runs on Room's writer connection outside any transaction (SQLite requires it) under the fence
 * [ticket], so Restore, Clear all and the backup export wait for it and a ride that starts mid-run
 * queues its writes behind it; the session check right before the `VACUUM` lets a ride win. The
 * WAL is checkpointed before and after, so the main file shrinks; a checkpoint a reader blocked skips
 * the run. Success writes the reclaimed marker and reports the physical database + WAL bytes; every
 * skip leaves it unset for a later start.
 * Throws [MaintenanceRunFenced] once Restore or Clear all replaced the database.
 * @parity /modules/vescape-core/ios/telemetry/DatabaseSpaceReclaim.swift `reclaimDatabaseSpace`
 */
internal suspend fun reclaimDatabaseSpace(
  database: () -> VescapeRoomDatabase,
  fence: DatabaseReplacementFence,
  ticket: Long,
  gapMs: Long,
  availableDiskBytes: () -> Long,
  nowMs: () -> Long = System::currentTimeMillis,
  activity: BoardSessionActivity = BoardSessionActivity.process,
  threshold: DatabaseSpaceReclaimThreshold = DatabaseSpaceReclaimThreshold(),
): DatabaseSpaceReclaimResult = fence.write(ticket) {
  val db = database()
  val dao = db.vescapeDao()
  db.useWriterConnection { connection ->
    suspend fun pragma(name: String): Long = connection.usePrepared("PRAGMA $name") { it.step(); it.getLong(0) }
    if (dao.storedMaintenanceFingerprint(TELEMETRY_DRAINED_JOB_ID) == null) {
      return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("not_drained")
    }
    if (dao.storedMaintenanceFingerprint(DATABASE_SPACE_RECLAIMED_JOB_ID) != null) {
      return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("already_reclaimed")
    }
    if (dao.activeRideStartMs(nowMs(), gapMs) != null) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("recording")
    if (!activity.idle) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("session_active")
    /** `wal_checkpoint` reports `busy = 1` when a reader snapshot kept it from finishing. */
    suspend fun checkpointed(): Boolean = connection.usePrepared("PRAGMA wal_checkpoint(TRUNCATE)") { it.step(); it.getLong(0) == 0L }
    val path = connection.usePrepared("PRAGMA database_list") { statement ->
      generateSequence { if (statement.step()) statement.getText(1) to statement.getText(2) else null }.first { it.first == "main" }.second
    }
    fun physicalBytes(): Long = File(path).length() + File("$path-wal").length()
    if (!checkpointed()) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("checkpoint_busy")
    val pageSize = pragma("page_size")
    val fileBytes = pragma("page_count") * pageSize
    val freeBytes = pragma("freelist_count") * pageSize
    if (freeBytes <= threshold.minFreeBytes || freeBytes <= fileBytes * threshold.minFreeFraction) {
      return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("below_threshold", fileBytes, freeBytes)
    }
    if (availableDiskBytes() < fileBytes) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("low_disk", fileBytes, freeBytes)
    if (!activity.idle) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("session_active", fileBytes, freeBytes)
    val beforeBytes = physicalBytes()
    connection.execSQL("VACUUM")
    if (!checkpointed()) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("checkpoint_busy", fileBytes, freeBytes)
    val afterBytes = physicalBytes()
    dao.publishMaintenanceFingerprint(DATABASE_SPACE_RECLAIMED_JOB_ID, "reclaimed", nowMs())
    DatabaseSpaceReclaimResult.Reclaimed(beforeBytes, afterBytes)
  }
} ?: throw MaintenanceRunFenced()
