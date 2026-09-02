package expo.modules.vescapecore.warnings

import org.json.JSONObject

/**
 * Single source of every Board Warning kind slug. Detectors reference these instead of holding their
 * own per-detector constants, and the registry's typed report path accepts them, so a mistyped kind
 * is a compile error rather than a warning that silently renders as a raw slug. The [wire] string is
 * what crosses the bridge and is stored durably; it must stay in lockstep with the JS `BoardWarningKind`
 * union in `modules/vescape-core/src/index.ts`.
 *
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
    /**
     * Kinds this app once emitted and no longer does. Their slug stays durable in the warnings table,
     * so a retired kind would otherwise sit on a rider's board forever: nothing evaluates it, so
     * nothing ever reports it clean. Every config evaluation clears them instead.
     *
     * `moving-fault-disabled` flagged Refloat's "Disable Moving Faults" as unsafe. It is a deliberate
     * mitigation on boards with unreliable footpad sensors, so the warning said nothing a rider could
     * act on.
     */
    val RETIRED_WIRE = listOf("moving-fault-disabled")
  }
}

/**
 * Round a payload number to 4 decimals before it is serialized, so raw float noise (e.g. a
 * `3.92 - 3.80` subtraction that lands on `0.11999999999999988`) never reaches the wire and the
 * emitted value stays stable across detections. Ties round half away from zero to match the iOS
 * `BoardWarningPayload.round4` (`Math.round` alone would round negative ties toward +∞).
 */
internal fun boardWarningRound4(value: Double): Double =
  Math.copySign(Math.round(Math.abs(value) * 10_000.0) / 10_000.0, value)

/** Build a Board Warning payload JSON string via [JSONObject], never hand-assembled strings. */
internal fun boardWarningPayload(build: JSONObject.() -> Unit): String =
  JSONObject().apply(build).toString()
