package expo.modules.vescapecore.warnings

import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningKind.swift
 * @parity /modules/vescape-core/src/index.ts `BoardWarningKind`
 */
enum class BoardWarningKind(val wire: String) {
  CELL_SPREAD("cell-spread"),
  BATTERY_CONFIG_MISMATCH("battery-config-mismatch"),
  FOOTPAD_DISABLED("footpad-disabled"),
  LV_PUSHBACK_LOW("lv-pushback-low"),
  HV_PUSHBACK_HIGH("hv-pushback-high"),
  DUTY_PUSHBACK_HIGH("duty-pushback-high"),
  ;

  companion object {
    val RETIRED_WIRE = listOf("moving-fault-disabled")
  }
}

internal fun boardWarningRound4(value: Double): Double =
  Math.copySign(Math.round(Math.abs(value) * 10_000.0) / 10_000.0, value)

internal fun boardWarningPayload(build: JSONObject.() -> Unit): String =
  JSONObject().apply(build).toString()
