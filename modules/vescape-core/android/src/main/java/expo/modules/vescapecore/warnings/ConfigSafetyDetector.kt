package expo.modules.vescapecore.warnings

import expo.modules.vescapecore.config.BoardConfigValues

/** One config-safety finding to report through the Board Warning registry. */
data class ConfigSafetyFinding(
  val kind: BoardWarningKind,
  val severity: BoardWarningSeverity,
  val payloadJson: String,
)

/**
 * Outcome of one config evaluation. [findings] are the rules that tripped; [cleanKinds] are the rules
 * that evaluated with real data and were fine (so the registry auto-clears them, fault-code model). A
 * rule whose inputs were absent appears in neither list — it is skipped, leaving any stored warning
 * untouched.
 */
data class ConfigSafetyReport(
  val findings: List<ConfigSafetyFinding>,
  val cleanKinds: List<BoardWarningKind>,
)

/**
 * Config-scoped Board Warning detector: pure rules over the decoded Refloat safety config plus the
 * board's configured battery series count. Pure evaluation logic per the pure-native-logic ADR; the
 * background config read, series-count lookup, and registry reporting stay in the session controller.
 *
 * Thresholds are native constants. The pushback voltage rules (LV/HV) read `tiltback_lv`
 * / `tiltback_hv` in whichever units the firmware uses: Refloat on VESC 6.05+ stores a **per-cell**
 * value (compared directly against the per-cell bound), older firmware stores a **pack** value
 * (compared against `bound × series`, so it needs the series count). [usesPerCellVoltage] resolves the
 * mode from the firmware string; when it cannot ([perCell] null) — or when pack mode lacks a series
 * count — those two rules are skipped. A rule whose config field is missing from the schema is likewise
 * skipped. Every payload carries the offending parameter, its current value, and the safe bound so the
 * UI can explain the finding.
 *
 * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetector.swift
 */
object ConfigSafetyDetector {
  /** Minimum safe low-voltage pushback per cell (V). Pack-mode bound is `this × series`. */
  const val CELL_LV_MIN_V = 3.0

  /** Maximum safe high-voltage pushback per cell (V). Pack-mode bound is `this × series`. */
  const val CELL_HV_MAX_V = 4.3

  /** Maximum safe duty-cycle pushback threshold (fraction). VESC max duty is 0.95. */
  const val DUTY_MAX = 0.85

  /** First VESC firmware (major, minor) that stores `tiltback_lv`/`tiltback_hv` as per-cell values. */
  private const val PER_CELL_FW_MAJOR = 6
  private const val PER_CELL_FW_MINOR = 5

  private val fwVersionPattern = Regex("""(\d+)\.(\d+)""")

  /**
   * Whether the firmware stores the pushback voltages per-cell (VESC 6.05+) rather than as a pack
   * total. Returns null when the firmware string is absent or unparseable, so the caller skips the
   * voltage rules rather than guessing the units.
   */
  fun usesPerCellVoltage(fwVersion: String?): Boolean? {
    val match = fwVersion?.let { fwVersionPattern.find(it) } ?: return null
    val major = match.groupValues[1].toIntOrNull() ?: return null
    val minor = match.groupValues[2].toIntOrNull() ?: return null
    return major > PER_CELL_FW_MAJOR || (major == PER_CELL_FW_MAJOR && minor >= PER_CELL_FW_MINOR)
  }

  /**
   * Schema field ids the rules read off the Board Config Values map. A field absent from the map
   * (missing from the schema, truncated, or unparseable) skips its rule.
   * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetector.swift
   */
  const val FAULT_ADC1_ID = "fault_adc1"
  const val FAULT_ADC2_ID = "fault_adc2"
  const val TILTBACK_LV_ID = "tiltback_lv"
  const val TILTBACK_HV_ID = "tiltback_hv"
  const val TILTBACK_DUTY_ID = "tiltback_duty"
  const val MOVING_FAULT_DISABLED_ID = "fault_moving_fault_disabled"

