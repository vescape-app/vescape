package expo.modules.vescapecore.warnings

/**
 * Decoded Refloat config values the safety rules evaluate. A `null` field means the schema did not
 * carry it (or the raw config was too short) — the rules that need it are skipped, never guessed.
 */
data class ConfigSafetyValues(
  val faultAdc1: Double?,
  val faultAdc2: Double?,
  val tiltbackLv: Double?,
  val tiltbackHv: Double?,
  val tiltbackDuty: Double?,
  val movingFaultDisabled: Boolean?,
)

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
 * / `tiltback_hv` in whichever units the config value uses. Refloat on VESC 6.05+ supports both
 * **per-cell** values below 10 V and legacy **pack** totals; older firmware supports only pack totals.
 * [supportsPerCellVoltage] resolves firmware capability, then each value resolves its own units. When
 * capability is unknown ([perCell] null) — or when pack mode lacks a series
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

  /** First VESC firmware (major, minor) that supports per-cell `tiltback_lv`/`tiltback_hv` values. */
  private const val PER_CELL_FW_MAJOR = 6
  private const val PER_CELL_FW_MINOR = 5

  private val fwVersionPattern = Regex("""(\d+)\.(\d+)""")

  /**
   * Whether the firmware supports per-cell pushback voltages (VESC 6.05+). Pack totals remain valid.
   * Returns null when the firmware string is absent or unparseable, so the caller skips the
   * voltage rules rather than guessing the units.
   */
  fun supportsPerCellVoltage(fwVersion: String?): Boolean? {
    val match = fwVersion?.let { fwVersionPattern.find(it) } ?: return null
    val major = match.groupValues[1].toIntOrNull() ?: return null
    val minor = match.groupValues[2].toIntOrNull() ?: return null
    return major > PER_CELL_FW_MAJOR || (major == PER_CELL_FW_MAJOR && minor >= PER_CELL_FW_MINOR)
  }

  fun evaluate(values: ConfigSafetyValues, seriesCount: Int?, perCell: Boolean?): ConfigSafetyReport {
    val findings = mutableListOf<ConfigSafetyFinding>()
    val clean = mutableListOf<BoardWarningKind>()

    // footpad-disabled (critical): both ADC switch voltages 0 disables the footpad switch entirely.
    val adc1 = values.faultAdc1
    val adc2 = values.faultAdc2
    if (adc1 != null && adc2 != null) {
      if (adc1 == 0.0 && adc2 == 0.0) {
        findings += finding(BoardWarningKind.FOOTPAD_DISABLED, BoardWarningSeverity.CRITICAL, "fault_adc1/fault_adc2", 0.0, 0.0)
      } else {
        clean += BoardWarningKind.FOOTPAD_DISABLED
      }
    }

    // lv-pushback-low (critical): LV pushback below the safe minimum, in the firmware's voltage units.
    val lv = values.tiltbackLv
    val lvBound = voltageBound(lv, CELL_LV_MIN_V, perCell, seriesCount)
    if (lv != null && lvBound != null) {
      if (lv < lvBound) {
        findings += finding(BoardWarningKind.LV_PUSHBACK_LOW, BoardWarningSeverity.CRITICAL, "tiltback_lv", lv, lvBound)
      } else {
        clean += BoardWarningKind.LV_PUSHBACK_LOW
      }
    }

    // hv-pushback-high (warn): HV pushback above the safe maximum, in the firmware's voltage units.
    val hv = values.tiltbackHv
    val hvBound = voltageBound(hv, CELL_HV_MAX_V, perCell, seriesCount)
    if (hv != null && hvBound != null) {
      if (hv > hvBound) {
        findings += finding(BoardWarningKind.HV_PUSHBACK_HIGH, BoardWarningSeverity.WARN, "tiltback_hv", hv, hvBound)
      } else {
        clean += BoardWarningKind.HV_PUSHBACK_HIGH
      }
    }

    // duty-pushback-high (warn): duty pushback threshold set dangerously close to the duty limit.
    val duty = values.tiltbackDuty
    if (duty != null) {
      if (duty > DUTY_MAX) {
        findings += finding(BoardWarningKind.DUTY_PUSHBACK_HIGH, BoardWarningSeverity.WARN, "tiltback_duty", duty, DUTY_MAX)
      } else {
        clean += BoardWarningKind.DUTY_PUSHBACK_HIGH
      }
    }

    // moving-fault-disabled (warn): moving faults disabled weakens fault protection while riding.
    val movingFault = values.movingFaultDisabled
    if (movingFault != null) {
      if (movingFault) {
        findings += finding(BoardWarningKind.MOVING_FAULT_DISABLED, BoardWarningSeverity.WARN, "fault_moving_fault_disabled", 1.0, 0.0)
      } else {
        clean += BoardWarningKind.MOVING_FAULT_DISABLED
      }
    }

    return ConfigSafetyReport(findings, clean)
  }

  /**
   * The safe voltage bound in the config value's units. Per-cell-capable firmware follows Refloat's
   * rule: values below 10 V are per-cell, larger values are pack totals. Null when firmware capability
   * is unknown, or a pack total has no series count.
   */
  private fun voltageBound(value: Double?, perCellBound: Double, perCellSupported: Boolean?, seriesCount: Int?): Double? = when (perCellSupported) {
    true -> if (value != null && value < 10.0) perCellBound else seriesCount?.let { perCellBound * it }
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
