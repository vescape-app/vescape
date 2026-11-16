package expo.modules.vescapecore.telemetry

import androidx.room.execSQL
import androidx.room.useWriterConnection
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeRoomDatabase

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
  /** Not done; [reason] is one of `not_drained`, `already_reclaimed`, `recording`, `below_threshold`, `low_disk`. */
  data class Skipped(val reason: String, val fileBytes: Long = 0, val freeBytes: Long = 0) : DatabaseSpaceReclaimResult()
}

/**
 * Return the pages the Diagnostic Event prune and the backlog drain freed to the OS with one
 * `VACUUM`, once per database generation: only after the drained marker, while no ride may be
 * recording, when free pages pass [threshold] and [availableDiskBytes] can hold a full copy of the
 * file. Runs on Room's writer connection outside any transaction (SQLite requires it) under the fence
 * [ticket], so Restore, Clear all and the backup export wait for it and a ride that starts mid-run
 * queues its writes behind it; the recording check right before the `VACUUM` lets a ride win. The
 * WAL is checkpointed before and after, so the main file shrinks. Success writes the reclaimed marker;
 * every skip leaves it unset for a later start.
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
    connection.execSQL("PRAGMA wal_checkpoint(TRUNCATE)")
    val pageSize = pragma("page_size")
    val fileBytes = pragma("page_count") * pageSize
    val freeBytes = pragma("freelist_count") * pageSize
    if (freeBytes <= threshold.minFreeBytes || freeBytes <= fileBytes * threshold.minFreeFraction) {
      return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("below_threshold", fileBytes, freeBytes)
    }
    if (availableDiskBytes() < fileBytes) return@useWriterConnection DatabaseSpaceReclaimResult.Skipped("low_disk", fileBytes, freeBytes)
    connection.execSQL("VACUUM")
    connection.execSQL("PRAGMA wal_checkpoint(TRUNCATE)")
    val afterBytes = pragma("page_count") * pageSize
    dao.publishMaintenanceFingerprint(DATABASE_SPACE_RECLAIMED_JOB_ID, "reclaimed", nowMs())
    DatabaseSpaceReclaimResult.Reclaimed(fileBytes, afterBytes)
  }
} ?: throw MaintenanceRunFenced()
