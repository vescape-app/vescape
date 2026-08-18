package expo.modules.vescapecore.warnings

import expo.modules.vescapecore.config.BoardConfigFreshness
import expo.modules.vescapecore.config.BoardConfigValues
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Config-safety rule boundaries: each rule fires with the right severity + payload, clears when the
 * setting is safe, per-cell rules skip (report nothing) when they cannot resolve their bound, and the
 * pushback voltage rules follow the firmware's per-cell (6.05+) vs pack units. Payload assertions
 * decode the JSON (its key order is serializer-dependent) rather than matching an exact string.
 * @parity /modules/vescape-core/ios/warnings/ConfigSafetyDetectorTests.swift
 */
class ConfigSafetyDetectorTest {
  // Pack-voltage-mode safe config (older firmware): 15s → LV 45.0 V, HV 64.5 V.
  private fun values(
    faultAdc1: Double? = 2.0,
    faultAdc2: Double? = 2.0,
    tiltbackLv: Double? = 45.0,
    tiltbackHv: Double? = 64.5,
    tiltbackDuty: Double? = 0.80,
    movingFaultDisabled: Boolean? = false,
  ): BoardConfigValues {
    val map = mutableMapOf<String, Any>()
    faultAdc1?.let { map[ConfigSafetyDetector.FAULT_ADC1_ID] = it }
    faultAdc2?.let { map[ConfigSafetyDetector.FAULT_ADC2_ID] = it }
    tiltbackLv?.let { map[ConfigSafetyDetector.TILTBACK_LV_ID] = it }
    tiltbackHv?.let { map[ConfigSafetyDetector.TILTBACK_HV_ID] = it }
    tiltbackDuty?.let { map[ConfigSafetyDetector.TILTBACK_DUTY_ID] = it }
    movingFaultDisabled?.let { map[ConfigSafetyDetector.MOVING_FAULT_DISABLED_ID] = it }
    return BoardConfigValues(
      boardId = "board",
      refloatBaseVersion = "2.0",
      capturedAtMs = 0,
      freshness = BoardConfigFreshness.FRESH,
      values = map,
      writeBase = null,
    )
  }

  // Per-cell-mode safe config (VESC 6.05+): LV 3.0 V, HV 4.3 V, series-independent.
  private fun perCellValues(tiltbackLv: Double? = 3.0, tiltbackHv: Double? = 4.3) =
    values(tiltbackLv = tiltbackLv, tiltbackHv = tiltbackHv)

  private fun ConfigSafetyReport.finding(kind: BoardWarningKind): ConfigSafetyFinding? =
    findings.firstOrNull { it.kind == kind }

  private fun ConfigSafetyFinding.assertPayload(param: String, value: Double, bound: Double) {
    val json = JSONObject(payloadJson)
    assertEquals(param, json.getString("param"))
    assertEquals(value, json.getDouble("value"), 0.0)
    assertEquals(bound, json.getDouble("bound"), 0.0)
  }

  @Test
  fun usesPerCellVoltageResolvesFromFirmware() {
    assertEquals(true, ConfigSafetyDetector.usesPerCellVoltage("FW 6.05 · hw · cfg"))
    assertEquals(true, ConfigSafetyDetector.usesPerCellVoltage("FW 6.10"))
    assertEquals(true, ConfigSafetyDetector.usesPerCellVoltage("FW 7.00"))
    assertEquals(false, ConfigSafetyDetector.usesPerCellVoltage("FW 6.02"))
    assertEquals(false, ConfigSafetyDetector.usesPerCellVoltage("FW 5.03"))
    assertNull(ConfigSafetyDetector.usesPerCellVoltage(null))
    assertNull(ConfigSafetyDetector.usesPerCellVoltage("unknown"))
  }

  @Test
  fun allSafeReportsEveryKindClean() {
    val report = ConfigSafetyDetector.evaluate(values(), seriesCount = 15, perCell = false)
    assertTrue(report.findings.isEmpty())
    assertEquals(
      setOf(
        BoardWarningKind.FOOTPAD_DISABLED,
        BoardWarningKind.LV_PUSHBACK_LOW,
        BoardWarningKind.HV_PUSHBACK_HIGH,
        BoardWarningKind.DUTY_PUSHBACK_HIGH,
        BoardWarningKind.MOVING_FAULT_DISABLED,
      ),
      report.cleanKinds.toSet(),
    )
  }

  @Test
  fun footpadDisabledWhenBothAdcZero() {
    val report = ConfigSafetyDetector.evaluate(values(faultAdc1 = 0.0, faultAdc2 = 0.0), seriesCount = 15, perCell = false)
    val finding = report.finding(BoardWarningKind.FOOTPAD_DISABLED)!!
    assertEquals(BoardWarningSeverity.CRITICAL, finding.severity)
    finding.assertPayload("fault_adc1/fault_adc2", 0.0, 0.0)
  }

  @Test
  fun footpadCleanWhenOneAdcNonZero() {
    val report = ConfigSafetyDetector.evaluate(values(faultAdc1 = 0.0, faultAdc2 = 2.0), seriesCount = 15, perCell = false)
    assertNull(report.finding(BoardWarningKind.FOOTPAD_DISABLED))
    assertTrue(report.cleanKinds.contains(BoardWarningKind.FOOTPAD_DISABLED))
  }

  @Test
  fun footpadSkippedWhenAdcFieldMissing() {
    val report = ConfigSafetyDetector.evaluate(values(faultAdc2 = null), seriesCount = 15, perCell = false)
    assertNull(report.finding(BoardWarningKind.FOOTPAD_DISABLED))
    assertTrue(!report.cleanKinds.contains(BoardWarningKind.FOOTPAD_DISABLED))
  }

