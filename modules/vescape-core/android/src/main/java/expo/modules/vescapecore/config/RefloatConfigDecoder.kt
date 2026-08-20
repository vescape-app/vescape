package expo.modules.vescapecore.config

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

// @parity /modules/vescape-core/ios/config/RefloatConfigDecoder.swift
internal class RefloatConfigDecodeException(message: String) : Exception(message)

internal object RefloatConfigDecoder {
  fun decode(
    schema: RefloatConfigSchema,
    rawConfig: ByteArray,
    boardId: String?,
    canId: Int?,
    capturedAt: Long,
    fwVersion: String?,
    refloatVersion: String? = null,
  ): RefloatConfigSnapshot {
    val byId = schema.fields.associateBy { it.id }
    val requiredLength = schema.fields.maxOfOrNull { it.offset + it.type.byteSize } ?: 0
    if (rawConfig.size < requiredLength) {
      throw RefloatConfigDecodeException("CONFIG_DECODE_FAILED: config length ${rawConfig.size} < $requiredLength")
    }

    val missing = mutableListOf<String>()
    val groups = REFLOAT_TUNE_GROUPS.mapNotNull { groupDef ->
      val fields = groupDef.fields.mapNotNull { fieldDef ->
        val schemaField = byId[fieldDef.id] ?: run {
          missing.add(fieldDef.id)
          return@mapNotNull null
        }
        RefloatConfigField(
          id = fieldDef.id,
          label = schemaField.label.ifBlank { fieldDef.label },
          value = readValue(rawConfig, schemaField),
          unit = schemaField.unit ?: fieldDef.unitFallback,
          min = schemaField.min,
          max = schemaField.max,
        )
      }
      if (fields.isEmpty()) null else RefloatConfigGroup(groupDef.id, groupDef.title, fields)
    }

    return RefloatConfigSnapshot(
      capturedAt = capturedAt,
      boardId = boardId,
      canId = canId,
      schemaHash = schema.hash,
      rawConfigHash = sha256(rawConfig),
      rawConfigLength = rawConfig.size,
      groups = groups,
      missingFieldIds = missing,
      fwVersion = fwVersion,
      refloatVersion = refloatVersion,
    )
  }

  /**
   * Decode **every** field the schema describes, each in its real type — a bool field stays a
   * `Boolean`, never `1.0` / `0.0`.
   *
   * A field is left out of the map when the schema places it past the end of the raw config
   * (`offset + byteSize` precondition), when it fails to decode (e.g. a scaled type with no scale),
   * or when it decodes to a non-finite number. Non-finite is deliberately treated as missing rather
   * than as a value: a reader skips an absent field, whereas a NaN would compare false against every
   * bound and wrongly count as a clean evaluation that clears a valid warning. One bad field is
   * contained to itself and never discards the rest of the map.
   */
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

  /**
   * Decode the whole schema into the Board Session's Board Config Values, retaining the bytes,
   * package signature, and schema as the write base. Always fresh — it just came off the board.
   */
  fun decodeBoardConfigValues(
    schema: RefloatConfigSchema,
    configBytes: RefloatConfigBytes,
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAt: Long,
  ): BoardConfigValues = BoardConfigValues(
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

  private fun readValue(bytes: ByteArray, field: RefloatConfigSchemaField): Any {
    val view = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    view.position(field.offset)
    return when (field.type) {
      RefloatConfigValueType.FLOAT32 -> view.float.toDouble()
      RefloatConfigValueType.FLOAT32_SCALED -> view.int / requireScale(field)
      RefloatConfigValueType.FLOAT32_AUTO -> float32Auto(bytes, field.offset)
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

  private fun float32Auto(bytes: ByteArray, offset: Int): Double {
    val raw = ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).int
    val eRaw = (raw ushr 23) and 0xff
    val sigI = raw and 0x7fffff
    val neg = (raw ushr 31) != 0
    if (eRaw == 0 && sigI == 0) return 0.0
    val sig = sigI / (8388608.0 * 2.0) + 0.5
    val result = sig * Math.pow(2.0, (eRaw - 126).toDouble())
    return if (neg) -result else result
  }

  private fun sha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
  }
}
