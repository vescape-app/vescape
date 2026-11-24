package expo.modules.vescapecore.config

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardConfigXmlCodecTest {
  private fun repoRoot(): File {
    var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
    while (dir != null && !File(dir, "shared/fixtures/refloat-schema").isDirectory) dir = dir.parentFile
    return requireNotNull(dir) { "shared/fixtures/refloat-schema not found above ${System.getProperty("user.dir")}" }
  }

  private fun parseFixture(version: String): RefloatConfigSchema {
    val file = File(repoRoot(), "shared/fixtures/refloat-schema/settings-$version.xml.zlib")
    require(file.isFile) { "missing fixture $version" }
    return RefloatConfigSchemaParser.parse(file.readBytes())
  }

  private fun readVescToolExportFixture(): String {
    val file = File(repoRoot(), "shared/fixtures/refloat-schema/vesc-tool-export-1.3.0.xml")
    require(file.isFile) { "missing VESC Tool export fixture" }
    return file.readText(Charsets.UTF_8)
  }

  private fun buildDefaultConfigBytes(
    schema: RefloatConfigSchema,
    overlay: RefloatFieldOverlay = RefloatFieldOverlay.empty,
  ): ByteArray {
    val totalSize = schema.fields.maxOfOrNull { it.offset + it.type.byteSize } ?: 0
    val raw = ByteArray(totalSize)
    for (field in schema.fields) {
      val defaultValue = field.defaultValue ?: continue
      val encoded = try {
        RefloatConfigEncoder.encodeFieldBytes(field, defaultValue, overlay)
      } catch (_: RefloatConfigEncodeException) {
        continue
      }
      encoded.copyInto(raw, destinationOffset = field.offset)
    }
    return raw
  }

  @Test
  fun exportThenReimportProducesEmptyChangeset() {
    val schema = parseFixture("1.3.0")
    val baseRaw = buildDefaultConfigBytes(schema)
    val modifiedRaw = RefloatConfigEncoder.encode(
      schema,
      baseRaw,
      mapOf(
        "kp" to 32.5,
        "atr_strength_up" to 2.2,
        "turntilt_strength" to 3.5,
        "leds.on" to false,
        "leds.front.mode" to 2.0,
      ),
    )

    val xml = BoardConfigXmlCodec.exportXml(schema, modifiedRaw)
    assertTrue(xml.contains("<CustomConfiguration>"))
    assertTrue(xml.contains("<ConfigVersion>4</ConfigVersion>"))
    assertTrue(xml.contains("<leds.on>0</leds.on>"))
    assertTrue(xml.contains("<leds.front.mode>2</leds.front.mode>"))
    assertTrue(xml.contains("</CustomConfiguration>"))

    val plan = BoardConfigXmlCodec.planImport(
      boardId = "board-1",
      currentSchema = schema,
      currentRawConfig = modifiedRaw,
      xml = xml,
    )

    assertEquals(4, plan.configVersion)
    assertEquals(schema.hash, plan.currentSchemaHash)
    assertTrue("Expected empty changeset on re-import, got ${plan.changes}", plan.changes.isEmpty())
    assertTrue("Expected no skipped fields on re-import, got ${plan.skippedFields}", plan.skippedFields.isEmpty())
  }

  @Test
  fun realisticVescToolExportFixtureImportsOnlyChangedFields() {
    val schema = parseFixture("1.3.0")
    val defaultRaw = buildDefaultConfigBytes(schema)
    val fixtureXml = readVescToolExportFixture()

    val plan = BoardConfigXmlCodec.planImport(
      boardId = "board-1",
      currentSchema = schema,
      currentRawConfig = defaultRaw,
      xml = fixtureXml,
    )

    assertEquals(4, plan.configVersion)
    assertEquals(
      setOf("kp", "atr_strength_up", "turntilt_strength", "leds.on", "leds.front.mode"),
      plan.changes.keys,
    )
    assertEquals(31.5, plan.changes["kp"] as Double, 1e-6)
    assertEquals(2.1, plan.changes["atr_strength_up"] as Double, 1e-6)
    assertEquals(3.25, plan.changes["turntilt_strength"] as Double, 1e-6)
    assertEquals(false, plan.changes["leds.on"])
    assertEquals(2.0, plan.changes["leds.front.mode"] as Double, 1e-6)
    assertFalse(plan.changes.containsKey("meta.is_default"))
    assertTrue(plan.skippedFields.isEmpty())

    val applied = RefloatConfigEncoder.encodeChangeset(schema, defaultRaw, plan.changes).rawConfig
    val secondPass = BoardConfigXmlCodec.planImport(
      boardId = "board-1",
      currentSchema = schema,
      currentRawConfig = applied,
      xml = fixtureXml,
    )
    assertTrue(secondPass.changes.isEmpty())
    assertTrue(secondPass.skippedFields.isEmpty())
  }

  @Test
  fun crossVersionImportListsUnknownIdsInSkippedFields() {
    val schema121 = parseFixture("1.2.1")
    val schema130 = parseFixture("1.3.0")

    val raw121 = RefloatConfigEncoder.encode(
      schema121,
      buildDefaultConfigBytes(schema121),
      mapOf("kp" to 28.0, "atr_strength_up" to 1.8),
    )
    val raw130 = RefloatConfigEncoder.encode(
      schema130,
      buildDefaultConfigBytes(schema130),
      mapOf("kp" to 22.0, "atr_strength_up" to 0.9),
    )

    val xml121 = BoardConfigXmlCodec.exportXml(schema121, raw121)
    val plan121To130 = BoardConfigXmlCodec.planImport(
      boardId = "board-1",
      currentSchema = schema130,
      currentRawConfig = raw130,
      xml = xml121,
    )

    assertEquals(28.0, plan121To130.changes["kp"] as Double, 1e-6)
    assertEquals(1.8, plan121To130.changes["atr_strength_up"] as Double, 1e-6)

    val ids130 = schema130.fields.map { it.id }.toSet()
    val removedFrom121 = schema121.fields
      .filter { it.id !in ids130 && !it.id.startsWith("meta.") && !RefloatFieldOverlay.shared.isInternal(it.id) }
      .map { it.id }
    assertTrue(removedFrom121.isNotEmpty())
    val skipped121To130 = plan121To130.skippedFields.associateBy { it.fieldId }
    for (id in removedFrom121) {
      assertTrue("Expected $id in skippedFields", id in skipped121To130)
      assertEquals("Not in current firmware schema", skipped121To130[id]?.reason)
    }

    val xml130 = BoardConfigXmlCodec.exportXml(schema130, raw130)
    val plan130To121 = BoardConfigXmlCodec.planImport(
      boardId = "board-1",
      currentSchema = schema121,
      currentRawConfig = raw121,
      xml = xml130,
    )
    val ids121 = schema121.fields.map { it.id }.toSet()
    val addedIn130 = schema130.fields
      .filter { it.id !in ids121 && !it.id.startsWith("meta.") && !RefloatFieldOverlay.shared.isInternal(it.id) }
      .map { it.id }
    assertTrue(addedIn130.isNotEmpty())
    val skipped130To121 = plan130To121.skippedFields.associateBy { it.fieldId }
    for (id in addedIn130) {
      assertTrue("Expected $id in skippedFields", id in skipped130To121)
      assertEquals("Not in current firmware schema", skipped130To121[id]?.reason)
    }
  }

  @Test
  fun ignoresInternalFieldsAndSkipsInvalidValues() {
    val schema = RefloatConfigSchema(
      hash = "test-hash",
      fields = listOf(
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "Angle P", null, 0.0, 100.0, 0),
        RefloatConfigSchemaField("limit_field", RefloatConfigValueType.UINT8, "Limit", null, 0.0, 50.0, 4),
        RefloatConfigSchemaField("flag_field", RefloatConfigValueType.BOOL, "Flag", null, null, null, 5),
        RefloatConfigSchemaField("meta.is_default", RefloatConfigValueType.BOOL, "Is Default", null, null, null, 6),
        RefloatConfigSchemaField("group_internal", RefloatConfigValueType.UINT8, "Group Internal", null, 0.0, 255.0, 7),
        RefloatConfigSchemaField("overlay_internal", RefloatConfigValueType.UINT8, "Overlay Internal", null, 0.0, 255.0, 8),
        RefloatConfigSchemaField("hard_limited", RefloatConfigValueType.UINT8, "Hard Limited", null, 0.0, 200.0, 9),
      ),
      groups = listOf(
        RefloatConfigSchemaGroup(
          name = "Internal",
          subgroups = listOf(
            RefloatConfigSchemaSubgroup(
              name = "Flags",
              items = listOf(RefloatConfigSchemaGroupItem.Field("group_internal")),
            ),
          ),
        ),
      ),
    )
    val overlay = RefloatFieldOverlay(
      mapOf(
        "overlay_internal" to RefloatFieldOverlayEntry(risk = RefloatFieldRisk.INTERNAL),
        "hard_limited" to RefloatFieldOverlayEntry(hardMax = 40.0),
      ),
    )

    val currentRaw = RefloatConfigEncoder.encode(
      schema,
      ByteArray(10),
      mapOf("kp" to 20.0, "limit_field" to 10.0, "flag_field" to false, "hard_limited" to 20.0),
      overlay,
    )

    val xml = """
      <?xml version="1.0" encoding="UTF-8"?>
      <CustomConfiguration>
          <ConfigVersion>4</ConfigVersion>
          <kp>25.5</kp>
          <limit_field>120</limit_field>
          <flag_field>not-a-bool</flag_field>
          <hard_limited>80</hard_limited>
          <meta.is_default>1</meta.is_default>
          <group_internal>42</group_internal>
          <overlay_internal>77</overlay_internal>
          <unknown_param>123</unknown_param>
      </CustomConfiguration>
    """.trimIndent()

    val plan = BoardConfigXmlCodec.planImport(
      boardId = "board-1",
      currentSchema = schema,
      currentRawConfig = currentRaw,
      xml = xml,
      overlay = overlay,
    )

    assertEquals(setOf("kp"), plan.changes.keys)
    assertEquals(25.5, plan.changes["kp"] as Double, 1e-6)
    assertEquals(
      listOf("limit_field", "flag_field", "hard_limited", "unknown_param"),
      plan.skippedFields.map { it.fieldId },
    )
    assertFalse(plan.changes.containsKey("meta.is_default"))
    assertFalse(plan.changes.containsKey("group_internal"))
    assertFalse(plan.changes.containsKey("overlay_internal"))
    assertFalse(plan.skippedFields.any { it.fieldId in setOf("meta.is_default", "group_internal", "overlay_internal") })
  }

  @Test
  fun rejectsMalformedWrongRootAndDoctypeXmlWithTypedError() {
    val schema = parseFixture("1.3.0")
    val raw = buildDefaultConfigBytes(schema)

    val malformed = assertThrows(RefloatConfigEncodeException::class.java) {
      BoardConfigXmlCodec.planImport("board-1", schema, raw, "<CustomConfiguration><kp>20")
    }
    assertEquals(RefloatConfigErrorCode.INVALID_CONFIG_XML, malformed.code)

    val empty = assertThrows(RefloatConfigEncodeException::class.java) {
      BoardConfigXmlCodec.planImport("board-1", schema, raw, "   ")
    }
    assertEquals(RefloatConfigErrorCode.INVALID_CONFIG_XML, empty.code)

    val wrongRoot = assertThrows(RefloatConfigEncodeException::class.java) {
      BoardConfigXmlCodec.planImport("board-1", schema, raw, "<MCConfiguration><kp>20</kp></MCConfiguration>")
    }
    assertEquals(RefloatConfigErrorCode.INVALID_CONFIG_XML, wrongRoot.code)

    val doctype = assertThrows(RefloatConfigEncodeException::class.java) {
      BoardConfigXmlCodec.planImport(
        "board-1",
        schema,
        raw,
        "<!DOCTYPE foo><CustomConfiguration><kp>20</kp></CustomConfiguration>",
      )
    }
    assertEquals(RefloatConfigErrorCode.INVALID_CONFIG_XML, doctype.code)
  }

  @Test
  fun rejectsUnsupportedConfigVersionAndEnforcesStrictDecimalFormattingAndParsing() {
    val schema = RefloatConfigSchema(
      hash = "xml-parity",
      fields = listOf(
        RefloatConfigSchemaField("ki", RefloatConfigValueType.FLOAT16_SCALED, "Angle I", null, 0.0, 0.5, 0, 100_000.0),
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "Angle P", null, 0.0, 100.0, 2),
      ),
    )
    val raw = RefloatConfigEncoder.encode(schema, ByteArray(6), mapOf("ki" to 0.0001, "kp" to 20.0))

    val exported = BoardConfigXmlCodec.exportXml(schema, raw)
    assertTrue("Expected plain decimal 0.0001 in XML, got:\n$exported", exported.contains("<ki>0.0001</ki>"))
    assertFalse("Must not emit scientific notation 1.0E-4", exported.contains("1.0E-4"))

    val rawTiny = RefloatConfigEncoder.encode(schema, ByteArray(6), mapOf("ki" to 0.00001, "kp" to 20.0))
    val exportedTiny = BoardConfigXmlCodec.exportXml(schema, rawTiny)
    assertTrue("Expected plain decimal 0.00001 in XML, got:\n$exportedTiny", exportedTiny.contains("<ki>0.00001</ki>"))

    for (badVersion in listOf("3", "5", "abc", "")) {
      val err = assertThrows(RefloatConfigEncodeException::class.java) {
        BoardConfigXmlCodec.planImport(
          "board-1",
          schema,
          raw,
          "<CustomConfiguration><ConfigVersion>$badVersion</ConfigVersion><kp>25</kp></CustomConfiguration>",
        )
      }
      assertEquals(RefloatConfigErrorCode.INVALID_CONFIG_XML, err.code)
    }

    for (badNumeric in listOf("25d", "25f", "0x10", "0x1.0p0")) {
      val plan = BoardConfigXmlCodec.planImport(
        "board-1",
        schema,
        raw,
        "<CustomConfiguration><ConfigVersion>4</ConfigVersion><kp>$badNumeric</kp></CustomConfiguration>",
      )
      assertTrue("Expected $badNumeric to be rejected", plan.changes.isEmpty())
      assertEquals(listOf("kp"), plan.skippedFields.map { it.fieldId })
      assertEquals("Invalid numeric value: $badNumeric", plan.skippedFields[0].reason)
    }
  }
}
