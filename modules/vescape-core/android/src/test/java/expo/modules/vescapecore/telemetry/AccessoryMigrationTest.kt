package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The schema edges that made Accessories, and the rider's calibration for them, durable.
 *
 * Pinned to the columns rather than to the SQL text: what matters is that an enrolled Accessory
 * survives a reboot keyed on its manifest identity, that what the rider calibrated for it is keyed
 * on the capability as well, and that a restored database from an older app reaches this shape
 * without losing the Accessories it never had.
 *
 * @parity /modules/vescape-core/ios/telemetry/PersistenceSchema.swift `createAccessories`
 * @parity /modules/vescape-core/ios/telemetry/PersistenceSchema.swift `createAccessoryGroundClearance`
 */
class AccessoryMigrationTest {
  private fun migrationSql(step: TelemetryMigrationStep): List<String> {
    val sql = mutableListOf<String>()
    val db = object : TelemetryMigrationDatabase {
      override fun execSQL(statement: String) { sql += statement }
      override fun hasColumn(tableName: String, columnName: String) = false
    }
    step.migrate(db)
    return sql
  }

  private fun migrationSql(): List<String> = migrationSql(TelemetryMigrations.MIGRATION_43_44)

  @Test
  fun theAccessoryEdgesAreContiguousThroughSamplingSettings() {
    assertEquals(49, TELEMETRY_DATABASE_VERSION)
    assertEquals(43, TelemetryMigrations.MIGRATION_43_44.startVersion)
    assertEquals(44, TelemetryMigrations.MIGRATION_43_44.endVersion)
    assertEquals(44, TelemetryMigrations.MIGRATION_44_45.startVersion)
    assertEquals(45, TelemetryMigrations.MIGRATION_44_45.endVersion)
    assertEquals(45, TelemetryMigrations.MIGRATION_45_46.startVersion)
    assertEquals(46, TelemetryMigrations.MIGRATION_45_46.endVersion)
    assertEquals(46, TelemetryMigrations.MIGRATION_46_47.startVersion)
    assertEquals(47, TelemetryMigrations.MIGRATION_46_47.endVersion)
    assertEquals(47, TelemetryMigrations.MIGRATION_47_48.startVersion)
    assertEquals(48, TelemetryMigrations.MIGRATION_47_48.endVersion)
    assertTrue(TelemetryMigrations.all.contains(TelemetryMigrations.MIGRATION_47_48))
  }

  @Test
  fun aCalibrationIsKeyedOnTheAccessoryAndTheCapability() {
    val create = migrationSql(TelemetryMigrations.MIGRATION_44_45).single()
    // The composite key is the point: one unit may declare a nose sensor and a tail sensor, and
    // they cannot share near/far distances or a correction direction. Keying on the Accessory alone
    // would make the second one overwrite the first.
    assertTrue(create, create.contains("PRIMARY KEY(accessory_id, capability_id)"))
    for (column in listOf(
      "accessory_id TEXT NOT NULL",
      "capability_id TEXT NOT NULL",
      "near_cm REAL NOT NULL",
      "far_cm REAL NOT NULL",
      "direction TEXT NOT NULL",
      "strength_percent INTEGER NOT NULL",
      "updated_at INTEGER NOT NULL",
    )) {
      assertTrue("missing `$column`", create.contains(column))
    }
    // Same reconciliation reason as the Accessories table: a database restored from iOS already
    // holds it under the GRDB migration id.
    assertTrue(create, create.contains("CREATE TABLE IF NOT EXISTS accessory_ground_clearance"))
  }

  @Test
  fun anEnrolledAccessoryIsKeyedOnItsManifestIdentity() {
    val create = migrationSql().single()
    // The primary key is the whole duplicate defence: the same hardware renamed, re-flashed, or
    // seen on a different BLE handle updates one row rather than adding a second.
    assertTrue(create, create.contains("accessory_id TEXT NOT NULL PRIMARY KEY"))
    for (column in listOf(
      "name TEXT NOT NULL",
      "firmware_version TEXT NOT NULL",
      "protocol_version INTEGER",
      "device_id TEXT",
      "capabilities_json TEXT NOT NULL",
      "enrolled_at INTEGER NOT NULL",
      "last_connected_at INTEGER",
    )) {
      assertTrue("missing `$column`", create.contains(column))
    }
  }

  @Test
  fun theTableIsCreatedIfAbsentSoARestoredIosDatabaseIsAccepted() {
    // GRDB creates the same table under its own migration id. A backup restored from iOS arrives
    // already holding it, and the Room path must reconcile rather than fail.
    assertTrue(migrationSql().single().contains("CREATE TABLE IF NOT EXISTS accessories"))
  }
}