  @Test
  fun lvPushbackLowFiresBelowPackMinimum() {
    // Pack mode, 15s: safe minimum 45.0 V; 44.0 is unsafe.
    val report = ConfigSafetyDetector.evaluate(values(tiltbackLv = 44.0), seriesCount = 15, perCell = false)
    val finding = report.finding(BoardWarningKind.LV_PUSHBACK_LOW)!!
    assertEquals(BoardWarningSeverity.CRITICAL, finding.severity)
    finding.assertPayload("tiltback_lv", 44.0, 45.0)
  }

  @Test
  fun lvPushbackAtBoundIsClean() {
    val report = ConfigSafetyDetector.evaluate(values(tiltbackLv = 45.0), seriesCount = 15, perCell = false)
    assertNull(report.finding(BoardWarningKind.LV_PUSHBACK_LOW))
    assertTrue(report.cleanKinds.contains(BoardWarningKind.LV_PUSHBACK_LOW))
  }

  @Test
  fun hvPushbackHighFiresAbovePackMaximum() {
    // Pack mode, 15s: safe maximum 64.5 V; 66.0 is unsafe.
    val report = ConfigSafetyDetector.evaluate(values(tiltbackHv = 66.0), seriesCount = 15, perCell = false)
    val finding = report.finding(BoardWarningKind.HV_PUSHBACK_HIGH)!!
    assertEquals(BoardWarningSeverity.WARN, finding.severity)
    finding.assertPayload("tiltback_hv", 66.0, 64.5)
  }

  @Test
  fun perCellFirmwareComparesRawVoltageWithoutSeries() {
    // Per-cell mode (6.05+): the bound is the per-cell constant directly; series count is irrelevant.
    val clean = ConfigSafetyDetector.evaluate(perCellValues(), seriesCount = null, perCell = true)
    assertTrue(clean.cleanKinds.contains(BoardWarningKind.LV_PUSHBACK_LOW))
    assertTrue(clean.cleanKinds.contains(BoardWarningKind.HV_PUSHBACK_HIGH))

    val lvLow = ConfigSafetyDetector.evaluate(perCellValues(tiltbackLv = 2.9), seriesCount = null, perCell = true)
    val lv = lvLow.finding(BoardWarningKind.LV_PUSHBACK_LOW)!!
    assertEquals(BoardWarningSeverity.CRITICAL, lv.severity)
    lv.assertPayload("tiltback_lv", 2.9, 3.0)

    val hvHigh = ConfigSafetyDetector.evaluate(perCellValues(tiltbackHv = 4.5), seriesCount = null, perCell = true)
    val hv = hvHigh.finding(BoardWarningKind.HV_PUSHBACK_HIGH)!!
    assertEquals(BoardWarningSeverity.WARN, hv.severity)
    hv.assertPayload("tiltback_hv", 4.5, 4.3)
  }

  @Test
  fun perCellRulesSkippedWithoutSeriesCountInPackMode() {
    // Pack mode, dangerous LV/HV values, but no series count — the two rules must report nothing.
    val report = ConfigSafetyDetector.evaluate(
      values(tiltbackLv = 10.0, tiltbackHv = 90.0),
      seriesCount = null,
      perCell = false,
    )
    assertNull(report.finding(BoardWarningKind.LV_PUSHBACK_LOW))
    assertNull(report.finding(BoardWarningKind.HV_PUSHBACK_HIGH))
    assertTrue(!report.cleanKinds.contains(BoardWarningKind.LV_PUSHBACK_LOW))
    assertTrue(!report.cleanKinds.contains(BoardWarningKind.HV_PUSHBACK_HIGH))
    // The non-cell rules still evaluate.
    assertTrue(report.cleanKinds.contains(BoardWarningKind.DUTY_PUSHBACK_HIGH))
  }

  @Test
  fun voltageRulesSkippedWhenFirmwareModeUnknown() {
    // perCell null (unparseable firmware): units are ambiguous, so LV/HV report nothing even with series.
    val report = ConfigSafetyDetector.evaluate(values(tiltbackLv = 10.0, tiltbackHv = 90.0), seriesCount = 15, perCell = null)
    assertNull(report.finding(BoardWarningKind.LV_PUSHBACK_LOW))
    assertNull(report.finding(BoardWarningKind.HV_PUSHBACK_HIGH))
    assertTrue(!report.cleanKinds.contains(BoardWarningKind.LV_PUSHBACK_LOW))
    assertTrue(!report.cleanKinds.contains(BoardWarningKind.HV_PUSHBACK_HIGH))
    // The firmware-agnostic rules still evaluate.
    assertTrue(report.cleanKinds.contains(BoardWarningKind.DUTY_PUSHBACK_HIGH))
    assertTrue(report.cleanKinds.contains(BoardWarningKind.MOVING_FAULT_DISABLED))
  }

  @Test
  fun dutyPushbackHighFiresOverLimit() {
    val report = ConfigSafetyDetector.evaluate(values(tiltbackDuty = 0.90), seriesCount = 15, perCell = false)
    val finding = report.finding(BoardWarningKind.DUTY_PUSHBACK_HIGH)!!
    assertEquals(BoardWarningSeverity.WARN, finding.severity)
    finding.assertPayload("tiltback_duty", 0.9, 0.85)
  }

  @Test
  fun movingFaultDisabledFiresWhenOn() {
    val report = ConfigSafetyDetector.evaluate(values(movingFaultDisabled = true), seriesCount = 15, perCell = false)
    val finding = report.finding(BoardWarningKind.MOVING_FAULT_DISABLED)!!
    assertEquals(BoardWarningSeverity.WARN, finding.severity)
    finding.assertPayload("fault_moving_fault_disabled", 1.0, 0.0)
  }
}
