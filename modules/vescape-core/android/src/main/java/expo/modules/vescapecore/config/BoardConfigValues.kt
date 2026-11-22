package expo.modules.vescapecore.config

import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift
 */
internal enum class BoardConfigFreshness(val wire: String) {
  FRESH("fresh"),
  LAST_KNOWN("last-known"),
}

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift
 */
internal data class BoardConfigWriteBase(
  val schema: RefloatConfigSchema,
  val rawConfig: ByteArray,
  val packageSignature: Long,
)

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift
 */
internal data class BoardConfigValues(
  val boardId: String?,
  val refloatBaseVersion: String?,
  val capturedAtMs: Long,
  val freshness: BoardConfigFreshness,
  val values: Map<String, Any>,
  val writeBase: BoardConfigWriteBase?,
) {
  fun number(id: String): Double? = (values[id] as? Double)?.takeIf { it.isFinite() }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `number`
   */
  fun number(field: BoardConfigNumberField): Double? = number(field.id)

  fun bool(id: String): Boolean? = values[id] as? Boolean

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `flag`
   */
  fun flag(field: BoardConfigFlagField): Boolean? = when (val value = values[field.id]) {
    is Boolean -> value
    is Double -> value.isFinite().takeIf { it }?.let { value != 0.0 }
    else -> null
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `withFlag`
   */
  fun withFlag(field: BoardConfigFlagField, enabled: Boolean): BoardConfigValues? {
    val schemaType = writeBase?.schema?.fields?.firstOrNull { it.id == field.id }?.type
    val type = schemaType ?: when (values[field.id]) {
      is Boolean -> RefloatConfigValueType.BOOL
      is Double -> RefloatConfigValueType.INT8
      else -> return null
    }
    return copy(values = values + (field.id to encodeFlag(type, enabled)))
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `toBridgeMap`
   * @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
   */
  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `demotedToProvisional`
   */
  fun demotedToProvisional(): BoardConfigValues =
    if (freshness != BoardConfigFreshness.FRESH) this
    else copy(freshness = BoardConfigFreshness.LAST_KNOWN, writeBase = null)

  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "boardId" to boardId,
    "refloatBaseVersion" to refloatBaseVersion,
    "capturedAtMs" to capturedAtMs,
    "freshness" to freshness.wire,
    "values" to values,
  )

  fun valuesJson(): String = JSONObject(values).toString()

  companion object {
    fun lastKnown(
      boardId: String?,
      refloatBaseVersion: String?,
      capturedAtMs: Long,
      valuesJson: String,
    ): BoardConfigValues = BoardConfigValues(
      boardId = boardId,
      refloatBaseVersion = refloatBaseVersion,
      capturedAtMs = capturedAtMs,
      freshness = BoardConfigFreshness.LAST_KNOWN,
      values = decodeValuesJson(valuesJson),
      writeBase = null,
    )

    private fun decodeValuesJson(json: String): Map<String, Any> {
      val parsed = JSONObject(json)
      val values = mutableMapOf<String, Any>()
      for (id in parsed.keys()) {
        when (val raw = parsed.opt(id)) {
          is Boolean -> values[id] = raw
          is Number -> raw.toDouble().takeIf { it.isFinite() }?.let { values[id] = it }
          else -> Unit
        }
      }
      return values
    }
  }
}
