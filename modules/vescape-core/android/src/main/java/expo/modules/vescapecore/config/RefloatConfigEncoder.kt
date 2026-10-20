package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.roundToInt

internal class RefloatConfigEncodeException(message: String) : Exception(message)

// @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift
internal object RefloatConfigEncoder {
  fun encode(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
    fields: Map<String, Any>,
    strict: Boolean = false,
  ): ByteArray {
    val result = rawConfig.copyOf()
    val byId = schema.fields.associateBy { it.id }
    val allowed = REFLOAT_TUNE_GROUPS.flatMap { it.fields }.map { it.id }.toSet()
    for ((fieldId, value) in fields) {
      if (strict && fieldId !in allowed) throw RefloatConfigEncodeException("Not a tune field: $fieldId")
      val schemaField = byId[fieldId]
      if (schemaField == null) {
        if (strict) throw RefloatConfigEncodeException("Missing draft field in board schema: $fieldId")
        continue
      }
      if (strict) {
        val number = (value as? Number)?.toDouble()
        if (schemaField.type != RefloatConfigValueType.BOOL && (number == null || !number.isFinite() || (schemaField.min != null && number < schemaField.min) || (schemaField.max != null && number > schemaField.max))) {
          throw RefloatConfigEncodeException("Draft value outside firmware bounds: $fieldId")
        }
        if (number != null) {
          val scaled = number * (schemaField.scale ?: 1.0)
          val representable = when (schemaField.type) {
            RefloatConfigValueType.FLOAT16_SCALED -> kotlin.math.floor(scaled + 0.5) in Short.MIN_VALUE.toDouble()..Short.MAX_VALUE.toDouble()
            RefloatConfigValueType.FLOAT32_SCALED -> kotlin.math.floor(scaled + 0.5) in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()
            RefloatConfigValueType.FLOAT32, RefloatConfigValueType.FLOAT32_AUTO -> number.toFloat().isFinite()
            else -> true
          }
          if (!representable) throw RefloatConfigEncodeException("Draft value cannot be encoded: $fieldId")
        }
      }
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
    if (value == 0.0) {
      ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).putInt(0)
      return
    }
    val neg = value < 0.0
    val absVal = abs(value)
    val e = floor(ln(absVal) / ln(2.0)).toInt() + 126
    val eRaw = e.coerceIn(0, 255)
    val sig = absVal / Math.pow(2.0, (eRaw - 126).toDouble()) - 0.5
    val sigI = (sig * 8388608.0 * 2.0).roundToInt().coerceIn(0, 0x7fffff)
    var raw = (eRaw shl 23) or sigI
    if (neg) raw = raw or (1 shl 31)
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
