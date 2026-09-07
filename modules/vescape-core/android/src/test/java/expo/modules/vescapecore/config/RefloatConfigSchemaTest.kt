package expo.modules.vescapecore.config

import java.io.ByteArrayOutputStream
import java.util.zip.DeflaterOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RefloatConfigSchemaTest {
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
}
