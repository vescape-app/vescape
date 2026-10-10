package expo.modules.vescapecore.config

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every field in [BoardConfigFlagField] and [BoardConfigNumberField], resolved against the real `settings.xml` of each Refloat
 * version we support. The fixtures are the firmware's own files, taken from the Refloat repository
 * tags, so a field renamed or retyped upstream fails here rather than on a rider's board.
 *
 * They are stored zlib-compressed and handed to the parser exactly as they arrive, which is also how
 * a board sends them: [RefloatConfigSchemaParser.normalizeXmlBytes] inflates the stream itself, so
 * the fixture exercises the real entry point rather than a pre-decompressed shortcut.
 *
 * `1.1.x` is one fixture on purpose: v1.1.0, v1.1.1 and v1.1.2 ship byte-identical XML.
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigFieldsTests.swift
 */
class BoardConfigFieldsTest {
  /** The shared fixture corpus, found by walking up from the Gradle module directory. */
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

  /**
   * Refloat declares its on/off params as single-byte numbers, never as a schema `bool`. This is the
   * assumption [encodeFlag] and [BoardConfigValues.flag] are built on, so it is asserted rather than
   * trusted: a widened field would silently change the decoded representation.
   */
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

  /**
   * The regression this whole seam exists for: rebasing a flag must produce the exact runtime type
   * the decoder produces, or the config-change notice reports the rider's own tap as an outside edit
   * forever — `Off -> 0`, a `Boolean` compared against a `Double`.
   */
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

  /** Zeroed bytes decode to `off`, so the accessor must answer `false` — not null, not `0.0`. */
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

  /**
   * A number field that stops resolving does not misreport, it stops evaluating — a Board Warning
   * quietly never fires again. Rules read finite numbers, so the decoded type is asserted too.
   */
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

  /** A field no schema carries stays absent: adding the key would itself register as a change. */
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
