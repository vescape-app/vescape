package expo.modules.vescapecore.config

import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/config/MotorConfigValues.swift
 */
internal data class MotorConfigValues(
  val boardId: String?,
  val signature: Long,
  val firmware: String,
  val capturedAtMs: Long,
  val freshness: BoardConfigFreshness,
  val values: Map<String, Double>,
) {
  fun number(id: String): Double? = values[id]?.takeIf { it.isFinite() }

  /**
   * @parity /modules/vescape-core/ios/config/MotorConfigValues.swift `demotedToLastKnown`
   */
  fun demotedToLastKnown(): MotorConfigValues =
    if (freshness == BoardConfigFreshness.FRESH) copy(freshness = BoardConfigFreshness.LAST_KNOWN) else this

  /** @parity /modules/vescape-core/ios/config/MotorConfigValues.swift `toBridgeMap` */
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "boardId" to boardId,
    "signature" to signature,
    "firmware" to firmware,
    "capturedAtMs" to capturedAtMs,
    "freshness" to freshness.wire,
    "values" to values,
  )

  fun valuesJson(): String = JSONObject(values as Map<*, *>).toString()

  companion object {
    fun lastKnown(
      boardId: String?,
      signature: Long,
      firmware: String,
      capturedAtMs: Long,
      valuesJson: String,
    ): MotorConfigValues = MotorConfigValues(
      boardId = boardId,
      signature = signature,
      firmware = firmware,
      capturedAtMs = capturedAtMs,
      freshness = BoardConfigFreshness.LAST_KNOWN,
      values = decodeValuesJson(valuesJson),
    )

    private fun decodeValuesJson(json: String): Map<String, Double> {
      val parsed = JSONObject(json)
      val values = mutableMapOf<String, Double>()
      for (id in parsed.keys()) {
        (parsed.opt(id) as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { values[id] = it }
      }
      return values
    }
  }
}
