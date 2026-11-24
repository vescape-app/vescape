package expo.modules.vescapecore.config

import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.DeflaterOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RefloatConfigSchemaTest {
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
  @Test fun `doctype detection ignores comments and cdata`() {
    assertFalse(RefloatConfigSchemaParser.containsDocumentType(
      "<root><!-- <!DOCTYPE fake> --><![CDATA[<!DOCTYPE fake>]]></root>",
    ))
    assertTrue(RefloatConfigSchemaParser.containsDocumentType("<!DOCTYPE root><root/>"))
    assertTrue(RefloatConfigSchemaParser.containsDocumentType(
      "<!DOCTYPE root SYSTEM 'https://example.invalid/entity'><root/>",
    ))
  }
  @Test
  fun parsesParamsFromVescStyleXml() {
    val xml = """
      <CustomConfiguration>
        <params>
          <param name="kp" type="float" min="0" max="100" unit="" label="Angle P" />
          <param name="kp2" type="float" min="0" max="5" unit="" label="Rate P" />
          <param name="quickstop_enabled" type="bool" label="Quickstop" />
        </params>
      </CustomConfiguration>
    """.trimIndent()

    val schema = RefloatConfigSchemaParser.parse(xml.encodeToByteArray())

    assertEquals("kp", schema.fields[0].id)
    assertEquals(RefloatConfigValueType.FLOAT32, schema.fields[0].type)
    assertEquals(0.0, schema.fields[0].min)
    assertEquals(100.0, schema.fields[0].max)
    assertEquals("Angle P", schema.fields[0].label)
    assertEquals(RefloatConfigValueType.BOOL, schema.fields[2].type)
    assertTrue(schema.hash.isNotBlank())
  }

  @Test
  fun parsesConfigParamsUsingSerializedStructNames() {
    val xml = """
      <ConfigParams>
        <Params>
          <atr_strength_up>
            <type>1</type>
            <vTx>8</vTx>
            <vTxDoubleScale>1000</vTxDoubleScale>
            <cDefine>CFG_DFLT_ATR_UPHILL_STRENGTH</cDefine>
            <longName>ATR Uphill Strength</longName>
          </atr_strength_up>
          <turntilt_erpm_boost>
            <type>2</type>
            <vTx>3</vTx>
            <cDefine>CFG_DFLT_TURNTILT_ERPM_BOOST</cDefine>
            <longName>Speed Boost %</longName>
          </turntilt_erpm_boost>
        </Params>
        <SerOrder>
          <ser>atr_strength_up</ser>
          <ser>turntilt_erpm_boost</ser>
        </SerOrder>
      </ConfigParams>
    """.trimIndent()

    val schema = RefloatConfigSchemaParser.parse(xml.encodeToByteArray())

    assertEquals("atr_strength_up", schema.fields[0].id)
    assertEquals(RefloatConfigValueType.FLOAT32_SCALED, schema.fields[0].type)
    assertEquals(1000.0, schema.fields[0].scale)
    assertEquals("turntilt_erpm_boost", schema.fields[1].id)
    assertEquals(RefloatConfigValueType.UINT16, schema.fields[1].type)
  }

  @Test
  fun normalizesCompressedXmlBeforeScanningForText() {
    val xml = """<ConfigParams><Params></Params><SerOrder></SerOrder></ConfigParams>"""
    val compressed = ByteArrayOutputStream().use { output ->
      DeflaterOutputStream(output).use { it.write(xml.encodeToByteArray()) }
      output.toByteArray()
    }
    val bytes = byteArrayOf(0, '<'.code.toByte(), 0, 0) + compressed

    val normalized = RefloatConfigSchemaParser.normalizeXmlBytes(bytes)

    assertEquals(xml, normalized.toString(Charsets.UTF_8))
  }

  @Test(expected = RefloatConfigSchemaException::class)
  fun rejectsMissingFieldNames() {
    val xml = """<CustomConfiguration><params><param type="float" /></params></CustomConfiguration>"""
    RefloatConfigSchemaParser.parse(xml.encodeToByteArray())
  }

  @Test(expected = RefloatConfigSchemaException::class)
  fun wrapsMalformedXmlAsSchemaError() {
    RefloatConfigSchemaParser.parse("<CustomConfiguration><params>".encodeToByteArray())
  }

  @Test
  fun rejectsDuplicateFieldIdsWithTypedError() {
    val duplicateInParams = """
      <ConfigParams>
        <Params>
          <kp><type>1</type><vTx>7</vTx><vTxDoubleScale>10</vTxDoubleScale></kp>
          <kp><type>1</type><vTx>7</vTx><vTxDoubleScale>10</vTxDoubleScale></kp>
        </Params>
        <SerOrder><ser>kp</ser></SerOrder>
      </ConfigParams>
    """.trimIndent()
    val ex1 = assertThrows(RefloatConfigSchemaException::class.java) {
      RefloatConfigSchemaParser.parse(duplicateInParams.encodeToByteArray())
    }
    assertEquals(RefloatConfigSchemaErrorCode.DUPLICATE_FIELD_ID, ex1.code)

    val duplicateInSerOrder = """
      <ConfigParams>
        <Params>
          <kp><type>1</type><vTx>7</vTx><vTxDoubleScale>10</vTxDoubleScale></kp>
        </Params>
        <SerOrder><ser>kp</ser><ser>kp</ser></SerOrder>
      </ConfigParams>
    """.trimIndent()
    val ex2 = assertThrows(RefloatConfigSchemaException::class.java) {
      RefloatConfigSchemaParser.parse(duplicateInSerOrder.encodeToByteArray())
    }
    assertEquals(RefloatConfigSchemaErrorCode.DUPLICATE_FIELD_ID, ex2.code)

    val duplicateLegacy = """
      <CustomConfiguration><params>
        <param name="kp" type="float" />
        <param name="kp" type="float" />
      </params></CustomConfiguration>
    """.trimIndent()
    val ex3 = assertThrows(RefloatConfigSchemaException::class.java) {
      RefloatConfigSchemaParser.parse(duplicateLegacy.encodeToByteArray())
    }
    assertEquals(RefloatConfigSchemaErrorCode.DUPLICATE_FIELD_ID, ex3.code)
  }

  @Test
  fun mapsTypes456WithCorrectSignednessAndSizeAndRoundTrips() {
    val xml = """
      <ConfigParams>
        <Params>
          <mode>
            <type>4</type>
            <longName>Mode</longName>
            <valInt>2</valInt>
            <enumNames>Off</enumNames>
            <enumNames>Low</enumNames>
            <enumNames>High</enumNames>
          </mode>
          <enabled>
            <type>5</type>
            <longName>Enabled</longName>
            <valInt>1</valInt>
          </enabled>
          <flags>
            <type>6</type>
            <longName>Flags</longName>
            <valInt>200</valInt>
          </flags>
          <config_name>
            <type>3</type>
            <longName>Config Name</longName>
            <valString>RefloatConfig</valString>
          </config_name>
        </Params>
        <SerOrder>
          <ser>mode</ser>
          <ser>enabled</ser>
          <ser>flags</ser>
        </SerOrder>
        <Grouping>
          <group>
            <groupName>General</groupName>
            <subgroup>
              <subgroupName>Basics</subgroupName>
              <subgroupParams>
                <param>::sep::Controls</param>
                <param>mode</param>
                <param>enabled</param>
                <param>flags</param>
                <param>config_name</param>
              </subgroupParams>
            </subgroup>
          </group>
        </Grouping>
      </ConfigParams>
    """.trimIndent()

    val schema = RefloatConfigSchemaParser.parse(xml.encodeToByteArray())
    assertEquals(listOf("mode", "enabled", "flags"), schema.fields.map { it.id })
    assertEquals(RefloatConfigValueType.UINT8, schema.fields[0].type)
    assertEquals(listOf("Off", "Low", "High"), schema.fields[0].enumNames)
    assertEquals(2.0, schema.fields[0].defaultValue)
    assertEquals(RefloatConfigValueType.BOOL, schema.fields[1].type)
    assertEquals(true, schema.fields[1].defaultValue)
    assertEquals(RefloatConfigValueType.UINT8, schema.fields[2].type)
    assertEquals(200.0, schema.fields[2].defaultValue)
    assertEquals(listOf(0, 1, 2), schema.fields.map { it.offset })

    val raw = byteArrayOf(200.toByte(), 1, 255.toByte())
    val decoded = RefloatConfigDecoder.decodeFieldMap(schema, raw)
    assertEquals(200.0, decoded["mode"])
    assertEquals(true, decoded["enabled"])
    assertEquals(255.0, decoded["flags"])

    val encoded = RefloatConfigEncoder.encode(
      schema,
      byteArrayOf(0, 0, 0),
      mapOf("mode" to 200.0, "enabled" to true, "flags" to 255.0),
    )
    assertEquals(listOf(200.toByte(), 1.toByte(), 255.toByte()), encoded.toList())

    val items = schema.groups.single().subgroups.single().items
    assertEquals(
      listOf(
        RefloatConfigSchemaGroupItem.Separator("Controls"),
        RefloatConfigSchemaGroupItem.Field("mode"),
        RefloatConfigSchemaGroupItem.Field("enabled"),
        RefloatConfigSchemaGroupItem.Field("flags"),
      ),
      items,
    )
  }

  @Test
  fun parsesRefloat121And130FixturesWithFullMetadataAndGrouping() {
    val s121 = parseFixture("1.2.1")
    assertEquals("9b8979a36759810a7fa9c19d01534ed52ec9ed8ac4a2d3ab3aefc594ba3b93cc", s121.hash)
    assertEquals(167, s121.fields.size)
    assertEquals(272, s121.fields.maxOf { it.offset + it.type.byteSize })
    assertTrue(s121.rawXml.startsWith("<?xml"))

    val s130 = parseFixture("1.3.0")
    assertEquals("62681208dc609eb19420c89df65105f018499aa9f5741f295f00d62ea5a1bceb", s130.hash)
    assertEquals(172, s130.fields.size)
    assertEquals(278, s130.fields.maxOf { it.offset + it.type.byteSize })

    for (schema in listOf(s121, s130)) {
      val byId = schema.fields.associateBy { it.id }
      assertNull(byId["config_name"])
      assertNull(byId["hw_name"])

      val kp = requireNotNull(byId["kp"])
      assertEquals(RefloatConfigValueType.FLOAT16_SCALED, kp.type)
      assertEquals(1, kp.xmlType)
      assertEquals(7, kp.vTx)
      assertEquals(10.0, kp.scale)
      assertEquals(0.0, kp.min)
      assertEquals(40.0, kp.max)
      assertEquals(1.0, kp.step)
      assertEquals(1, kp.editorDecimals)
      assertEquals(1.0, kp.editorScale)
      assertFalse(kp.editAsPercentage)
      assertEquals(20.0, kp.defaultValue)
      assertTrue(kp.transmittable)
      assertFalse(kp.showDisplay)
      assertEquals("Angle P", kp.label)
      assertEquals("CFG_DFLT_KP", kp.cDefine)
      assertTrue(requireNotNull(kp.description).startsWith("Angle P (Proportional)"))
      assertFalse(kp.description!!.contains("<html"))
      assertFalse(kp.description!!.contains("&gt;"))

      val duty = requireNotNull(byId["tiltback_duty"])
      assertTrue(duty.editAsPercentage)
      assertEquals(2, duty.editorDecimals)
      assertEquals(0.01, duty.step)
      assertEquals(0.8, duty.defaultValue)

      val remoteType = requireNotNull(byId["inputtilt_remote_type"])
      assertEquals(RefloatConfigValueType.UINT8, remoteType.type)
      assertEquals(4, remoteType.xmlType)
      assertNull(remoteType.vTx)
      assertEquals(listOf("None", "UART", "PPM"), remoteType.enumNames)
      assertEquals(0.0, remoteType.defaultValue)

      val ledsOn = requireNotNull(byId["leds.on"])
      assertEquals(RefloatConfigValueType.BOOL, ledsOn.type)
      assertEquals(5, ledsOn.xmlType)
      assertEquals(true, ledsOn.defaultValue)

      val halfErpm = requireNotNull(byId["fault_adc_half_erpm"])
      assertEquals(RefloatConfigValueType.UINT16, halfErpm.type)
      assertEquals("ERPM", halfErpm.unit)
      assertEquals(50.0, halfErpm.step)
      assertEquals(200.0, halfErpm.defaultValue)

      assertEquals(listOf("General", "Internal"), schema.groups.map { it.name })
      assertEquals(
        listOf(
          "Tune", "Tune Modifiers", "ATR", "Startup", "Stop",
          "Pushback Alerts", "Haptic Feedback", "Remote", "LEDs", "Specs", "BMS",
        ),
        schema.groups[0].subgroups.map { it.name },
      )
      assertEquals(listOf("Meta"), schema.groups[1].subgroups.map { it.name })
      val tuneItems = schema.groups[0].subgroups[0].items
      assertEquals(RefloatConfigSchemaGroupItem.Separator("PID"), tuneItems[0])
      assertEquals(RefloatConfigSchemaGroupItem.Field("kp"), tuneItems[1])
      assertNotNull(schema.toBridgeMap()["fields"])
    }
  }
}
