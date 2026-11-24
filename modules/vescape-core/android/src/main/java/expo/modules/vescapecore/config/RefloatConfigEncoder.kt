package expo.modules.vescapecore.config

import kotlin.math.abs
import kotlin.math.floor

internal class RefloatConfigEncodeException(
  val code: RefloatConfigErrorCode,
  message: String,
) : Exception(message)

// @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift `FieldNumericRange`
internal data class FieldNumericRange(
  val min: Double,
  val max: Double,
)

// @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift `EncodedChangeset`
internal data class EncodedChangeset(
  val rawConfig: ByteArray,
  val changedFieldIds: Set<String>,
)

// @parity /modules/vescape-core/ios/config/RefloatConfigEncoder.swift
internal object RefloatConfigEncoder {
  fun encode(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
    fields: Map<String, Any?>,
  ): ByteArray = encodeChangeset(schema, rawConfig, fields).rawConfig

  fun encodeChangeset(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
    changes: Map<String, Any?>,
  ): EncodedChangeset {
    val byId = schema.fields.associateBy { it.id }
    val validated = changes.map { (fieldId, value) ->
      val field = byId[fieldId] ?: throw invalid("unknown field $fieldId")
      if (value == null) throw invalid("${field.id} cannot be null")
      val size = field.type.byteSize
      if (field.offset < 0 || rawConfig.size < field.offset + size) {
        throw RefloatConfigEncodeException(
          RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
          "config length ${rawConfig.size} < ${field.offset + size} for ${field.id}",
        )
      }
      val bytes = encodeAndVerifyField(field, value)
      field to bytes
    }

    val effectiveWrites = validated.filter { (field, encodedBytes) ->
      !matchesExistingBytes(rawConfig, field.offset, encodedBytes)
    }

    if (effectiveWrites.isEmpty()) {
      return EncodedChangeset(rawConfig = rawConfig.copyOf(), changedFieldIds = emptySet())
    }

    val allowedOffsets = HashSet<Int>()
    for ((field, encodedBytes) in effectiveWrites) {
      for (i in field.offset until field.offset + encodedBytes.size) {
        if (!allowedOffsets.add(i)) {
          throw RefloatConfigEncodeException(
            RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
            "overlapping field byte range at offset $i for ${field.id}",
          )
        }
      }
    }

    val result = rawConfig.copyOf()
    for ((field, encodedBytes) in effectiveWrites) {
      encodedBytes.copyInto(result, destinationOffset = field.offset)
    }

    assertOnlyAllowedBytesChanged(rawConfig, result, allowedOffsets)
    return EncodedChangeset(
      rawConfig = result,
      changedFieldIds = effectiveWrites.map { it.first.id }.toSet(),
    )
  }

  internal fun effectiveRange(field: RefloatConfigSchemaField): FieldNumericRange? {
    if (field.type == RefloatConfigValueType.BOOL) return null
    val (wireMin, wireMax) = when (field.type) {
      RefloatConfigValueType.FLOAT32,
      RefloatConfigValueType.FLOAT32_AUTO ->
        -Float.MAX_VALUE.toDouble() to Float.MAX_VALUE.toDouble()
      RefloatConfigValueType.FLOAT32_SCALED -> {
        val scale = requireScale(field)
        (Int.MIN_VALUE.toDouble() / scale) to (Int.MAX_VALUE.toDouble() / scale)
      }
      RefloatConfigValueType.FLOAT16_SCALED -> {
        val scale = requireScale(field)
        (Short.MIN_VALUE.toDouble() / scale) to (Short.MAX_VALUE.toDouble() / scale)
      }
      RefloatConfigValueType.INT32 -> Int.MIN_VALUE.toDouble() to Int.MAX_VALUE.toDouble()
      RefloatConfigValueType.UINT32 -> 0.0 to 4_294_967_295.0
      RefloatConfigValueType.INT16 -> Short.MIN_VALUE.toDouble() to Short.MAX_VALUE.toDouble()
      RefloatConfigValueType.UINT16 -> 0.0 to 65_535.0
      RefloatConfigValueType.INT8 -> Byte.MIN_VALUE.toDouble() to Byte.MAX_VALUE.toDouble()
      RefloatConfigValueType.UINT8 -> 0.0 to 255.0
      RefloatConfigValueType.BOOL -> return null
    }
    val min = field.min?.takeIf { it.isFinite() }?.let { maxOf(wireMin, it) } ?: wireMin
    val max = field.max?.takeIf { it.isFinite() }?.let { minOf(wireMax, it) } ?: wireMax
    return FieldNumericRange(min = min, max = max)
  }

