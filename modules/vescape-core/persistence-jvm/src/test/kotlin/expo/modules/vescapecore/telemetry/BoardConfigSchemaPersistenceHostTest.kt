package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import expo.modules.vescapecore.config.BoardConfigRevisionSource
import expo.modules.vescapecore.config.RefloatConfigSchemaParser
import expo.modules.vescapecore.database.BoardConfigValuesEntity
import expo.modules.vescapecore.database.VescapeRoomDatabase
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        var parseErrors = 0
        val dao = reopened.vescapeDao()
        val persistence = ConfigPersistence(dao, onInvalidSchemaXml = { parseErrors++ })
        val loaded = persistence.loadSchema(schema.hash)
        assertNotNull(loaded)
        assertEquals(schema.hash, loaded?.hash)
        assertEquals(schema.fields, loaded?.fields)
        assertEquals(schema.groups, loaded?.groups)
        assertEquals(0, parseErrors)

        dao.insertBoardConfigSchemaIfAbsent(
          expo.modules.vescapecore.database.BoardConfigSchemaEntity("corrupt-hash", "<not-xml", 4000L),
        )
        assertNull(persistence.loadSchema("corrupt-hash"))
        assertEquals(1, parseErrors)
      } finally {
        reopened.close()
      }
    } finally {
      file.delete()
    }
  }

  @Test
  fun recordsRevisionsForReadsWritesIgnoredFieldsAndSurvivesLinkIntegrityClear(): Unit = runBlocking {
    val file = Files.createTempFile("vescape-revision-contract", ".db").toFile()
    try {
      val schema = RefloatConfigSchemaParser.parse(sampleXml.encodeToByteArray())
      fun rawBytes(kp: Double, ledsOn: Boolean): ByteArray {
        val scaled = (kp * 10.0).toInt()
        return byteArrayOf(
          ((scaled ushr 8) and 0xff).toByte(),
          (scaled and 0xff).toByte(),
          if (ledsOn) 1 else 0,
        )
      }
      val room = open(file.path)
      try {
        val dao = room.vescapeDao()
        val persistence = ConfigPersistence(dao)

        val firstNotice = persistence.saveFreshBoard(
          boardId = "board-rev",
          base = "1.3",
          values = mapOf("kp" to 20.0, "leds.on" to true),
          capturedAt = 1000L,
          schema = schema,
          refloatVersion = "1.3.0",
          rawConfig = rawBytes(20.0, true),
          packageSignature = 99L,
        )
        assertNull(firstNotice)
        val afterSeed = persistence.loadRevisions("board-rev")
        assertEquals(1, afterSeed.size)
        assertEquals(BoardConfigRevisionSource.EXTERNAL, afterSeed[0].source)
        assertTrue(afterSeed[0].changes.isEmpty())
        assertEquals("1.3.0", afterSeed[0].refloatVersion)

        persistence.saveFreshBoard(
          boardId = "board-rev",
          base = "1.3",
          values = mapOf("kp" to 20.0, "leds.on" to true),
          capturedAt = 1500L,
          schema = schema,
          refloatVersion = "1.3.0",
          rawConfig = rawBytes(20.0, true),
          packageSignature = 99L,
        )
        assertEquals(1, persistence.loadRevisions("board-rev").size)

        persistence.saveBoardWrite(
          boardId = "board-rev",
          base = "1.3",
          values = mapOf("kp" to 25.0, "leds.on" to true),
          capturedAt = 2000L,
          schema = schema,
          refloatVersion = "1.3.0",
          rawConfig = rawBytes(25.0, true),
          packageSignature = 99L,
          source = BoardConfigRevisionSource.APP,
          tuneProfileId = "profile-trail",
        )
        persistence.saveBoardWrite(
          boardId = "board-rev",
          base = "1.3",
          values = mapOf("kp" to 25.0, "leds.on" to true),
          capturedAt = 2500L,
          schema = schema,
          refloatVersion = "1.3.0",
          rawConfig = rawBytes(25.0, true),
          packageSignature = 99L,
          source = BoardConfigRevisionSource.APP,
          tuneProfileId = "profile-trail",
        )
        val afterWrite = persistence.loadRevisions("board-rev")
        assertEquals(2, afterWrite.size)
        assertEquals(BoardConfigRevisionSource.APP, afterWrite[0].source)
        assertEquals("profile-trail", afterWrite[0].tuneProfileId)
        assertEquals(listOf("kp"), afterWrite[0].changes.map { it.fieldId })
        assertEquals(20.0, (afterWrite[0].changes[0].oldValue as Number).toDouble(), 1e-6)
        assertEquals(25.0, (afterWrite[0].changes[0].newValue as Number).toDouble(), 1e-6)

        persistence.setFieldIgnored("board-rev", "leds.on", true, 2600L)
        val ignoredNotice = persistence.saveFreshBoard(
          boardId = "board-rev",
          base = "1.3",
          values = mapOf("kp" to 25.0, "leds.on" to false),
          capturedAt = 3000L,
          schema = schema,
          refloatVersion = "1.3.0",
          rawConfig = rawBytes(25.0, false),
          packageSignature = 99L,
        )
        assertNull("Ignored field must not trigger Change Notice", ignoredNotice)
        val afterExternal = persistence.loadRevisions("board-rev")
        assertEquals(3, afterExternal.size)
        assertEquals(BoardConfigRevisionSource.EXTERNAL, afterExternal[0].source)
        assertEquals(listOf("leds.on"), afterExternal[0].changes.map { it.fieldId })
        assertEquals(true, afterExternal[0].changes[0].oldValue)
        assertEquals(false, afterExternal[0].changes[0].newValue)

        dao.clearBoardConfigState("board-rev")
        assertNull(dao.getLatestBoardConfigValues("board-rev"))
        assertEquals(3, persistence.loadRevisions("board-rev").size)
      } finally {
        room.close()
      }
    } finally {
      file.delete()
    }
  }
}
