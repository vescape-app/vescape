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
  /// Not done; `reason` is one of `not_drained`, `already_reclaimed`, `recording`, `session_active`,
  /// `interrupted` (iOS only), `checkpoint_busy`, `below_threshold`, `low_disk`.
  case skipped(reason: String, fileBytes: Int64 = 0, freeBytes: Int64 = 0)
}

/// Native Board Session state the space reclaim yields to: a Board linked or connecting, or recording
/// armed. The Board phase writer and the recording coordinator set it; recording always wins over a
/// reclaim, which is only allowed while it is `idle`. A session that starts while a reclaim is armed
/// calls its `onBusy` hook, which interrupts the running `VACUUM`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `BoardSessionActivity`
/// @platform-diff Android cannot interrupt a running `VACUUM` (Room's bundled driver exposes no
/// `sqlite3_interrupt`); only iOS arms `onBusy`.
internal final class BoardSessionActivity: @unchecked Sendable {
  static let process = BoardSessionActivity()
  private let lock = NSLock()
  private var linked = false
  private var recording = false
  private var onBusy: (() -> Void)?

  var idle: Bool { lock.withLock { !linked && !recording } }

  func setLinked(_ value: Bool) { update { linked = value } }

  func setRecording(_ value: Bool) { update { recording = value } }

  /// Arms `onBusy` and returns true when the session is idle; false, unarmed, otherwise.
  func arm(onBusy: @escaping () -> Void) -> Bool {
    lock.withLock {
      guard !linked && !recording else { return false }
      self.onBusy = onBusy
      return true
    }
  }

  func disarm() { lock.withLock { onBusy = nil } }

  private func update(_ change: () -> Void) {
    let busy: (() -> Void)? = lock.withLock {
      let wasIdle = !linked && !recording
      change()
      return wasIdle && (linked || recording) ? onBusy : nil
    }
    busy?()
  }
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
/// recording and while the Board Session `activity` is idle, when free pages pass `threshold` and `availableDiskBytes` can hold a full copy of the
/// file. Runs as a barrier write outside any transaction (SQLite requires it; no reader overlaps it)
/// under the fence `ticket`, so Restore, Clear all and the backup export wait for it. A Board Session
/// that starts mid-run interrupts the `VACUUM` (SQLite rolls it back), so readers on the main thread
/// never wait behind a full rewrite. The WAL is checkpointed before and after, so the main file
/// shrinks; an incomplete checkpoint skips the run. Success writes the reclaimed marker and reports
/// the physical database + WAL bytes; every skip leaves it unset for a later start.
/// Throws `MaintenanceRunFenced` once Restore or Clear all replaced the database.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/DatabaseSpaceReclaim.kt `reclaimDatabaseSpace`
internal func reclaimDatabaseSpace(
  writer: () throws -> any DatabaseWriter,
  fence: DatabaseReplacementFence,
  ticket: Int64,
  gapMs: Int64,
  availableDiskBytes: () -> Int64,
  nowMs: () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
  activity: BoardSessionActivity = .process,
  threshold: DatabaseSpaceReclaimThreshold = DatabaseSpaceReclaimThreshold()
) throws -> DatabaseSpaceReclaimResult {
  let result = try fence.write(ticket: ticket) {
    let pool = try writer()
    let path = pool.path
    return try pool.barrierWriteWithoutTransaction { db -> DatabaseSpaceReclaimResult in
      func pragma(_ name: String) throws -> Int64 { try Int64.fetchOne(db, sql: "PRAGMA \(name)") ?? 0 }
      /// `wal_checkpoint` reports `busy = 1` when a reader snapshot kept it from finishing.
      func checkpointed() throws -> Bool { try Row.fetchOne(db, sql: "PRAGMA wal_checkpoint(TRUNCATE)")?[0] == 0 }
      func physicalBytes() -> Int64 {
        [path, path + "-wal"].reduce(0) { total, file in
          total + ((try? FileManager.default.attributesOfItem(atPath: file)[.size] as? NSNumber)?.int64Value ?? 0)
        }
      }
      guard try storedMaintenanceFingerprint(db, id: TELEMETRY_DRAINED_JOB_ID) != nil else { return .skipped(reason: "not_drained") }
      guard try storedMaintenanceFingerprint(db, id: DATABASE_SPACE_RECLAIMED_JOB_ID) == nil else {
        return .skipped(reason: "already_reclaimed")
      }
      guard try activeRideStartMs(db, nowMs: nowMs(), gapMs: gapMs) == nil else { return .skipped(reason: "recording") }
      guard activity.idle else { return .skipped(reason: "session_active") }
      guard try checkpointed() else { return .skipped(reason: "checkpoint_busy") }
      let pageSize = try pragma("page_size")
      let fileBytes = try pragma("page_count") * pageSize
      let freeBytes = try pragma("freelist_count") * pageSize
      if freeBytes <= threshold.minFreeBytes || Double(freeBytes) <= Double(fileBytes) * threshold.minFreeFraction {
        return .skipped(reason: "below_threshold", fileBytes: fileBytes, freeBytes: freeBytes)
      }
      guard availableDiskBytes() >= fileBytes else { return .skipped(reason: "low_disk", fileBytes: fileBytes, freeBytes: freeBytes) }
      guard activity.arm(onBusy: { pool.interrupt() }) else {
        return .skipped(reason: "session_active", fileBytes: fileBytes, freeBytes: freeBytes)
      }
      let beforeBytes = physicalBytes()
      do {
        defer { activity.disarm() }
        try db.execute(sql: "VACUUM")
      } catch let error as DatabaseError where error.resultCode == .SQLITE_INTERRUPT {
        return .skipped(reason: "interrupted", fileBytes: fileBytes, freeBytes: freeBytes)
      }
      guard try checkpointed() else { return .skipped(reason: "checkpoint_busy", fileBytes: fileBytes, freeBytes: freeBytes) }
      let afterBytes = physicalBytes()
      try publishMaintenanceFingerprint(db, id: DATABASE_SPACE_RECLAIMED_JOB_ID, fingerprint: "reclaimed", nowMs: nowMs())
      return .reclaimed(beforeBytes: beforeBytes, afterBytes: afterBytes)
    }
  }
  guard let result else { throw MaintenanceRunFenced() }
  return result
}
