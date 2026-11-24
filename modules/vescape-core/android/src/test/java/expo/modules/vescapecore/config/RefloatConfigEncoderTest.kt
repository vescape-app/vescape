package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RefloatConfigEncoderTest {

  private fun allTypeSchema(): RefloatConfigSchema {
    var offset = 0
    fun field(id: String, type: RefloatConfigValueType, scale: Double? = null): RefloatConfigSchemaField {
      val f = RefloatConfigSchemaField(id, type, id, null, null, null, offset, scale)
      offset += type.byteSize
      return f
    }
    return RefloatConfigSchema(
      hash = "test",
      fields = listOf(
        field("f32", RefloatConfigValueType.FLOAT32),
        field("f32_scaled", RefloatConfigValueType.FLOAT32_SCALED, 1000.0),
        field("f32_auto", RefloatConfigValueType.FLOAT32_AUTO),
        field("f16_scaled", RefloatConfigValueType.FLOAT16_SCALED, 100.0),
        field("i32", RefloatConfigValueType.INT32),
        field("u32", RefloatConfigValueType.UINT32),
        field("i16", RefloatConfigValueType.INT16),
        field("u16", RefloatConfigValueType.UINT16),
        field("i8", RefloatConfigValueType.INT8),
        field("u8", RefloatConfigValueType.UINT8),
        field("bool_true", RefloatConfigValueType.BOOL),
        field("bool_false", RefloatConfigValueType.BOOL),
      ),
    )
  }

  private fun buildRawConfig(schema: RefloatConfigSchema): ByteArray {
    val totalSize = schema.fields.maxOf { it.offset + it.type.byteSize }
    val buf = ByteBuffer.allocate(totalSize).order(ByteOrder.BIG_ENDIAN)
    buf.putFloat(26.5f)
    buf.putInt(1500)
    buf.putInt(0x40400000)
    buf.putShort(325)
    buf.putInt(-42)
    buf.putInt(0x80000001.toInt())
    buf.putShort(-100)
    buf.putShort(60000.toInt().toShort())
    buf.put((-5).toByte())
    buf.put(200.toByte())
    buf.put(1.toByte())
    buf.put(0.toByte())
    return buf.array()
  }

  @Test
  fun roundTripPreservesAllBytes() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val decoded = decodeAllFields(schema, raw)
    val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
    assertArrayEquals("Round-trip must produce identical bytes", raw, reEncoded)
  }

  @Test
  fun modifyingSingleFieldChangesOnlyTargetBytes() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val modified = RefloatConfigEncoder.encode(schema, raw, mapOf("f32" to 99.0))

    val f32Field = schema.fields.first { it.id == "f32" }
    for (i in raw.indices) {
      if (i >= f32Field.offset && i < f32Field.offset + f32Field.type.byteSize) continue
      assertEquals("Byte at offset $i should be unchanged", raw[i], modified[i])
    }

    val newVal = ByteBuffer.wrap(modified, 0, 4).order(ByteOrder.BIG_ENDIAN).float
    assertEquals(99.0f, newVal, 0.001f)
  }

  @Test
  fun outputLengthMatchesInput() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val result = RefloatConfigEncoder.encode(schema, raw, mapOf("f32" to 1.0))
    assertEquals(raw.size, result.size)
  }

  @Test
  fun missingFieldsInMapArePreserved() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val result = RefloatConfigEncoder.encode(schema, raw, emptyMap())
    assertArrayEquals("Empty field map = no changes", raw, result)
  }

  @Test
  fun unknownFieldRejectsWholeWrite() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    assertInvalid(schema, raw, mapOf("u8" to 7.0, "nonexistent_field" to 42.0))
  }

  @Test
  fun valuesOutsideWireRangeAreRejected() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val outOfRange = listOf(
      "f16_scaled" to 327.68,
      "f16_scaled" to -327.69,
      "f32_scaled" to 2147483.648,
      "i32" to 2147483648.0,
      "u32" to -1.0,
      "u32" to 4294967296.0,
      "i16" to -32769.0,
      "u16" to 65536.0,
      "i8" to 128.0,
      "u8" to 256.0,
      "u8" to -1.0,
      "f32" to 1e39,
      "f32_auto" to -1e39,
    )
    for ((fieldId, value) in outOfRange) {
      assertInvalid(schema, raw, mapOf(fieldId to value))
    }
    val edges = RefloatConfigEncoder.encode(
      schema,
      raw,
      mapOf("f16_scaled" to -327.68, "u8" to 255.0, "u32" to 4294967295.0, "i8" to -128.0),
    )
    val decoded = RefloatConfigDecoder.decodeFieldMap(schema, edges)
    assertEquals(-327.68, decoded["f16_scaled"] as Double, 1e-9)
    assertEquals(255.0, decoded["u8"])
    assertEquals(4294967295.0, decoded["u32"])
    assertEquals(-128.0, decoded["i8"])
  }

  @Test
  fun nonFiniteValuesAreRejected() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    for (fieldId in listOf("f32", "f32_auto", "f32_scaled", "f16_scaled", "u8")) {
      for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
        assertInvalid(schema, raw, mapOf(fieldId to value))
      }
    }
  }

  @Test
  fun wrongValueTypesAreRejected() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    assertInvalid(schema, raw, mapOf("u8" to true))
    assertInvalid(schema, raw, mapOf("f32" to "1.0"))
    assertInvalid(schema, raw, mapOf("bool_true" to 2.0))
    assertInvalid(schema, raw, mapOf("bool_true" to "yes"))
  }

  @Test
  fun boolAcceptsBooleansAndZeroOrOne() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val encoded = RefloatConfigEncoder.encode(
      schema,
      raw,
      mapOf("bool_true" to false, "bool_false" to 1),
    )
    val decoded = RefloatConfigDecoder.decodeFieldMap(schema, encoded)
    assertEquals(false, decoded["bool_true"])
    assertEquals(true, decoded["bool_false"])
  }

  @Test
  fun integersRoundHalfUp() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val encoded = RefloatConfigEncoder.encode(schema, raw, mapOf("u8" to 7.5, "i16" to -2.5))
    val decoded = RefloatConfigDecoder.decodeFieldMap(schema, encoded)
    assertEquals(8.0, decoded["u8"])
    assertEquals(-2.0, decoded["i16"])
  }

  @Test
  fun float32RoundTrip() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT32, "v", null, null, null, 0),
    ))
    for (value in listOf(0.0, 1.0, -1.0, 3.14, -999.99, Float.MAX_VALUE.toDouble())) {
      val raw = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putFloat(value.toFloat()).array()
      val decoded = decodeAllFields(schema, raw)
      val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
      assertArrayEquals("FLOAT32 round-trip for $value", raw, reEncoded)
    }
  }

  @Test
  fun float32ScaledRoundTrip() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT32_SCALED, "v", null, null, null, 0, 1000.0),
    ))
    for (rawInt in listOf(0, 1, -1, 1500, -2500, Int.MAX_VALUE, Int.MIN_VALUE)) {
      val raw = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(rawInt).array()
      val decoded = decodeAllFields(schema, raw)
      val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
      assertArrayEquals("FLOAT32_SCALED round-trip for raw=$rawInt", raw, reEncoded)
    }
  }

  @Test
  fun float32AutoRoundTrip() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT32_AUTO, "v", null, null, null, 0),
    ))
    for (value in listOf(0.0f, 1.0f, -1.0f, 0.5f, 3.0f, 100.0f, -500.0f, 12345.678f, 0.001f)) {
      val raw = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putFloat(value).array()
      val decoded = decodeAllFields(schema, raw)
      val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
      assertArrayEquals("FLOAT32_AUTO round-trip for $value", raw, reEncoded)
    }
  }

  @Test
  fun float32AutoMatchesVescByteVectors() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT32_AUTO, "v", null, null, null, 0),
    ))
    val vectors = listOf(
      0.0 to 0x00000000,
      0.5 to 0x3F000000,
      1.0 to 0x3F800000,
      3.0 to 0x40400000,
      30.0 to 0x41F00000,
      100.0 to 0x42C80000,
      -2.5 to 0xC0200000.toInt(),
    )
    for ((value, expected) in vectors) {
      val encoded = RefloatConfigEncoder.encode(schema, ByteArray(4), mapOf("v" to value))
      assertEquals("FLOAT32_AUTO bytes for $value", expected, ByteBuffer.wrap(encoded).order(ByteOrder.BIG_ENDIAN).int)
    }
  }

  @Test
  fun float16ScaledRoundTrip() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT16_SCALED, "v", null, null, null, 0, 100.0),
    ))
    for (rawShort in listOf(0, 1, -1, 325, -500, Short.MAX_VALUE.toInt(), Short.MIN_VALUE.toInt())) {
      val raw = ByteBuffer.allocate(2).order(ByteOrder.BIG_ENDIAN).putShort(rawShort.toShort()).array()
      val decoded = decodeAllFields(schema, raw)
      val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
      assertArrayEquals("FLOAT16_SCALED round-trip for raw=$rawShort", raw, reEncoded)
    }
  }

  @Test
  fun integerTypesRoundTrip() {
    data class Case(val type: RefloatConfigValueType, val rawBytes: ByteArray)

    val cases = listOf(
      Case(RefloatConfigValueType.INT32, ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(-42).array()),
      Case(RefloatConfigValueType.UINT32, ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(0x80000001.toInt()).array()),
      Case(RefloatConfigValueType.INT16, ByteBuffer.allocate(2).order(ByteOrder.BIG_ENDIAN).putShort(-100).array()),
      Case(RefloatConfigValueType.UINT16, ByteBuffer.allocate(2).order(ByteOrder.BIG_ENDIAN).putShort(60000.toInt().toShort()).array()),
      Case(RefloatConfigValueType.INT8, byteArrayOf((-5).toByte())),
      Case(RefloatConfigValueType.UINT8, byteArrayOf(200.toByte())),
    )
    for (case in cases) {
      val schema = RefloatConfigSchema("t", listOf(
        RefloatConfigSchemaField("v", case.type, "v", null, null, null, 0),
      ))
      val decoded = decodeAllFields(schema, case.rawBytes)
      val reEncoded = RefloatConfigEncoder.encode(schema, case.rawBytes, decoded)
      assertArrayEquals("${case.type} round-trip", case.rawBytes, reEncoded)
    }
  }

  @Test
  fun boolRoundTrip() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.BOOL, "v", null, null, null, 0),
    ))
    for (rawByte in listOf(0, 1, 255)) {
      val raw = byteArrayOf(rawByte.toByte())
      val decoded = decodeAllFields(schema, raw)
      val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
      if (rawByte == 0) {
        assertEquals("BOOL false round-trip", 0.toByte(), reEncoded[0])
      } else {
        assertTrue("BOOL true round-trip", reEncoded[0].toInt() != 0)
      }
    }
  }

  @Test
  fun largeConfigBlobPreservesUnknownBytes() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT32, "v", null, null, null, 10),
    ))
    val raw = ByteArray(256) { (it % 256).toByte() }
    ByteBuffer.wrap(raw, 10, 4).order(ByteOrder.BIG_ENDIAN).putFloat(3.14f)

    val decoded = decodeAllFields(schema, raw)
    val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)

    for (i in raw.indices) {
      assertEquals("Byte $i must match", raw[i], reEncoded[i])
    }
  }

  @Test
  fun multiFieldModificationOnlyAffectsTargetOffsets() {
    val schema = allTypeSchema()
    val raw = ByteArray(64) { (it * 7 % 256).toByte() }
    val validRaw = buildRawConfig(schema)
    validRaw.copyInto(raw, 0, 0, validRaw.size.coerceAtMost(raw.size))

    val modifications = mapOf("f32" to 1.0, "i16" to -50.0, "u8" to 128.0)
    val result = RefloatConfigEncoder.encode(schema, raw, modifications)

    val modifiedOffsets = mutableSetOf<Int>()
    for (fieldId in modifications.keys) {
      val field = schema.fields.first { it.id == fieldId }
      for (i in field.offset until field.offset + field.type.byteSize) modifiedOffsets.add(i)
    }

    for (i in raw.indices) {
      if (i !in modifiedOffsets) {
        assertEquals("Untouched byte at offset $i", raw[i], result[i])
      }
    }
  }

  @Test
  fun float32AutoIndependentByteVectors() {
    val schema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT32_AUTO, "v", null, null, null, 0),
    ))
    val vectors = listOf(
      0.0 to byteArrayOf(0x00, 0x00, 0x00, 0x00),
      1e-40 to byteArrayOf(0x00, 0x00, 0x00, 0x00),
      0.25 to byteArrayOf(0x3E, 0x80.toByte(), 0x00, 0x00),
      0.5 to byteArrayOf(0x3F, 0x00, 0x00, 0x00),
      1.0 to byteArrayOf(0x3F, 0x80.toByte(), 0x00, 0x00),
      -1.0 to byteArrayOf(0xBF.toByte(), 0x80.toByte(), 0x00, 0x00),
      3.0 to byteArrayOf(0x40, 0x40, 0x00, 0x00),
      -2.5 to byteArrayOf(0xC0.toByte(), 0x20, 0x00, 0x00),
      30.0 to byteArrayOf(0x41, 0xF0.toByte(), 0x00, 0x00),
      100.0 to byteArrayOf(0x42, 0xC8.toByte(), 0x00, 0x00),
    )
    for ((value, expected) in vectors) {
      val encoded = RefloatConfigEncoder.encode(schema, ByteArray(4), mapOf("v" to value))
      assertArrayEquals("FLOAT32_AUTO vector for $value", expected, encoded)
    }
  }

  @Test
  fun float16ScaledIndependentEdgeByteVectors() {
    val scale100 = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("v", RefloatConfigValueType.FLOAT16_SCALED, "v", null, null, null, 0, 100.0),
    ))
    val scale100Vectors = listOf(
      0.0 to byteArrayOf(0x00, 0x00),
      1.23 to byteArrayOf(0x00, 0x7B),
      -0.01 to byteArrayOf(0xFF.toByte(), 0xFF.toByte()),
      327.67 to byteArrayOf(0x7F, 0xFF.toByte()),
      -327.68 to byteArrayOf(0x80.toByte(), 0x00),
    )
    for ((value, expected) in scale100Vectors) {
      assertArrayEquals(
        "FLOAT16_SCALED(100) vector for $value",
        expected,
        RefloatConfigEncoder.encode(scale100, ByteArray(2), mapOf("v" to value)),
      )
    }

    val kiSchema = RefloatConfigSchema("t", listOf(
      RefloatConfigSchemaField("ki", RefloatConfigValueType.FLOAT16_SCALED, "ki", null, 0.0, 0.5, 0, 100_000.0),
    ))
    val kiVectors = listOf(
      0.0 to byteArrayOf(0x00, 0x00),
      0.001 to byteArrayOf(0x00, 0x64),
      0.32767 to byteArrayOf(0x7F, 0xFF.toByte()),
    )
    for ((value, expected) in kiVectors) {
      assertArrayEquals(
        "FLOAT16_SCALED(100000) vector for $value",
        expected,
        RefloatConfigEncoder.encode(kiSchema, ByteArray(2), mapOf("ki" to value)),
      )
    }
  }

  @Test
  fun effectiveRangeRejectsSchemaAndWireOverflows() {
    val schema = RefloatConfigSchema(
      hash = "refloat-edges",
      fields = listOf(
        RefloatConfigSchemaField("ki", RefloatConfigValueType.FLOAT16_SCALED, "Angle I", null, 0.0, 0.5, 0, 100_000.0),
        RefloatConfigSchemaField("turntilt_start_erpm", RefloatConfigValueType.UINT16, "ERPM Threshold", null, 100.0, 100_000.0, 2),
        RefloatConfigSchemaField("turntilt_yaw_aggregate", RefloatConfigValueType.UINT8, "Turn Aggregate Target", null, 50.0, 360.0, 4),
        RefloatConfigSchemaField(
          id = "inputtilt_remote_type",
          type = RefloatConfigValueType.UINT8,
          label = "Remote Type",
          unit = null,
          min = null,
          max = null,
          offset = 5,
          xmlType = 4,
          enumNames = listOf("None", "UART", "PPM"),
        ),
      ),
    )
    val raw = ByteArray(6)

    assertInvalid(schema, raw, mapOf("ki" to 0.35))
    assertInvalid(schema, raw, mapOf("ki" to -0.001))
    assertInvalid(schema, raw, mapOf("turntilt_start_erpm" to 100_000.0))
    assertInvalid(schema, raw, mapOf("turntilt_start_erpm" to 99.0))
    assertInvalid(schema, raw, mapOf("turntilt_yaw_aggregate" to 360.0))
    assertInvalid(schema, raw, mapOf("turntilt_yaw_aggregate" to 49.0))
    assertInvalid(schema, raw, mapOf("inputtilt_remote_type" to -1.0))
    assertInvalid(schema, raw, mapOf("inputtilt_remote_type" to 3.0))
    assertInvalid(schema, raw, mapOf("inputtilt_remote_type" to 1.5))
    assertInvalid(schema, raw, mapOf("ki" to null))

    val valid = RefloatConfigEncoder.encodeChangeset(
      schema,
      raw,
      mapOf(
        "ki" to 0.32767,
        "turntilt_start_erpm" to 65_535.0,
        "turntilt_yaw_aggregate" to 255.0,
        "inputtilt_remote_type" to 2.0,
      ),
    )
    assertEquals(setOf("ki", "turntilt_start_erpm", "turntilt_yaw_aggregate", "inputtilt_remote_type"), valid.changedFieldIds)
  }

  @Test
  fun encodeChangesetDropsWirePrecisionNoOps() {
    val schema = RefloatConfigSchema(
      hash = "noop",
      fields = listOf(
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT16_SCALED, "kp", null, 0.0, 50.0, 0, 10.0),
        RefloatConfigSchemaField("ki", RefloatConfigValueType.FLOAT16_SCALED, "ki", null, 0.0, 0.5, 2, 100_000.0),
      ),
    )
    val raw = byteArrayOf(0x00, 0xC8.toByte(), 0x00, 0x64)

    val noOp = RefloatConfigEncoder.encodeChangeset(schema, raw, mapOf("kp" to 20.04, "ki" to 0.001))
    assertTrue(noOp.changedFieldIds.isEmpty())
    assertArrayEquals(raw, noOp.rawConfig)

    val partial = RefloatConfigEncoder.encodeChangeset(schema, raw, mapOf("kp" to 20.0, "ki" to 0.002))
    assertEquals(setOf("ki"), partial.changedFieldIds)
    assertArrayEquals(raw.copyOfRange(0, 2), partial.rawConfig.copyOfRange(0, 2))
    assertArrayEquals(byteArrayOf(0x00, 0xC8.toByte()), partial.rawConfig.copyOfRange(2, 4))
  }

  private fun assertInvalid(schema: RefloatConfigSchema, raw: ByteArray, fields: Map<String, Any?>) {
    try {
      RefloatConfigEncoder.encode(schema, raw, fields)
      fail("Expected CONFIG_VALUE_INVALID for $fields")
    } catch (e: RefloatConfigEncodeException) {
      assertEquals(RefloatConfigErrorCode.CONFIG_VALUE_INVALID, e.code)
    }
  }

  private fun decodeAllFields(schema: RefloatConfigSchema, raw: ByteArray): Map<String, Any> {
    val fields = RefloatConfigDecoder.decodeFieldMap(schema, raw)
    assertEquals("Every schema field must decode", schema.fields.map { it.id }.toSet(), fields.keys)
    return fields
  }
}
