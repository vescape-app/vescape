package expo.modules.vescapecore.config

import expo.modules.vescapecore.protocol.VescNumeric
import java.nio.ByteBuffer
import java.nio.ByteOrder

// @parity /modules/vescape-core/ios/config/RefloatConfigDecoder.swift
internal class RefloatConfigDecodeException(message: String) : Exception(message)

internal object RefloatConfigDecoder {
  fun decodeFieldMap(schema: RefloatConfigSchema, rawConfig: ByteArray): Map<String, Any> {
    val values = mutableMapOf<String, Any>()
    for (field in schema.fields) {
      if (rawConfig.size < field.offset + field.type.byteSize) continue
      val value = try {
        readValue(rawConfig, field)
      } catch (_: Exception) {
        continue
      }
      when (value) {
        is Double -> if (value.isFinite()) values[field.id] = value
        else -> values[field.id] = value
      }
    }
    return values
  }

  fun decodeBoardConfigValues(
    schema: RefloatConfigSchema,
    configBytes: RefloatConfigBytes,
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAt: Long,
  ): BoardConfigValues {
    val requiredLength = schema.fields.maxOfOrNull { it.offset + it.type.byteSize } ?: 0
    if (configBytes.config.size < requiredLength) {
      throw RefloatConfigDecodeException(
        "CONFIG_DECODE_FAILED: config length ${configBytes.config.size} < $requiredLength",
      )
    }
    return BoardConfigValues(
      boardId = boardId,
      refloatBaseVersion = refloatBaseVersion,
      capturedAtMs = capturedAt,
      freshness = BoardConfigFreshness.FRESH,
      values = decodeFieldMap(schema, configBytes.config),
      writeBase = BoardConfigWriteBase(
        schema = schema,
        rawConfig = configBytes.config,
        packageSignature = configBytes.packageSignature,
      ),
    )
  }

  private fun readValue(bytes: ByteArray, field: RefloatConfigSchemaField): Any {
    val view = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    view.position(field.offset)
    return when (field.type) {
      RefloatConfigValueType.FLOAT32 -> view.float.toDouble()
      RefloatConfigValueType.FLOAT32_SCALED -> view.int / requireScale(field)
      RefloatConfigValueType.FLOAT32_AUTO -> VescNumeric.float32Auto(bytes, field.offset)
      RefloatConfigValueType.FLOAT16_SCALED -> view.short / requireScale(field)
      RefloatConfigValueType.INT32 -> view.int.toDouble()
      RefloatConfigValueType.UINT32 -> (view.int.toLong() and 0xffffffffL).toDouble()
      RefloatConfigValueType.INT16 -> view.short.toDouble()
      RefloatConfigValueType.UINT16 -> (view.short.toInt() and 0xffff).toDouble()
      RefloatConfigValueType.INT8 -> view.get().toDouble()
      RefloatConfigValueType.UINT8 -> (view.get().toInt() and 0xff).toDouble()
      RefloatConfigValueType.BOOL -> view.get().toInt() != 0
    }
  }

  private fun requireScale(field: RefloatConfigSchemaField): Double {
    return field.scale ?: throw RefloatConfigDecodeException("CONFIG_DECODE_FAILED: missing scale for ${field.id}")
  }
}
