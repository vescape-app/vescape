package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.roundToInt

internal class RefloatConfigEncodeException(message: String) : Exception(message)

// @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift
internal object RefloatConfigEncoder {
  fun encode(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
    fields: Map<String, Any>,
  ): ByteArray {
    val result = rawConfig.copyOf()
    val byId = schema.fields.associateBy { it.id }
    for ((fieldId, value) in fields) {
      val schemaField = byId[fieldId] ?: continue
      writeValue(result, schemaField, value)
    }
    return result
  }

  private fun writeValue(bytes: ByteArray, field: RefloatConfigSchemaField, value: Any) {
    val view = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    view.position(field.offset)
    when (field.type) {
      RefloatConfigValueType.FLOAT32 -> view.putFloat(toDouble(value).toFloat())
      RefloatConfigValueType.FLOAT32_SCALED -> {
        val scale = requireScale(field)
        view.putInt((toDouble(value) * scale).roundToInt())
      }
      RefloatConfigValueType.FLOAT32_AUTO -> writeFloat32Auto(bytes, field.offset, toDouble(value))
      RefloatConfigValueType.FLOAT16_SCALED -> {
        val scale = requireScale(field)
        view.putShort((toDouble(value) * scale).roundToInt().toShort())
      }
      RefloatConfigValueType.INT32 -> view.putInt(toDouble(value).toInt())
      RefloatConfigValueType.UINT32 -> view.putInt(toDouble(value).toLong().toInt())
      RefloatConfigValueType.INT16 -> view.putShort(toDouble(value).toInt().toShort())
      RefloatConfigValueType.UINT16 -> view.putShort(toDouble(value).toInt().toShort())
      RefloatConfigValueType.INT8 -> view.put(toDouble(value).toInt().toByte())
      RefloatConfigValueType.UINT8 -> view.put(toDouble(value).toInt().toByte())
      RefloatConfigValueType.BOOL -> view.put(if (toBool(value)) 1.toByte() else 0.toByte())
    }
  }

  private fun writeFloat32Auto(bytes: ByteArray, offset: Int, value: Double) {
    var number = value.toFloat()
    if (abs(number) < 1.5e-38f) number = 0f
    val frexpExponent = if (number == 0f) 0 else Math.getExponent(number) + 1
    val significand = if (number == 0f) 0f else Math.scalb(number, -frexpExponent)
    val significandAbs = abs(significand)
    var exponent = frexpExponent
    var significandBits = 0
    if (significandAbs >= 0.5f) {
      significandBits = ((significandAbs - 0.5f) * 2f * 8388608f).toInt()
      exponent += 126
    }
    var raw = ((exponent and 0xff) shl 23) or (significandBits and 0x7fffff)
    if (significand < 0f) raw = raw or (1 shl 31)
    ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).putInt(raw)
  }

  private fun requireScale(field: RefloatConfigSchemaField): Double {
    return field.scale
      ?: throw RefloatConfigEncodeException("CONFIG_ENCODE_FAILED: missing scale for ${field.id}")
  }

  private fun toDouble(value: Any): Double = when (value) {
    is Double -> value
    is Float -> value.toDouble()
    is Int -> value.toDouble()
    is Long -> value.toDouble()
    is Number -> value.toDouble()
    else -> throw RefloatConfigEncodeException("CONFIG_ENCODE_FAILED: cannot convert $value to Double")
  }

  private fun toBool(value: Any): Boolean = when (value) {
    is Boolean -> value
    is Number -> value.toInt() != 0
    else -> throw RefloatConfigEncodeException("CONFIG_ENCODE_FAILED: cannot convert $value to Boolean")
  }
}
