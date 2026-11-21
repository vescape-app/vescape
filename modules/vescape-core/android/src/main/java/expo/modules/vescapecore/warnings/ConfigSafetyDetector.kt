package expo.modules.vescapecore.warnings

import expo.modules.vescapecore.config.BoardConfigFlagField
import expo.modules.vescapecore.config.BoardConfigNumberField
import expo.modules.vescapecore.config.BoardConfigValues

data class ConfigSafetyFinding(
  val kind: BoardWarningKind,
  val severity: BoardWarningSeverity,
  val payloadJson: String,
)

data class ConfigSafetyReport(
  val findings: List<ConfigSafetyFinding>,
  val cleanKinds: List<BoardWarningKind>,
)

/**
 * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetector.swift
 */
object ConfigSafetyDetector {
  const val CELL_LV_MIN_V = 3.0

  const val CELL_HV_MAX_V = 4.3

  const val DUTY_MAX = 0.85

  private const val PER_CELL_FW_MAJOR = 6
  private const val PER_CELL_FW_MINOR = 5

  private val fwVersionPattern = Regex("""(\d+)\.(\d+)""")

  fun supportsPerCellVoltage(fwVersion: String?): Boolean? {
    val match = fwVersion?.let { fwVersionPattern.find(it) } ?: return null
    val major = match.groupValues[1].toIntOrNull() ?: return null
    val minor = match.groupValues[2].toIntOrNull() ?: return null
    return major > PER_CELL_FW_MAJOR || (major == PER_CELL_FW_MAJOR && minor >= PER_CELL_FW_MINOR)
  }

  /**
   * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetector.swift
   */
  val FAULT_ADC1_ID = BoardConfigNumberField.FAULT_ADC1.id
  val FAULT_ADC2_ID = BoardConfigNumberField.FAULT_ADC2.id
  val TILTBACK_LV_ID = BoardConfigNumberField.TILTBACK_LV.id
  val TILTBACK_HV_ID = BoardConfigNumberField.TILTBACK_HV.id
  val TILTBACK_DUTY_ID = BoardConfigNumberField.TILTBACK_DUTY.id

  internal fun evaluate(values: BoardConfigValues, seriesCount: Int?, perCell: Boolean?): ConfigSafetyReport {
    val findings = mutableListOf<ConfigSafetyFinding>()
    val clean = mutableListOf<BoardWarningKind>()

    val adc1 = values.number(BoardConfigNumberField.FAULT_ADC1)
    val adc2 = values.number(BoardConfigNumberField.FAULT_ADC2)
    if (adc1 != null && adc2 != null) {
      if (adc1 == 0.0 && adc2 == 0.0) {
        findings += finding(BoardWarningKind.FOOTPAD_DISABLED, BoardWarningSeverity.CRITICAL, "$FAULT_ADC1_ID/$FAULT_ADC2_ID", 0.0, 0.0)
      } else {
        clean += BoardWarningKind.FOOTPAD_DISABLED
      }
    }

    val lv = values.number(BoardConfigNumberField.TILTBACK_LV)
    val lvBound = voltageBound(lv, CELL_LV_MIN_V, perCell, seriesCount)
    if (lv != null && lvBound != null) {
      if (lv < lvBound) {
        findings += finding(BoardWarningKind.LV_PUSHBACK_LOW, BoardWarningSeverity.CRITICAL, TILTBACK_LV_ID, lv, lvBound)
      } else {
        clean += BoardWarningKind.LV_PUSHBACK_LOW
      }
    }

    val hv = values.number(BoardConfigNumberField.TILTBACK_HV)
    val hvBound = voltageBound(hv, CELL_HV_MAX_V, perCell, seriesCount)
    if (hv != null && hvBound != null) {
      if (hv > hvBound) {
        findings += finding(BoardWarningKind.HV_PUSHBACK_HIGH, BoardWarningSeverity.WARN, TILTBACK_HV_ID, hv, hvBound)
      } else {
        clean += BoardWarningKind.HV_PUSHBACK_HIGH
      }
    }

    val duty = values.number(BoardConfigNumberField.TILTBACK_DUTY)
    if (duty != null) {
      if (duty > DUTY_MAX) {
        findings += finding(BoardWarningKind.DUTY_PUSHBACK_HIGH, BoardWarningSeverity.WARN, TILTBACK_DUTY_ID, duty, DUTY_MAX)
      } else {
        clean += BoardWarningKind.DUTY_PUSHBACK_HIGH
      }
    }

    return ConfigSafetyReport(findings, clean)
  }

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
