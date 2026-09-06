package expo.modules.vescapecore.config

import org.json.JSONObject

/**
 * Whether a Board Config Values object was read from the board in the current Board Session
 * ([FRESH]) or restored from the per-Board cache on connect ([LAST_KNOWN]).
 *
 * Provisional values may be displayed, but never back a config write: the cache was filled while some
 * earlier session held the link, and the window since then is exactly where another tool could have
 * written the board. See ADR 0035.
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift
 */
internal enum class BoardConfigFreshness(val wire: String) {
  FRESH("fresh"),
  LAST_KNOWN("last-known"),
}

/**
 * The only valid base for a Refloat config write: the raw bytes exactly as the board sent them, the
 * package signature `COMM_SET_CUSTOM_CONFIG` echoes back, and the parsed schema that locates each
 * field inside those bytes.
 *
 * A write patches these bytes rather than re-encoding the decoded map, which is what keeps fields
 * outside the curated tune groups intact — never reconstruct config from [BoardConfigValues.values].
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift
 */
internal data class BoardConfigWriteBase(
  val schema: RefloatConfigSchema,
  val rawConfig: ByteArray,
  val packageSignature: Long,
)

/**
 * One Board Session's Refloat configuration, native-owned: the decoded map over the whole schema plus
 * (when [BoardConfigFreshness.FRESH]) the write base the bytes came from.
 *
 * [values] holds each field in its real type — a bool field is a `Boolean`, not `1.0`. A field the
 * schema does not carry, whose bytes are truncated, or that decodes to a non-finite number is
 * **absent** from the map: "missing" and "unparseable" stay indistinguishable to every reader, so a
 * NaN can never pass as a real value.
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift
 */
internal data class BoardConfigValues(
  val boardId: String?,
  /** Refloat base version the values were decoded against — the cache scope (ADR 0022). */
  val refloatBaseVersion: String?,
  val capturedAtMs: Long,
  val freshness: BoardConfigFreshness,
  /** Decoded fields, keyed by schema field id. Values are `Double` or `Boolean`. */
  val values: Map<String, Any>,
  /** Present only on fresh values; a restored cache row has no bytes to patch. */
  val writeBase: BoardConfigWriteBase?,
) {
  /**
   * A finite number field, or null when the field is absent. Never coerces a bool to `1.0` / `0.0` —
   * a rule asking for a number wants a number.
   */
  fun number(id: String): Double? = (values[id] as? Double)?.takeIf { it.isFinite() }

  /**
   * One of the number fields Vescape operates on. The typed twin of [number], so a rule cannot name a
   * field the fixture corpus has never seen.
   *
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `number`
   */
  fun number(field: BoardConfigNumberField): Double? = number(field.id)

  /** A bool field, or null when the field is absent. */
  fun bool(id: String): Boolean? = values[id] as? Boolean

  /**
   * One of the flag fields Vescape operates on, read through whichever representation the schema
   * produced for it. Refloat spells these as numeric params, so [bool] alone would answer null on
   * every real board — see [BoardConfigFlagField].
   *
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `flag`
   */
  fun flag(field: BoardConfigFlagField): Boolean? = when (val value = values[field.id]) {
    is Boolean -> value
    is Double -> value.isFinite().takeIf { it }?.let { value != 0.0 }
    else -> null
  }

  /**
   * The same values with one flag field set, spelled in the type the board's schema declares for it.
   * The schema is asked first and the currently decoded value is only a fallback for
   * [BoardConfigFreshness.LAST_KNOWN] rows, which carry no write base to ask.
   *
   * Returns null when neither source knows the field: inventing a key would itself register as a
   * config change, which is the exact bug this accessor exists to prevent.
   *
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
   * The JS-facing shape: decoded fields plus freshness, and nothing else. The write base never
   * crosses the bridge — JS has no use for raw bytes and must never be able to assemble a write from
   * them (ADR 0035).
   *
   * @parity /modules/vescape-core/ios/config/BoardConfigValues.swift `toBridgeMap`
   * @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
   */
  /**
   * Demote to lastKnown, dropping the write base. Called when the BLE link drops: the values stay
   * worth showing, but the disconnected window is exactly where another central could have written
   * the board, so they may no longer back a write (ADR 0035).
   *
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

  /**
   * Decoded values as the JSON stored in the per-Board cache row. Bools serialize as `true` / `false`
   * so the restored map keeps the same types.
   */
  fun valuesJson(): String = JSONObject(values).toString()

  companion object {
    /** Rebuild a cached object. Always lastKnown and always without a write base. */
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

    /**
     * JSON integral numbers read back as `Int`/`Long`, so every number is normalized to `Double`
     * while `Boolean` stays `Boolean` — the restored map has the same types the decode produced.
     */
    private fun decodeValuesJson(json: String): Map<String, Any> {
      val parsed = try {
        JSONObject(json)
      } catch (_: Exception) {
        return emptyMap()
      }
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
