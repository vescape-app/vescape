package expo.modules.vescapecore.warnings

import kotlin.math.abs

data class CellSpreadFinding(val severity: BoardWarningSeverity, val payloadJson: String)

/**
 * @parity /modules/vescape-core/ios/warnings/CellSpreadDetector.swift
 */
class CellSpreadDetector(
  private val warnThresholdV: Double = WARN_THRESHOLD_V,
  private val criticalThresholdV: Double = CRITICAL_THRESHOLD_V,
  private val sustainMs: Long = SUSTAIN_MS,
) {
  private var sawData = false
  private var fired = false
  private var overSinceMs: Long? = null
  private var lastFrameMs: Long? = null
  private var peakV = 0.0
  private var worstGroup = -1
  private var reportedPeakV = 0.0
  private var reportedSeverity: BoardWarningSeverity? = null

  fun reset() {
    sawData = false
    fired = false
    overSinceMs = null
    lastFrameMs = null
    peakV = 0.0
    worstGroup = -1
    reportedPeakV = 0.0
    reportedSeverity = null
  }

  fun onFrame(
    cellVoltages: List<Double>,
    balancing: List<Boolean>,
    vCharge: Double,
    atMs: Long,
  ): CellSpreadFinding? {
    var min = Double.MAX_VALUE
    var max = -Double.MAX_VALUE
    var sum = 0.0
    var count = 0
    for (v in cellVoltages) {
      if (!v.isFinite() || v <= 0.0) continue
      if (v < min) min = v
      if (v > max) max = v
      sum += v
      count += 1
    }
    if (count < 2) return null
    sawData = true
    val gap = lastFrameMs?.let { atMs - it }
    lastFrameMs = atMs
    val spread = max - min

    if (spread < warnThresholdV) {
      overSinceMs = null
      return null
    }

    if (overSinceMs == null || (gap != null && gap > MAX_FRAME_GAP_MS)) {
      overSinceMs = atMs
    }
    if (atMs - (overSinceMs ?: atMs) < sustainMs) return null

    if (spread > peakV) {
      peakV = spread
      worstGroup = worstGroupIndex(cellVoltages, sum / count)
    }
    val severity =
      if (peakV >= criticalThresholdV) BoardWarningSeverity.CRITICAL else BoardWarningSeverity.WARN
    val peakRose = peakV - reportedPeakV >= REPORT_PEAK_EPSILON_V
    if (fired && severity == reportedSeverity && !peakRose) return null

    fired = true
    reportedPeakV = peakV
    reportedSeverity = severity
    val charging = vCharge.isFinite() && vCharge > CHARGE_DETECT_MIN_V
    val balancingActive = balancing.any { it }
    return CellSpreadFinding(severity, payloadJson(peakV, worstGroup, charging, balancingActive))
  }

  fun sessionEndClean(): Boolean = sawData && !fired && overSinceMs == null

  private fun worstGroupIndex(cellVoltages: List<Double>, average: Double): Int {
    var worst = -1
    var worstDeviation = -1.0
    cellVoltages.forEachIndexed { index, v ->
      if (!v.isFinite() || v <= 0.0) return@forEachIndexed
      val deviation = abs(v - average)
      if (deviation > worstDeviation) {
        worstDeviation = deviation
        worst = index
      }
    }
    return worst
  }

  private fun payloadJson(peakV: Double, worstGroup: Int, charging: Boolean, balancing: Boolean): String =
    boardWarningPayload {
      put("peakSpread", boardWarningRound4(peakV))
      put("worstGroup", worstGroup)
      put("charging", charging)
      put("balancing", balancing)
    }

  companion object {
    /**
     * @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_WARN_V`
     */
    const val WARN_THRESHOLD_V = 0.20

    /**
     * @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_CRITICAL_V`
     */
    const val CRITICAL_THRESHOLD_V = 0.50

    const val SUSTAIN_MS = 3_000L

    const val MAX_FRAME_GAP_MS = 3_000L

    const val REPORT_PEAK_EPSILON_V = 0.005

    const val CHARGE_DETECT_MIN_V = 10.0
  }
}
