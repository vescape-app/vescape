import Foundation
import GRDB

/// Durable "this ride's summary notification was already sent" markers (#410).
///
/// The primary key is the stable Ride History recording id — `deviceId:firstSampleAtMs:
/// lastSampleAtMs` — so the marker is tied to ride identity rather than to any process, Board
/// Session, or CoreBluetooth restoration cycle. Living in the ride database means it survives
/// process death and app relaunch, which process memory does not.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `RideSummaryNotificationEntity`
struct RideSummaryStore {
  private let resolveWriter: () -> DatabaseWriter?

  static let shared = RideSummaryStore(resolveWriter: { TelemetryDatabase.pool })

  init(resolveWriter: @escaping () -> DatabaseWriter?) {
    self.resolveWriter = resolveWriter
  }

  init(dbWriter: DatabaseWriter) {
    self.init(resolveWriter: { dbWriter })
  }

  static func createTables(_ db: Database) throws {
    try db.execute(
      sql: """
        CREATE TABLE IF NOT EXISTS ride_summary_notifications (
          ride_id TEXT NOT NULL PRIMARY KEY,
          notified_at_ms INTEGER NOT NULL
        )
        """
    )
  }

  func wasNotified(rideId: String) -> Bool {
    guard let writer = resolveWriter() else { return false }
    let count = try? writer.read { db in
      try Int.fetchOne(
        db,
        sql: "SELECT COUNT(*) FROM ride_summary_notifications WHERE ride_id = ?",
        arguments: [rideId]
      )
    }
    return (count ?? 0) ?? 0 > 0
  }

  /// Claim the one summary notification for `rideId`. True only for the caller that inserted the
  /// row; `INSERT OR IGNORE` makes concurrent or repeated finalize callbacks lose the race. Claim
  /// before posting, release only when posting failed.
  func claim(rideId: String, nowMs: Int64) -> Bool {
    guard let writer = resolveWriter() else { return false }
    let claimed = try? writer.write { db -> Bool in
      try db.execute(
        sql: "INSERT OR IGNORE INTO ride_summary_notifications (ride_id, notified_at_ms) VALUES (?, ?)",
        arguments: [rideId, nowMs]
      )
      return db.changesCount > 0
    }
    return claimed ?? false
  }

  func release(rideId: String) {
    guard let writer = resolveWriter() else { return }
    try? writer.write { db in
      try db.execute(
        sql: "DELETE FROM ride_summary_notifications WHERE ride_id = ?",
        arguments: [rideId]
      )
    }
  }
}
