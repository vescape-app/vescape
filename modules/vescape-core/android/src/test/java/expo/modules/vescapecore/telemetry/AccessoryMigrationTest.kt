package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import expo.modules.vescapecore.database.DatabaseMigrations
import expo.modules.vescapecore.database.MigrationDatabase
import expo.modules.vescapecore.database.MigrationStep

/**
 * @parity /modules/vescape-core/ios/database/PersistenceSchema.swift `createAccessories`
 * @parity /modules/vescape-core/ios/database/PersistenceSchema.swift `createAccessoryGroundClearance`
 */
class AccessoryMigrationTest {
  private fun migrationSql(step: MigrationStep): List<String> {
    val sql = mutableListOf<String>()
    val db = object : MigrationDatabase {
      override fun execSQL(statement: String) { sql += statement }
      override fun hasColumn(tableName: String, columnName: String) = false
    }
    step.migrate(db)
    return sql
  }

  private fun migrationSql(): List<String> = migrationSql(DatabaseMigrations.MIGRATION_43_44)

  @Test
  fun theAccessoryEdgesAreContiguousThroughSamplingSettings() {
    assertEquals(43, DatabaseMigrations.MIGRATION_43_44.startVersion)
    assertEquals(44, DatabaseMigrations.MIGRATION_43_44.endVersion)
    assertEquals(44, DatabaseMigrations.MIGRATION_44_45.startVersion)
    assertEquals(45, DatabaseMigrations.MIGRATION_44_45.endVersion)
    assertEquals(45, DatabaseMigrations.MIGRATION_45_46.startVersion)
    assertEquals(46, DatabaseMigrations.MIGRATION_45_46.endVersion)
    assertEquals(46, DatabaseMigrations.MIGRATION_46_47.startVersion)
    assertEquals(47, DatabaseMigrations.MIGRATION_46_47.endVersion)
    assertEquals(47, DatabaseMigrations.MIGRATION_47_48.startVersion)
    assertEquals(48, DatabaseMigrations.MIGRATION_47_48.endVersion)
    assertTrue(DatabaseMigrations.all.contains(DatabaseMigrations.MIGRATION_47_48))
  }

  @Test
  fun aCalibrationIsKeyedOnTheAccessoryAndTheCapability() {
    val create = migrationSql(DatabaseMigrations.MIGRATION_44_45).single()
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
    assertTrue(create, create.contains("CREATE TABLE IF NOT EXISTS accessory_ground_clearance"))
  }

  @Test
  fun anEnrolledAccessoryIsKeyedOnItsManifestIdentity() {
    val create = migrationSql().single()
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
    assertTrue(migrationSql().single().contains("CREATE TABLE IF NOT EXISTS accessories"))
  }
}
