package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The schema edge that made Accessories durable.
 *
 * Pinned to the columns rather than to the SQL text: what matters is that an enrolled Accessory
 * survives a reboot keyed on its manifest identity, and that a restored database from an older
 * app reaches this shape without losing the Accessories it never had.
 *
 * @parity /modules/vescape-core/ios/telemetry/PersistenceSchema.swift `createAccessories`
 */
class AccessoryMigrationTest {
  private fun migrationSql(): List<String> {
    val sql = mutableListOf<String>()
    val db = object : TelemetryMigrationDatabase {
      override fun execSQL(statement: String) { sql += statement }
      override fun hasColumn(tableName: String, columnName: String) = false
    }
    TelemetryMigrations.MIGRATION_43_44.migrate(db)
    return sql
  }

  @Test
  fun accessoriesAreTheCurrentTailOfTheMigrationGraph() {
    assertEquals(44, TELEMETRY_DATABASE_VERSION)
    assertEquals(43, TelemetryMigrations.MIGRATION_43_44.startVersion)
    assertEquals(TELEMETRY_DATABASE_VERSION, TelemetryMigrations.MIGRATION_43_44.endVersion)
    assertEquals(TelemetryMigrations.all.last(), TelemetryMigrations.MIGRATION_43_44)
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
