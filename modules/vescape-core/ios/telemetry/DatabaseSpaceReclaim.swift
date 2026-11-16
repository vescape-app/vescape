import Foundation
import GRDB

/// Native-owned `app_settings` row recording that this database's freed pages were returned to the
/// OS once after the backlog drain (ADR 0045). Restore and Clear all delete it with the drained marker.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `DATABASE_SPACE_RECLAIMED_JOB_ID`
internal let DATABASE_SPACE_RECLAIMED_JOB_ID = "databaseSpaceReclaim"

/// Every marker Restore and Clear all forget inside their fenced replacement.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `TELEMETRY_MAINTENANCE_MARKER_IDS`
internal let TELEMETRY_MAINTENANCE_MARKER_IDS = [TELEMETRY_DRAINED_JOB_ID, DATABASE_SPACE_RECLAIMED_JOB_ID]

/// Free pages must exceed both bounds before a `VACUUM` is worth its rewrite.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `DatabaseSpaceReclaimThreshold`
internal struct DatabaseSpaceReclaimThreshold {
  var minFreeBytes: Int64 = 50 * 1024 * 1024
  var minFreeFraction: Double = 0.5
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `DatabaseSpaceReclaimResult`
internal enum DatabaseSpaceReclaimResult: Equatable {
  case reclaimed(beforeBytes: Int64, afterBytes: Int64)
  /// Not done; `reason` is one of `not_drained`, `already_reclaimed`, `recording`, `below_threshold`, `low_disk`.
  case skipped(reason: String, fileBytes: Int64 = 0, freeBytes: Int64 = 0)
}

/// Clear all and Restore leave a database whose buffer was never drained and whose space was never
/// reclaimed (ADR 0045).
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/VescapeDao.kt `forgetTelemetryMaintenanceMarkers`
internal func forgetTelemetryMaintenanceMarkers(_ db: Database) throws {
  for id in TELEMETRY_MAINTENANCE_MARKER_IDS {
    try db.execute(sql: "DELETE FROM app_settings WHERE key = ?", arguments: [maintenanceJobKey(id)])
  }
}

/// Return the pages the Diagnostic Event prune and the backlog drain freed to the OS with one
/// `VACUUM`, once per database generation: only after the drained marker, while no ride may be
/// recording, when free pages pass `threshold` and `availableDiskBytes` can hold a full copy of the
/// file. Runs as a barrier write outside any transaction (SQLite requires it; no reader overlaps it)
/// under the fence `ticket`, so Restore, Clear all and the backup export wait for it and a ride that
/// starts mid-run queues its writes behind it; the recording check right before the `VACUUM` lets a
/// ride win. The WAL is checkpointed before and after, so the main file shrinks. Success writes the
/// reclaimed marker; every skip leaves it unset for a later start.
/// Throws `MaintenanceRunFenced` once Restore or Clear all replaced the database.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `reclaimDatabaseSpace`
internal func reclaimDatabaseSpace(
  writer: () throws -> any DatabaseWriter,
  fence: DatabaseReplacementFence,
  ticket: Int64,
  gapMs: Int64,
  availableDiskBytes: () -> Int64,
  nowMs: () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
  threshold: DatabaseSpaceReclaimThreshold = DatabaseSpaceReclaimThreshold()
) throws -> DatabaseSpaceReclaimResult {
  let result = try fence.write(ticket: ticket) {
    try writer().barrierWriteWithoutTransaction { db -> DatabaseSpaceReclaimResult in
      func pragma(_ name: String) throws -> Int64 { try Int64.fetchOne(db, sql: "PRAGMA \(name)") ?? 0 }
      guard try storedMaintenanceFingerprint(db, id: TELEMETRY_DRAINED_JOB_ID) != nil else { return .skipped(reason: "not_drained") }
      guard try storedMaintenanceFingerprint(db, id: DATABASE_SPACE_RECLAIMED_JOB_ID) == nil else {
        return .skipped(reason: "already_reclaimed")
      }
      guard try activeRideStartMs(db, nowMs: nowMs(), gapMs: gapMs) == nil else { return .skipped(reason: "recording") }
      try db.execute(sql: "PRAGMA wal_checkpoint(TRUNCATE)")
      let pageSize = try pragma("page_size")
      let fileBytes = try pragma("page_count") * pageSize
      let freeBytes = try pragma("freelist_count") * pageSize
      if freeBytes <= threshold.minFreeBytes || Double(freeBytes) <= Double(fileBytes) * threshold.minFreeFraction {
        return .skipped(reason: "below_threshold", fileBytes: fileBytes, freeBytes: freeBytes)
      }
      guard availableDiskBytes() >= fileBytes else { return .skipped(reason: "low_disk", fileBytes: fileBytes, freeBytes: freeBytes) }
      try db.execute(sql: "VACUUM")
      try db.execute(sql: "PRAGMA wal_checkpoint(TRUNCATE)")
      let afterBytes = try pragma("page_count") * pageSize
      try publishMaintenanceFingerprint(db, id: DATABASE_SPACE_RECLAIMED_JOB_ID, fingerprint: "reclaimed", nowMs: nowMs())
      return .reclaimed(beforeBytes: fileBytes, afterBytes: afterBytes)
    }
  }
  guard let result else { throw MaintenanceRunFenced() }
  return result
}
