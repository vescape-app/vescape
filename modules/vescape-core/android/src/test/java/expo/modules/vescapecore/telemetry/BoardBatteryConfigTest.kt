package expo.modules.vescapecore.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import androidx.sqlite.db.SupportSQLiteDatabase
import java.lang.reflect.Proxy
import expo.modules.vescapecore.database.VescapeDatabase

class BoardBatteryConfigTest {
  @Test
  fun rejectsInvalidBatteryConfig() {
    assertNull(
      encodeBatteryConfig(mapOf("mode" to "manual", "minVoltage" to 84, "maxVoltage" to 60)),
    )
    assertNull(
      encodeBatteryConfig(
        mapOf("mode" to "preset", "cellPresetId" to "", "seriesCount" to 20, "parallelCount" to 2),
      ),
    )
  }

  @Test
  fun acceptsValidPresetBatteryConfig() {
    val config = normalizeBatteryConfig(
      mapOf(
        "mode" to "preset",
        "cellPresetId" to "molicel:21700:p50b",
        "seriesCount" to 20,
        "parallelCount" to 2,
      ),
    )

    assertEquals("preset", config?.get("mode"))
    assertEquals("molicel:21700:p50b", config?.get("cellPresetId"))
    assertEquals(20, config?.get("seriesCount"))
    assertEquals(2, config?.get("parallelCount"))
  }

  @Test
  fun acceptsValidManualBatteryConfig() {
    val config = normalizeBatteryConfig(
      mapOf("mode" to "manual", "minVoltage" to 58.0, "maxVoltage" to 82.0),
    )

    assertEquals("manual", config?.get("mode"))
    assertEquals(58.0, config?.get("minVoltage"))
    assertEquals(82.0, config?.get("maxVoltage"))
  }

  @Test
  fun settingJsonRoundTripsBatteryConfigAsJsonObject() {
    val json = encodeSettingJson(
      mapOf(
        "mode" to "preset",
        "cellPresetId" to "molicel:21700:p45b",
        "seriesCount" to 20,
        "parallelCount" to 2,
      ),
    )
    val decoded = decodeSettingJson(json)
    val config = normalizeBatteryConfig(decoded)

    assertTrue(json.startsWith("{"))
    assertTrue(json.endsWith("}"))
    assertEquals("preset", config?.get("mode"))
    assertEquals("molicel:21700:p45b", config?.get("cellPresetId"))
    assertEquals(20, config?.get("seriesCount"))
    assertEquals(2, config?.get("parallelCount"))
  }

  @Test
  fun acceptsLegacyJavaMapStringBatteryConfigRows() {
    val config = normalizeBatteryConfig(
      "{mode=preset, cellPresetId=molicel:21700:p45b, seriesCount=20, parallelCount=2}",
    )

    assertEquals("preset", config?.get("mode"))
    assertEquals("molicel:21700:p45b", config?.get("cellPresetId"))
    assertEquals(20, config?.get("seriesCount"))
    assertEquals(2, config?.get("parallelCount"))
  }

  @Test
  fun migrationResetsExistingBoardBatteryConfigOnly() {
    val sql = mutableListOf<String>()
    val db = Proxy.newProxyInstance(
      SupportSQLiteDatabase::class.java.classLoader,
      arrayOf(SupportSQLiteDatabase::class.java),
    ) { _, method, args ->
      if (method.name == "execSQL") {
        sql += args?.firstOrNull() as String
        null
      } else {
        throw UnsupportedOperationException(method.name)
      }
    } as SupportSQLiteDatabase
    VescapeDatabase.MIGRATION_18_19.migrate(db)

    assertTrue(sql.any { it.contains("CREATE TABLE IF NOT EXISTS boards_new") })
    assertTrue(sql.any { it.contains("battery_config_json TEXT") })
    assertTrue(
      sql.any { it.contains("SELECT id, name, description, ble_id, is_starred, created_at, NULL") },
    )
    assertTrue(sql.any { it == "DROP TABLE boards" })
    assertTrue(sql.any { it == "ALTER TABLE boards_new RENAME TO boards" })
    assertTrue(
      sql.any { it == "CREATE INDEX IF NOT EXISTS index_boards_created_at ON boards(created_at)" },
    )
    assertTrue(
      sql.any { it == "CREATE INDEX IF NOT EXISTS index_boards_is_starred ON boards(is_starred)" },
    )
  }

  @Test
  fun boardSettingsMigrationMovesMutableBoardFieldsOutOfBoards() {
    val sql = mutableListOf<String>()
    val db = Proxy.newProxyInstance(
      SupportSQLiteDatabase::class.java.classLoader,
      arrayOf(SupportSQLiteDatabase::class.java),
    ) { _, method, args ->
      if (method.name == "execSQL") {
        sql += args?.firstOrNull() as String
        null
      } else {
        throw UnsupportedOperationException(method.name)
      }
    } as SupportSQLiteDatabase
    VescapeDatabase.MIGRATION_20_21.migrate(db)

    assertTrue(sql.any { it.contains("CREATE TABLE IF NOT EXISTS board_settings") })
    assertTrue(sql.any { it.contains("PRIMARY KEY (board_id, key)") })
    assertTrue(sql.any { it.contains("SELECT id, 'description', json_quote(description), created_at") })
    assertTrue(sql.any { it.contains("SELECT id, 'batteryConfig', battery_config_json, created_at") })
    assertTrue(sql.any { it.contains("CREATE TABLE IF NOT EXISTS boards_new") })
    assertTrue(sql.any { it.contains("name TEXT NOT NULL") })
    assertTrue(sql.any { it.contains("ble_id TEXT") })
    assertTrue(sql.any { it.contains("created_at INTEGER NOT NULL") })
    assertTrue(sql.any { it == "DROP INDEX IF EXISTS index_boards_is_starred" })
    assertTrue(sql.any { it == "DROP TABLE boards" })
    assertTrue(sql.any { it == "ALTER TABLE boards_new RENAME TO boards" })
  }
}