  internal fun evaluate(values: BoardConfigValues, seriesCount: Int?, perCell: Boolean?): ConfigSafetyReport {
    val findings = mutableListOf<ConfigSafetyFinding>()
    val clean = mutableListOf<BoardWarningKind>()

    // footpad-disabled (critical): both ADC switch voltages 0 disables the footpad switch entirely.
    val adc1 = values.number(FAULT_ADC1_ID)
    val adc2 = values.number(FAULT_ADC2_ID)
    if (adc1 != null && adc2 != null) {
      if (adc1 == 0.0 && adc2 == 0.0) {
        findings += finding(BoardWarningKind.FOOTPAD_DISABLED, BoardWarningSeverity.CRITICAL, "$FAULT_ADC1_ID/$FAULT_ADC2_ID", 0.0, 0.0)
      } else {
        clean += BoardWarningKind.FOOTPAD_DISABLED
      }
    }

    // lv-pushback-low (critical): LV pushback below the safe minimum, in the firmware's voltage units.
    val lv = values.number(TILTBACK_LV_ID)
    val lvBound = voltageBound(CELL_LV_MIN_V, perCell, seriesCount)
    if (lv != null && lvBound != null) {
      if (lv < lvBound) {
        findings += finding(BoardWarningKind.LV_PUSHBACK_LOW, BoardWarningSeverity.CRITICAL, TILTBACK_LV_ID, lv, lvBound)
      } else {
        clean += BoardWarningKind.LV_PUSHBACK_LOW
      }
    }

    // hv-pushback-high (warn): HV pushback above the safe maximum, in the firmware's voltage units.
    val hv = values.number(TILTBACK_HV_ID)
    val hvBound = voltageBound(CELL_HV_MAX_V, perCell, seriesCount)
    if (hv != null && hvBound != null) {
      if (hv > hvBound) {
        findings += finding(BoardWarningKind.HV_PUSHBACK_HIGH, BoardWarningSeverity.WARN, TILTBACK_HV_ID, hv, hvBound)
      } else {
        clean += BoardWarningKind.HV_PUSHBACK_HIGH
      }
    }

    // duty-pushback-high (warn): duty pushback threshold set dangerously close to the duty limit.
    val duty = values.number(TILTBACK_DUTY_ID)
    if (duty != null) {
      if (duty > DUTY_MAX) {
        findings += finding(BoardWarningKind.DUTY_PUSHBACK_HIGH, BoardWarningSeverity.WARN, TILTBACK_DUTY_ID, duty, DUTY_MAX)
      } else {
        clean += BoardWarningKind.DUTY_PUSHBACK_HIGH
      }
    }

    // moving-fault-disabled (warn): moving faults disabled weakens fault protection while riding.
    val movingFault = values.bool(MOVING_FAULT_DISABLED_ID)
    if (movingFault != null) {
      if (movingFault) {
        findings += finding(BoardWarningKind.MOVING_FAULT_DISABLED, BoardWarningSeverity.WARN, MOVING_FAULT_DISABLED_ID, 1.0, 0.0)
      } else {
        clean += BoardWarningKind.MOVING_FAULT_DISABLED
      }
    }

    return ConfigSafetyReport(findings, clean)
  }

  /**
   * The safe voltage bound in the firmware's units: the per-cell constant directly (per-cell firmware),
   * or `× series` (pack firmware). Null when the mode is unknown, or pack mode has no series count — the
   * caller then skips the rule.
   */
  private fun voltageBound(perCellBound: Double, perCell: Boolean?, seriesCount: Int?): Double? = when (perCell) {
    true -> perCellBound
    false -> seriesCount?.let { perCellBound * it }
    null -> null
  }

  private fun finding(kind: BoardWarningKind, severity: BoardWarningSeverity, param: String, value: Double, bound: Double) =
    ConfigSafetyFinding(kind, severity, payloadJson(param, value, bound))

  private fun payloadJson(param: String, value: Double, bound: Double): String =
    boardWarningPayload {
      put("param", param)
      put("value", boardWarningRound4(value))
      put("bound", boardWarningRound4(bound))
    }
}
