package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class RefloatConfigEncoderTest {
  @Test
  fun draftHalfStepRoundsUpWithTheSchemaMultiplier() {
    val schema = RefloatConfigSchema("scaled", listOf(RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT16_SCALED, "kp", null, 0.0, 40.0, 0, 10.0)))
    val result = RefloatConfigEncoder.encode(schema, byteArrayOf(0, 0, 77, 88), mapOf("kp" to 15.45), strict = true)
    assertEquals(155.toShort(), ByteBuffer.wrap(result).short)
    assertArrayEquals(byteArrayOf(77, 88), result.copyOfRange(2, 4))
  }

  @Test
  fun draftEncodingRejectsMissingNonFiniteAndOutOfBoundsFields() {
    val schema = RefloatConfigSchema("draft", listOf(RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "kp", null, 0.0, 50.0, 0)))
    for (fields in listOf(mapOf("missing" to 1.0), mapOf("kp2" to 1.0), mapOf("kp" to true), mapOf("kp" to Double.NaN), mapOf("kp" to Double.POSITIVE_INFINITY), mapOf("kp" to 51.0))) {
      try {
        RefloatConfigEncoder.encode(schema, ByteArray(8), fields, strict = true)
        org.junit.Assert.fail("invalid draft accepted: $fields")
      } catch (_: RefloatConfigEncodeException) { }
    }
    val raw = byteArrayOf(0, 0, 0, 0, 1, 2, 3, 4)
    val result = RefloatConfigEncoder.encode(schema, raw, mapOf("kp" to 22.5), strict = true)
    assertArrayEquals(raw.copyOfRange(4, 8), result.copyOfRange(4, 8))
    assertEquals(22.5f, ByteBuffer.wrap(result).float)
  }


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
    buf.putFloat(26.5f)           // f32
    buf.putInt(1500)              // f32_scaled: 1500/1000 = 1.5
    buf.putInt(0)                 // f32_auto: placeholder, write via auto
    buf.putShort(325)             // f16_scaled: 325/100 = 3.25
    buf.putInt(-42)               // i32
    buf.putInt(0x80000001.toInt()) // u32 = 2147483649
    buf.putShort(-100)            // i16
    buf.putShort(60000.toInt().toShort()) // u16
    buf.put((-5).toByte())        // i8
    buf.put(200.toByte())         // u8
    buf.put(1.toByte())           // bool_true
    buf.put(0.toByte())           // bool_false
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
  fun unknownFieldsInMapAreSkipped() {
    val schema = allTypeSchema()
    val raw = buildRawConfig(schema)
    val result = RefloatConfigEncoder.encode(schema, raw, mapOf("nonexistent_field" to 42.0))
    assertArrayEquals("Unknown fields should not change anything", raw, result)
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
    for (value in listOf(0.0, 1.0, -1.0, 0.5, 100.0, -500.0, 12345.678, 0.001)) {
      val raw = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).array()
      writeFloat32AutoHelper(raw, 0, value)
      val decoded = decodeAllFields(schema, raw)
      val reEncoded = RefloatConfigEncoder.encode(schema, raw, decoded)
      assertArrayEquals("FLOAT32_AUTO round-trip for $value", raw, reEncoded)
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
    // Write valid values at field offsets so decode works
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

  private fun decodeAllFields(schema: RefloatConfigSchema, raw: ByteArray): Map<String, Any> {
    val snapshot = RefloatConfigDecoder.decode(schema, raw, null, 0, 0L, null)
    val fields = mutableMapOf<String, Any>()
    for (group in snapshot.groups) {
      for (field in group.fields) {
        fields[field.id] = field.value
      }
    }
    return fields
  }

  private fun writeFloat32AutoHelper(bytes: ByteArray, offset: Int, value: Double) {
    if (value == 0.0) {
      ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).putInt(0)
      return
    }
    val neg = value < 0.0
    val absVal = abs(value)
    val e = kotlin.math.floor(kotlin.math.ln(absVal) / kotlin.math.ln(2.0)).toInt() + 126
    val eRaw = e.coerceIn(0, 255)
    val sig = absVal / Math.pow(2.0, (eRaw - 126).toDouble()) - 0.5
    val sigI = (sig * 8388608.0 * 2.0).toInt().coerceIn(0, 0x7fffff)
    var raw = (eRaw shl 23) or sigI
    if (neg) raw = raw or (1 shl 31)
    ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).putInt(raw)
  }
}
