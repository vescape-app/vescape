package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Test

// @parity /modules/vescape-core/ios/config/RefloatConfigDecoderTests.swift
class RefloatConfigDecoderTest {
  @Test
  fun decodesBoardConfigValuesWithSchemaAndWriteBase() {
    val schema = RefloatConfigSchema(
      hash = "schema-hash",
      fields = listOf(
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "Angle P", null, 0.0, 100.0, 0),
        RefloatConfigSchemaField("kp2", RefloatConfigValueType.FLOAT32, "Rate P", null, 0.0, 5.0, 4),
        RefloatConfigSchemaField("unused", RefloatConfigValueType.INT32, "Unused", null, null, null, 8),
      ),
    )
    val bytes = ByteBuffer.allocate(12)
      .order(ByteOrder.BIG_ENDIAN)
      .putFloat(26.0f)
      .putFloat(0.9f)
      .putInt(123)
      .array()

    val values = RefloatConfigDecoder.decodeBoardConfigValues(
      schema = schema,
      configBytes = RefloatConfigBytes(confInd = 0, packageSignature = 0x1234L, config = bytes),
      boardId = "board-1",
      refloatBaseVersion = "1.3",
      capturedAt = 100L,
    )

    assertEquals("schema-hash", values.schemaHash)
    assertEquals(12, values.writeBase?.rawConfig?.size)
    assertEquals(26.0, values.values["kp"] as Double, 0.001)
    assertEquals(0.9, values.values["kp2"] as Double, 0.001)
    assertEquals(123.0, values.values["unused"] as Double, 0.001)
  }

  @Test(expected = RefloatConfigDecodeException::class)
  fun rejectsTruncatedConfig() {
    val schema = RefloatConfigSchema(
      hash = "schema-hash",
      fields = listOf(
        RefloatConfigSchemaField("kp", RefloatConfigValueType.FLOAT32, "Angle P", null, 0.0, 100.0, 0),
      ),
    )

    RefloatConfigDecoder.decodeBoardConfigValues(
      schema = schema,
      configBytes = RefloatConfigBytes(confInd = 0, packageSignature = 0L, config = byteArrayOf(1, 2)),
      boardId = null,
      refloatBaseVersion = null,
      capturedAt = 100L,
    )
  }
}
