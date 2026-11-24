package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import expo.modules.vescapecore.config.RefloatConfigSchemaParser
import expo.modules.vescapecore.database.BoardConfigValuesEntity
import expo.modules.vescapecore.database.VescapeRoomDatabase
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * @parity /modules/vescape-core/persistence-macos/main.swift `runBoardConfigSchemaContract`
 */
class BoardConfigSchemaPersistenceHostTest {
  private val sampleXml = """
    <ConfigParams>
      <Params>
        <kp>
          <type>1</type>
          <vTx>7</vTx>
          <vTxDoubleScale>10</vTxDoubleScale>
          <longName>Angle P</longName>
          <valDouble>20</valDouble>
        </kp>
        <leds.on>
          <type>5</type>
          <longName>LEDs On</longName>
          <valInt>1</valInt>
        </leds.on>
      </Params>
      <SerOrder>
        <ser>kp</ser>
        <ser>leds.on</ser>
      </SerOrder>
      <Grouping>
        <group>
          <groupName>General</groupName>
          <subgroup>
            <subgroupName>Tune</subgroupName>
            <subgroupParams>
              <param>::sep::PID</param>
              <param>kp</param>
              <param>leds.on</param>
            </subgroupParams>
          </subgroup>
        </group>
      </Grouping>
    </ConfigParams>
  """.trimIndent()

  private fun open(path: String) =
    Room.databaseBuilder<VescapeRoomDatabase>(path).setDriver(BundledSQLiteDriver()).build()

  @Test
  fun deduplicatesSchemasAcrossBoardsAndSkipsFalseBoolUpgradeNotice(): Unit = runBlocking {
    val file = Files.createTempFile("vescape-schema-contract", ".db").toFile()
    try {
      val schema = RefloatConfigSchemaParser.parse(sampleXml.encodeToByteArray())
      val room = open(file.path)
      try {
        val dao = room.vescapeDao()
        val persistence = ConfigPersistence(dao)

        dao.upsertBoardConfigValues(
          BoardConfigValuesEntity("board-a", "1.3", """{"kp":20.0,"leds.on":1.0}""", 1000L, null),
        )
        assertNull(dao.getLatestBoardConfigValues("board-a")?.schemaHash)

        val notice = persistence.saveFreshBoard(
          boardId = "board-a",
          base = "1.3",
          values = mapOf("kp" to 20.0, "leds.on" to true),
          capturedAt = 2000L,
          schema = schema,
        )
        assertNull("Upgrade from 1.0 to true on BOOL field must not raise Change Notice", notice)
        assertEquals(1, dao.countBoardConfigSchemas())
        assertEquals(schema.hash, dao.getBoardConfigValues("board-a", "1.3")?.schemaHash)

        persistence.saveFreshBoard(
          boardId = "board-b",
          base = "1.3",
          values = mapOf("kp" to 22.0, "leds.on" to false),
          capturedAt = 3000L,
          schema = schema,
        )
        assertEquals(1, dao.countBoardConfigSchemas())
        assertEquals(2000L, dao.getBoardConfigSchema(schema.hash)?.createdAt)
        assertEquals(schema.hash, dao.getBoardConfigValues("board-b", "1.3")?.schemaHash)
      } finally {
        room.close()
      }

      val reopened = open(file.path)
      try {
        val persistence = ConfigPersistence(reopened.vescapeDao())
        val loaded = persistence.loadSchema(schema.hash)
        assertNotNull(loaded)
        assertEquals(schema.hash, loaded?.hash)
        assertEquals(schema.fields, loaded?.fields)
        assertEquals(schema.groups, loaded?.groups)
      } finally {
        reopened.close()
      }
    } finally {
      file.delete()
    }
  }
}
