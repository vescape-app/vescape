package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Board Config Values contract (#393): the decoded map spans the whole schema in real types, a field
 * the bytes cannot supply is absent rather than guessed, and a cached object comes back lastKnown
 * with its bools intact.
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigValuesTests.swift
 */
class BoardConfigValuesTest {
  private fun field(
    id: String,
    type: RefloatConfigValueType,
    offset: Int,
    scale: Double? = null,
  ) = RefloatConfigSchemaField(
    id = id,
    type = type,
    label = id,
    unit = null,
    min = null,
    max = null,
    offset = offset,
    scale = scale,
  )

  private fun schema(vararg fields: RefloatConfigSchemaField) =
    RefloatConfigSchema(hash = "hash", fields = fields.toList())

  @Test
  fun decodesEveryFieldKeepingBoolsBool() {
    val schema = schema(
      field("kp", RefloatConfigValueType.FLOAT32, offset = 0),
      field("fault_moving_fault_disabled", RefloatConfigValueType.BOOL, offset = 4),
      field("tiltback_duty", RefloatConfigValueType.UINT8, offset = 5),
    )
    val kp = java.lang.Float.floatToIntBits(4.5f)
    val bytes = byteArrayOf(
      (kp ushr 24).toByte(),
      (kp ushr 16).toByte(),
      (kp ushr 8).toByte(),
      kp.toByte(),
      1,
      85,
    )

    val values = RefloatConfigDecoder.decodeFieldMap(schema, bytes)

    assertEquals(4.5, values["kp"] as Double, 1e-9)
    // A bool field stays a Boolean — the whole-schema map never coerces to 1.0 / 0.0.
    assertEquals(true, values["fault_moving_fault_disabled"])
    assertEquals(85.0, values["tiltback_duty"] as Double, 1e-9)
  }

  @Test
  fun truncatedAndUnparseableFieldsAreMissingNotValues() {
    val schema = schema(
      field("present", RefloatConfigValueType.UINT8, offset = 0),
      // Past the end of the raw config: the `offset + byteSize` precondition drops it.
      field("truncated", RefloatConfigValueType.FLOAT32, offset = 1),
      // A scaled field with no scale cannot decode; one bad field must not take the map down.
      field("unparseable", RefloatConfigValueType.FLOAT32_SCALED, offset = 0),
    )

    val values = RefloatConfigDecoder.decodeFieldMap(schema, byteArrayOf(7))

    assertEquals(7.0, values["present"] as Double, 1e-9)
    assertNull(values["truncated"])
    assertNull(values["unparseable"])
  }

  @Test
  fun nonFiniteDecodeIsMissingNotAValue() {
    val schema = schema(field("nan", RefloatConfigValueType.FLOAT32, offset = 0))

    val values = RefloatConfigDecoder.decodeFieldMap(
      schema,
      byteArrayOf(0x7f, 0xc0.toByte(), 0, 0),
    )

    // NaN counts as missing: a rule skips an absent field, but would read a NaN as a clean evaluation.
    assertNull(values["nan"])
  }

  @Test
  fun freshValuesRetainWriteBase() {
    val schema = schema(field("kp", RefloatConfigValueType.FLOAT32, offset = 0))

    val values = RefloatConfigDecoder.decodeBoardConfigValues(
      schema = schema,
      configBytes = RefloatConfigBytes(confInd = 0, packageSignature = 0xdeadbeefL, config = ByteArray(4)),
      boardId = "board-1",
      refloatBaseVersion = "3.0",
      capturedAt = 42,
    )

    assertEquals(BoardConfigFreshness.FRESH, values.freshness)
    assertEquals(0xdeadbeefL, values.writeBase!!.packageSignature)
    assertEquals(4, values.writeBase!!.rawConfig.size)
    assertEquals("hash", values.writeBase!!.schema.hash)
  }

  @Test
  fun lastKnownRoundTripKeepsTypesAndHasNoWriteBase() {
    val fresh = BoardConfigValues(
      boardId = "board-1",
      refloatBaseVersion = "3.0",
      capturedAtMs = 7,
      freshness = BoardConfigFreshness.FRESH,
      values = mapOf("tiltback_duty" to 0.8, "fault_moving_fault_disabled" to true),
      writeBase = null,
    )

    val restored = BoardConfigValues.lastKnown(
      boardId = "board-1",
      refloatBaseVersion = "3.0",
      capturedAtMs = 7,
      valuesJson = fresh.valuesJson(),
    )

    assertEquals(BoardConfigFreshness.LAST_KNOWN, restored.freshness)
    assertNull(restored.writeBase)
    assertEquals(0.8, restored.number("tiltback_duty")!!, 1e-9)
    // A cached bool must not come back as 1.0.
    assertTrue(restored.bool("fault_moving_fault_disabled")!!)
    assertNull(restored.number("fault_moving_fault_disabled"))
  }

  /**
   * The bridge map is the whole JS contract: decoded fields and freshness, never the write base.
   * @parity /modules/vescape-core/ios/config/BoardConfigValuesTests.swift `testBridgeMapCarriesValuesAndFreshnessButNoWriteBase`
   */
  @Test
  fun bridgeMapCarriesValuesAndFreshnessButNoWriteBase() {
    val values = BoardConfigValues(
      boardId = "board-1",
      refloatBaseVersion = "3.0",
      capturedAtMs = 7,
      freshness = BoardConfigFreshness.FRESH,
      values = mapOf("fault_adc1" to 0.8, "fault_moving_fault_disabled" to true),
      writeBase = BoardConfigWriteBase(
        schema = schema(field("kp", RefloatConfigValueType.FLOAT32, offset = 0)),
        rawConfig = byteArrayOf(1, 2, 3, 4),
        packageSignature = 0xdeadbeefL,
      ),
    )

    val map = values.toBridgeMap()

    assertEquals("board-1", map["boardId"])
    assertEquals("3.0", map["refloatBaseVersion"])
    assertEquals(7L, map["capturedAtMs"])
    assertEquals("fresh", map["freshness"])
    @Suppress("UNCHECKED_CAST")
    val decoded = map["values"] as Map<String, Any>
    assertEquals(0.8, decoded["fault_adc1"] as Double, 1e-9)
    assertEquals(true, decoded["fault_moving_fault_disabled"])
    // Raw bytes and package signature stay native — JS never gets a write base.
    assertNull(map["writeBase"])
    assertNull(map["rawConfig"])
  }
}
