package expo.modules.vescapecore.warnings

import kotlin.math.abs

/** One cell-spread finding to report through the Board Warning registry. */
data class CellSpreadFinding(val severity: BoardWarningSeverity, val payloadJson: String)

/**
 * Telemetry-scoped Board Warning detector for smart-BMS cell-voltage spread. Pure evaluation logic
 * per the pure-native-logic ADR: a stateful tracker fed each ~4Hz BMS frame plus its charge-port
 * voltage; session wiring (registry reporting, session lifecycle) stays in the session controller.
 *
 * Spread is `max − min` across valid cell-group voltages (finite and > 0, same filter as
 * `summarizeBms`); at least two valid groups are required — one cell has no spread. A finding fires
 * only once the spread has stayed over the warn threshold for a sustained window ([sustainMs]) — a
 * single-frame spike never fires. Sustain is tracked as time-over-threshold, not consecutive frames,
 * because the BMS frame rate is not guaranteed stable; a gap longer than [MAX_FRAME_GAP_MS] (a
 * reconnect or telemetry interruption) is treated as a break in continuity and restarts the episode,
 * so time we never observed does not count toward the sustain window.
 *
 * Severity tiers on the session's peak sustained spread (warn at [warnThresholdV], critical at
 * [criticalThresholdV]); the reported severity and peak are monotonic across the Board Session, so a
 * later, weaker sustained episode never downgrades a stored warning. Only sustained spread feeds the
 * peak, so a transient critical spike that never sustains cannot inflate a later warn finding.
 * Charging is context, not a separate warning kind, so charging sessions are evaluated the same way
 * and the payload records whether the finding occurred while charging and whether balancing was
 * active. The payload also carries the peak spread observed and the worst cell-group index (largest
 * absolute deviation from the pack average) at that peak; an already-fired warning keeps updating as
 * the peak climbs, so the registry's upsert path preserves `firstDetectedAt`.
 *
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

  /** Reset all tracking for a fresh Board Session. */
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

  /**
   * Feed one smart-BMS frame. Returns a finding to report, or null when nothing should be reported
   * this frame (fewer than two usable cells, spread under threshold, sustain window not yet met, or
   * the already fired warning has not meaningfully changed).
   */
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
    // Spread needs at least two valid cell groups; a single cell cannot be evaluated and must not
    // count as usable data (otherwise a lone cell would let a whole session read as clean).
    if (count < 2) return null
    sawData = true
    val gap = lastFrameMs?.let { atMs - it }
    lastFrameMs = atMs
    val spread = max - min

    if (spread < warnThresholdV) {
      // Under threshold: any in-flight sustain episode ends. A durable warning already stored stays
      // put — it clears only via a whole-session clean evaluation at session end, not on a dip.
      overSinceMs = null
      return null
    }

    // Start (or restart) the sustain window on a fresh crossing or after a continuity break — a long
    // gap means the intervening time was never observed, so it cannot count toward the sustain.
    if (overSinceMs == null || (gap != null && gap > MAX_FRAME_GAP_MS)) {
      overSinceMs = atMs
    }
    if (atMs - (overSinceMs ?: atMs) < sustainMs) return null

    // Sustained: fold this frame into the session's peak sustained spread (monotonic).
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

  /**
   * At session end: report a clean evaluation only when BMS data flowed, no sustained spread fired
   * this session, and no over-threshold episode is in flight (the session did not end mid-spike).
   * Transient spikes that already fell back under threshold do not block the clean clear; a session
   * with no BMS data returns false so a previously stored warning is left untouched.
   */
  fun sessionEndClean(): Boolean = sawData && !fired && overSinceMs == null

  /** Cell group furthest (absolute) from the pack average — the group breaking away from the pack. */
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
     * Spread ≥ this (V), sustained, fires a warn-level cell-spread warning. Field-tuned constant.
     *
     * @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_WARN_V`
     */
    const val WARN_THRESHOLD_V = 0.20

    /**
     * Peak sustained spread ≥ this (V) escalates the finding to critical.
     *
     * @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_CRITICAL_V`
     */
    const val CRITICAL_THRESHOLD_V = 0.50

    /** Spread must stay over threshold at least this long before firing — filters transient spikes. */
    const val SUSTAIN_MS = 3_000L

    /** Inter-frame gap over this (ms) breaks sustain continuity — a reconnect / telemetry interruption. */
    const val MAX_FRAME_GAP_MS = 3_000L

    /** Re-report an already-fired warning once the session peak climbs by at least this (V). */
    const val REPORT_PEAK_EPSILON_V = 0.005

    /** Charger present when vCharge is finite and above this (V). Mirrors JS `isBmsCharging`. */
    const val CHARGE_DETECT_MIN_V = 10.0
  }
}