  private fun encodeAndVerifyField(field: RefloatConfigSchemaField, value: Any): ByteArray {
    val bits = validateAndEncode(field, value)
    val bytes = toBytes(field.type.byteSize, bits)
    val decoded = decodeWireBytes(field, bytes)
    val roundTripBits = encodeWireBits(field, decoded)
    if (roundTripBits != bits) {
      throw invalid("${field.id} = $value failed wire round-trip")
    }
    return bytes
  }

  private fun decodeWireBytes(field: RefloatConfigSchemaField, bytes: ByteArray): Any {
    var raw = 0L
    for (b in bytes) raw = (raw shl 8) or (b.toLong() and 0xffL)
    return when (field.type) {
      RefloatConfigValueType.FLOAT32 -> Float.fromBits(raw.toInt()).toDouble()
      RefloatConfigValueType.FLOAT32_SCALED -> raw.toInt().toDouble() / requireScale(field)
      RefloatConfigValueType.FLOAT32_AUTO -> decodeFloat32Auto(raw.toInt())
      RefloatConfigValueType.FLOAT16_SCALED -> raw.toShort().toDouble() / requireScale(field)
      RefloatConfigValueType.INT32 -> raw.toInt().toDouble()
      RefloatConfigValueType.UINT32 -> (raw and 0xffffffffL).toDouble()
      RefloatConfigValueType.INT16 -> raw.toShort().toDouble()
      RefloatConfigValueType.UINT16 -> (raw and 0xffffL).toDouble()
      RefloatConfigValueType.INT8 -> raw.toByte().toDouble()
      RefloatConfigValueType.UINT8 -> (raw and 0xffL).toDouble()
      RefloatConfigValueType.BOOL -> (raw and 0xffL) != 0L
    }
  }

  private fun decodeFloat32Auto(raw: Int): Double {
    val eRaw = (raw ushr 23) and 0xff
    val sigI = raw and 0x7fffff
    val neg = (raw ushr 31) != 0
    if (eRaw == 0 && sigI == 0) return 0.0
    val sig = sigI / (8_388_608.0 * 2.0) + 0.5
    val result = Math.scalb(sig, eRaw - 126)
    return if (neg) -result else result
  }

  private fun isEnumField(field: RefloatConfigSchemaField): Boolean =
    field.xmlType == 4 || (field.xmlType == null && field.enumNames.isNotEmpty())

  private fun isIntegerType(type: RefloatConfigValueType): Boolean = when (type) {
    RefloatConfigValueType.INT32,
    RefloatConfigValueType.UINT32,
    RefloatConfigValueType.INT16,
    RefloatConfigValueType.UINT16,
    RefloatConfigValueType.INT8,
    RefloatConfigValueType.UINT8 -> true
    else -> false
  }

  private fun validateAndEncode(field: RefloatConfigSchemaField, value: Any): Long {
    if (field.type == RefloatConfigValueType.BOOL) {
      return if (bool(field, value)) 1L else 0L
    }
    val n = number(field, value)
    if (isIntegerType(field.type) && floor(n) != n) {
      throw invalid("${field.id} expects an integer, got $n")
    }
    if (isEnumField(field) && field.enumNames.isNotEmpty()) {
      if (n < 0.0 || n >= field.enumNames.size.toDouble()) {
        throw invalid("${field.id} = $n is outside enum range 0..${field.enumNames.size - 1}")
      }
    }
    val range = effectiveRange(field)
    if (range != null && (n < range.min || n > range.max)) {
      throw invalid("${field.id} = $n is outside effective range ${range.min}..${range.max}")
    }
    return encodeWireBits(field, n)
  }

