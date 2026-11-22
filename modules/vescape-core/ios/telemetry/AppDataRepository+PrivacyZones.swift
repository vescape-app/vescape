import Foundation
import GRDB

extension AppDataRepository {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt `reloadPrivacyZonesIntoRecorder`
  func getEnabledPrivacyZoneEntities() throws -> [PrivacyZoneEntity] {
    let pool = try VescapeDatabase.requirePool()
    return try pool.read { db in
      try Row.fetchAll(
        db,
        sql: """
          SELECT id, enabled, center_latitude_e7, center_longitude_e7, radius_meters
          FROM privacy_zones WHERE enabled = 1
          """
      ).map { row in
        PrivacyZoneEntity(
          id: row["id"],
          enabled: (row["enabled"] as Int64) != 0,
          centerLatitudeE7: Int(row["center_latitude_e7"] as Int64),
          centerLongitudeE7: Int(row["center_longitude_e7"] as Int64),
          radiusMeters: Int(row["radius_meters"] as Int64)
        )
      }
    }
  }
}
