package expo.modules.vescapecore.config

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigFieldsTests.swift
 */
class BoardConfigFieldsTest {
  private fun repoRoot(): File {
    var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
    while (dir != null && !File(dir, "shared/fixtures/refloat-schema").isDirectory) dir = dir.parentFile
    return requireNotNull(dir) { "shared/fixtures/refloat-schema not found above ${System.getProperty("user.dir")}" }
  }

  private fun schema(version: String): RefloatConfigSchema {
    val file = File(repoRoot(), "shared/fixtures/refloat-schema/settings-$version.xml.zlib")
    require(file.isFile) { "missing schema fixture for $version" }
    return RefloatConfigSchemaParser.parse(file.readBytes())
  }

  private fun versions() = listOf("1.0.0", "1.1.x", "1.2.x", "1.3.0-beta1")

  @Test
  fun everyFlagFieldExistsInEverySupportedRefloatVersion() {
    for (version in versions()) {
      val byId = schema(version).fields.associateBy { it.id }
      for (id in BoardConfigFlagField.entries.map { it.id } + BoardConfigNumberField.entries.map { it.id }) {
        assertNotNull("Refloat $version has no field $id", byId[id])
      }
    }
  }

  @Test
  fun flagFieldsAreSingleByteInEverySupportedRefloatVersion() {
    for (version in versions()) {
      val byId = schema(version).fields.associateBy { it.id }
      for (field in BoardConfigFlagField.entries) {
        val type = byId.getValue(field.id).type
        assertEquals("Refloat $version widened ${field.id} to $type", 1, type.byteSize)
      }
    }
  }

  @Test
  fun rebasedFlagKeepsTheDecodedRuntimeTypeAndRaisesNoDiff() {
    for (version in versions()) {
      val schema = schema(version)
      val rawConfig = ByteArray(schema.fields.maxOf { it.offset + it.type.byteSize })
      val decoded = RefloatConfigDecoder.decodeFieldMap(schema, rawConfig)
      val values = BoardConfigValues(
        boardId = "board",
        refloatBaseVersion = version,
        capturedAtMs = 0,
        freshness = BoardConfigFreshness.FRESH,
        values = decoded,
        writeBase = BoardConfigWriteBase(schema, rawConfig, 0),
      )

      for (field in BoardConfigFlagField.entries) {
        val rebased = values.withFlag(field, false)
        assertNotNull("Refloat $version cannot rebase ${field.id}", rebased)
        requireNotNull(rebased)
        val rebasedValue: Any = rebased.values.getValue(field.id)
        val decodedValue: Any = decoded.getValue(field.id)
        assertEquals(
          "Refloat $version rebased ${field.id} as ${rebasedValue::class.java.simpleName}",
          decodedValue::class.java,
          rebasedValue::class.java,
        )
        assertTrue(
          "Refloat $version rebasing ${field.id} to its decoded value reported a change",
          BoardConfigChangeNotice.diff(rebased.values, decoded, schema).isEmpty(),
        )
      }
    }
  }

  @Test
  fun withLightsPatchesTheWriteBaseBytesInEverySupportedRefloatVersion() {
    for (version in versions()) {
      val schema = schema(version)
      val rawConfig = ByteArray(schema.fields.maxOf { it.offset + it.type.byteSize })
      val values = BoardConfigValues(
        boardId = "board",
        refloatBaseVersion = version,
        capturedAtMs = 0,
        freshness = BoardConfigFreshness.FRESH,
        values = RefloatConfigDecoder.decodeFieldMap(schema, rawConfig),
        writeBase = BoardConfigWriteBase(schema, rawConfig, 0),
      )

      val lit = requireNotNull(values.withLights(enabled = true, headlightsEnabled = true))
      val reread = RefloatConfigDecoder.decodeFieldMap(schema, requireNotNull(lit.writeBase).rawConfig)

      for (field in BoardConfigFlagField.entries) {
        assertEquals("Refloat $version write base keeps ${field.id} off", true, lit.copy(values = reread).flag(field))
      }
      assertTrue(
        "Refloat $version decoded values disagree with the patched write base",
        BoardConfigChangeNotice.diff(lit.values, reread, schema).isEmpty(),
      )
    }
  }

  @Test
  fun flagReadsTheNumericRepresentationRefloatActuallyUses() {
    val schema = schema("1.1.x")
    val rawConfig = ByteArray(schema.fields.maxOf { it.offset + it.type.byteSize })
    val values = BoardConfigValues(
      boardId = "board",
      refloatBaseVersion = "1.1.x",
      capturedAtMs = 0,
      freshness = BoardConfigFreshness.FRESH,
      values = RefloatConfigDecoder.decodeFieldMap(schema, rawConfig),
      writeBase = BoardConfigWriteBase(schema, rawConfig, 0),
    )
    assertEquals(false, values.flag(BoardConfigFlagField.LEDS_ON))
    assertEquals(true, values.withFlag(BoardConfigFlagField.LEDS_ON, true)!!.flag(BoardConfigFlagField.LEDS_ON))
  }

  @Test
  fun everyNumberFieldDecodesAsAFiniteNumberInEverySupportedRefloatVersion() {
    for (version in versions()) {
      val schema = schema(version)
      val rawConfig = ByteArray(schema.fields.maxOf { it.offset + it.type.byteSize })
      val values = BoardConfigValues(
        boardId = "board",
        refloatBaseVersion = version,
        capturedAtMs = 0,
        freshness = BoardConfigFreshness.FRESH,
        values = RefloatConfigDecoder.decodeFieldMap(schema, rawConfig),
        writeBase = BoardConfigWriteBase(schema, rawConfig, 0),
      )
      for (field in BoardConfigNumberField.entries) {
        assertNotNull("Refloat $version does not decode ${field.id} as a number", values.number(field))
      }
    }
  }

  @Test
  fun withFlagRefusesAFieldNeitherSchemaNorValuesKnow() {
    val values = BoardConfigValues(
      boardId = "board",
      refloatBaseVersion = "1.1.x",
      capturedAtMs = 0,
      freshness = BoardConfigFreshness.LAST_KNOWN,
      values = emptyMap(),
      writeBase = null,
    )
    assertNull(values.withFlag(BoardConfigFlagField.LEDS_ON, true))
  }
}