  private fun encodeWireBits(field: RefloatConfigSchemaField, value: Any): Long {
    if (field.type == RefloatConfigValueType.BOOL) {
      return if (bool(field, value)) 1L else 0L
    }
    val n = number(field, value)
    return when (field.type) {
      RefloatConfigValueType.FLOAT32 ->
        floatValue(field, n).toRawBits().toLong() and 0xffffffffL
      RefloatConfigValueType.FLOAT32_AUTO -> float32AutoBits(floatValue(field, n))
      RefloatConfigValueType.FLOAT32_SCALED ->
        scaledInteger(field, n * requireScale(field), Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong())
      RefloatConfigValueType.FLOAT16_SCALED ->
        scaledInteger(field, n * requireScale(field), Short.MIN_VALUE.toLong(), Short.MAX_VALUE.toLong())
      RefloatConfigValueType.INT32 -> exactInteger(field, n, Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong())
      RefloatConfigValueType.UINT32 -> exactInteger(field, n, 0, 0xffffffffL)
      RefloatConfigValueType.INT16 -> exactInteger(field, n, Short.MIN_VALUE.toLong(), Short.MAX_VALUE.toLong())
      RefloatConfigValueType.UINT16 -> exactInteger(field, n, 0, 0xffff)
      RefloatConfigValueType.INT8 -> exactInteger(field, n, Byte.MIN_VALUE.toLong(), Byte.MAX_VALUE.toLong())
      RefloatConfigValueType.UINT8 -> exactInteger(field, n, 0, 0xff)
      RefloatConfigValueType.BOOL -> if (bool(field, value)) 1L else 0L
    }
  }

  private fun toBytes(size: Int, bits: Long): ByteArray {
    val bytes = ByteArray(size)
    for (i in 0 until size) {
      bytes[i] = (bits shr (8 * (size - 1 - i))).toByte()
    }
    return bytes
  }

  private fun matchesExistingBytes(rawConfig: ByteArray, offset: Int, encodedBytes: ByteArray): Boolean {
    for (i in encodedBytes.indices) {
      if (rawConfig[offset + i] != encodedBytes[i]) return false
    }
    return true
  }

  private fun assertOnlyAllowedBytesChanged(
    base: ByteArray,
    patched: ByteArray,
    allowedOffsets: Set<Int>,
  ) {
    if (base.size != patched.size) {
      throw RefloatConfigEncodeException(
        RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
        "patched config size ${patched.size} != base size ${base.size}",
      )
    }
    for (i in base.indices) {
      if (i !in allowedOffsets && base[i] != patched[i]) {
        throw RefloatConfigEncodeException(
          RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
          "unexpected byte mutation at offset $i",
        )
      }
    }
  }

  private fun number(field: RefloatConfigSchemaField, value: Any): Double {
    if (value !is Number) throw invalid("${field.id} expects a number, got $value")
    val number = value.toDouble()
    if (!number.isFinite()) throw invalid("${field.id} is not finite")
    return number
  }

  private fun floatValue(field: RefloatConfigSchemaField, number: Double): Float {
    if (abs(number) > Float.MAX_VALUE) throw invalid("${field.id} = $number does not fit a float")
    return number.toFloat()
  }

  private fun exactInteger(field: RefloatConfigSchemaField, value: Double, min: Long, max: Long): Long {
    if (!value.isFinite() || floor(value) != value || value < min || value > max) {
      throw invalid("${field.id} = $value does not fit $min..$max on the wire")
    }
    return value.toLong()
  }

  private fun scaledInteger(field: RefloatConfigSchemaField, value: Double, min: Long, max: Long): Long {
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
    val scale = field.scale
      ?: throw RefloatConfigEncodeException(
        RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
        "missing scale for ${field.id}",
      )
    if (!scale.isFinite() || scale <= 0.0) {
      throw RefloatConfigEncodeException(
        RefloatConfigErrorCode.CONFIG_ENCODE_FAILED,
        "invalid scale $scale for ${field.id}",
      )
    }
    return scale
  }

  private fun invalid(message: String) =
    RefloatConfigEncodeException(RefloatConfigErrorCode.CONFIG_VALUE_INVALID, message)
}
