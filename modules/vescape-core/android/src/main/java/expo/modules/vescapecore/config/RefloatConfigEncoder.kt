package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.floor

internal class RefloatConfigEncodeException(
  val code: RefloatConfigErrorCode,
  message: String,
) : Exception(message)

// @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift
internal object RefloatConfigEncoder {
  fun encode(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
    fields: Map<String, Any>,
  ): ByteArray {
    val byId = schema.fields.associateBy { it.id }
    val writes = fields.map { (fieldId, value) ->
      val field = byId[fieldId] ?: throw invalid("unknown field $fieldId")
      field to wireBits(field, value)
    }
    val result = rawConfig.copyOf()
    for ((field, bits) in writes) put(result, field, bits)
    return result
  }

  private fun wireBits(field: RefloatConfigSchemaField, value: Any): Long = when (field.type) {
    RefloatConfigValueType.FLOAT32 ->
      floatValue(field, value).toRawBits().toLong() and 0xffffffffL
    RefloatConfigValueType.FLOAT32_AUTO -> float32AutoBits(floatValue(field, value))
    RefloatConfigValueType.FLOAT32_SCALED ->
      integer(field, number(field, value) * requireScale(field), Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong())
    RefloatConfigValueType.FLOAT16_SCALED ->
      integer(field, number(field, value) * requireScale(field), Short.MIN_VALUE.toLong(), Short.MAX_VALUE.toLong())
    RefloatConfigValueType.INT32 -> integer(field, number(field, value), Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong())
    RefloatConfigValueType.UINT32 -> integer(field, number(field, value), 0, 0xffffffffL)
    RefloatConfigValueType.INT16 -> integer(field, number(field, value), Short.MIN_VALUE.toLong(), Short.MAX_VALUE.toLong())
    RefloatConfigValueType.UINT16 -> integer(field, number(field, value), 0, 0xffff)
    RefloatConfigValueType.INT8 -> integer(field, number(field, value), Byte.MIN_VALUE.toLong(), Byte.MAX_VALUE.toLong())
    RefloatConfigValueType.UINT8 -> integer(field, number(field, value), 0, 0xff)
    RefloatConfigValueType.BOOL -> if (bool(field, value)) 1 else 0
  }

  private fun put(bytes: ByteArray, field: RefloatConfigSchemaField, bits: Long) {
    val size = when (field.type) {
      RefloatConfigValueType.FLOAT32,
      RefloatConfigValueType.FLOAT32_AUTO,
      RefloatConfigValueType.FLOAT32_SCALED,
      RefloatConfigValueType.INT32,
      RefloatConfigValueType.UINT32 -> 4
      RefloatConfigValueType.FLOAT16_SCALED,
      RefloatConfigValueType.INT16,
      RefloatConfigValueType.UINT16 -> 2
      RefloatConfigValueType.INT8,
      RefloatConfigValueType.UINT8,
      RefloatConfigValueType.BOOL -> 1
    }
    for (i in 0 until size) {
      bytes[field.offset + i] = (bits shr (8 * (size - 1 - i))).toByte()
    }
  }

  private fun number(field: RefloatConfigSchemaField, value: Any): Double {
    if (value !is Number) throw invalid("${field.id} expects a number, got $value")
    val number = value.toDouble()
    if (!number.isFinite()) throw invalid("${field.id} is not finite")
    return number
  }

  private fun floatValue(field: RefloatConfigSchemaField, value: Any): Float {
    val number = number(field, value)
    if (abs(number) > Float.MAX_VALUE) throw invalid("${field.id} = $number does not fit a float")
    return number.toFloat()
  }

  private fun integer(field: RefloatConfigSchemaField, value: Double, min: Long, max: Long): Long {
    val rounded = floor(value + 0.5)
    if (!rounded.isFinite() || rounded < min || rounded > max) {
      throw invalid("${field.id} = $value does not fit $min..$max on the wire")
    }
    return rounded.toLong()
  }

  private fun bool(field: RefloatConfigSchemaField, value: Any): Boolean = when {
    value is Boolean -> value
    value is Number && value.toDouble() == 0.0 -> false
    value is Number && value.toDouble() == 1.0 -> true
    else -> throw invalid("${field.id} expects a boolean, got $value")
  }

  private fun float32AutoBits(value: Float): Long {
    val number = if (abs(value) < 1.5e-38f) 0f else value
    val frexpExponent = if (number == 0f) 0 else Math.getExponent(number) + 1
    val significandAbs = if (number == 0f) 0f else abs(Math.scalb(number, -frexpExponent))
    var exponent = frexpExponent
    var significandBits = 0
    if (significandAbs >= 0.5f) {
      significandBits = ((significandAbs - 0.5f) * 2f * 8388608f).toInt()
      exponent += 126
    }
    var raw = ((exponent and 0xff) shl 23) or (significandBits and 0x7fffff)
    if (number < 0f) raw = raw or (1 shl 31)
    return raw.toLong() and 0xffffffffL
  }

  private fun requireScale(field: RefloatConfigSchemaField): Double {
    return field.scale
      ?: throw RefloatConfigEncodeException(
        RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
        "missing scale for ${field.id}",
      )
  }

  private fun invalid(message: String) =
    RefloatConfigEncodeException(RefloatConfigErrorCode.CONFIG_VALUE_INVALID, message)
}
