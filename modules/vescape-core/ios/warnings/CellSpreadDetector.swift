import Foundation

/// One cell-spread finding to report through the Board Warning registry.
struct CellSpreadFinding {
  let severity: BoardWarningSeverity
  let payloadJson: String
}

/// Telemetry-scoped Board Warning detector for smart-BMS cell-voltage spread. Pure evaluation logic
/// per the pure-native-logic ADR: a stateful tracker fed each ~4Hz BMS frame plus its charge-port
/// voltage; session wiring (registry reporting, session lifecycle) stays in the session controller.
///
/// Spread is `max − min` across valid cell-group voltages (finite and > 0, same filter as
/// `summarizeBms`); at least two valid groups are required — one cell has no spread. A finding fires
/// only once the spread has stayed over the warn threshold for a sustained window (`sustainMs`) — a
/// single-frame spike never fires. Sustain is tracked as time-over-threshold, not consecutive frames,
/// because the BMS frame rate is not guaranteed stable; a gap longer than `maxFrameGapMs` (a
/// reconnect or telemetry interruption) is treated as a break in continuity and restarts the episode,
/// so time we never observed does not count toward the sustain window.
///
/// Severity tiers on the session's peak sustained spread (warn at `warnThresholdV`, critical at
/// `criticalThresholdV`); the reported severity and peak are monotonic across the Board Session, so a
/// later, weaker sustained episode never downgrades a stored warning. Only sustained spread feeds the
/// peak, so a transient critical spike that never sustains cannot inflate a later warn finding.
/// Charging is context, not a separate warning kind, so charging sessions are evaluated the same way
/// and the payload records whether the finding occurred while charging and whether balancing was
/// active. The payload also carries the peak spread observed and the worst cell-group index (largest
/// absolute deviation from the pack average) at that peak; an already-fired warning keeps updating as
/// the peak climbs, so the registry's upsert path preserves `firstDetectedAt`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/CellSpreadDetector.kt
final class CellSpreadDetector {
  /// Spread ≥ this (V), sustained, fires a warn-level cell-spread warning. Field-tuned constant.
  ///
  /// @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_WARN_V`
  static let warnThresholdV = 0.20
  /// Peak sustained spread ≥ this (V) escalates the finding to critical.
  ///
  /// @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_CRITICAL_V`
  static let criticalThresholdV = 0.50
  /// Spread must stay over threshold at least this long before firing — filters transient spikes.
  static let sustainMs: Int64 = 3_000
  /// Inter-frame gap over this (ms) breaks sustain continuity — a reconnect / telemetry interruption.
  static let maxFrameGapMs: Int64 = 3_000
  /// Re-report an already-fired warning once the session peak climbs by at least this (V).
  static let reportPeakEpsilonV = 0.005
  /// Charger present when vCharge is finite and above this (V). Mirrors JS `isBmsCharging`.
  static let chargeDetectMinV = 10.0

  private let warnThresholdV: Double
  private let criticalThresholdV: Double
  private let sustainMs: Int64

  private var sawData = false
  private var fired = false
  private var overSinceMs: Int64?
  private var lastFrameMs: Int64?
  private var peakV = 0.0
  private var worstGroup = -1
  private var reportedPeakV = 0.0
  private var reportedSeverity: BoardWarningSeverity?

  init(
    warnThresholdV: Double = CellSpreadDetector.warnThresholdV,
    criticalThresholdV: Double = CellSpreadDetector.criticalThresholdV,
    sustainMs: Int64 = CellSpreadDetector.sustainMs
  ) {
    self.warnThresholdV = warnThresholdV
    self.criticalThresholdV = criticalThresholdV
    self.sustainMs = sustainMs
  }

  /// Reset all tracking for a fresh Board Session.
  func reset() {
    sawData = false
    fired = false
    overSinceMs = nil
    lastFrameMs = nil
    peakV = 0.0
    worstGroup = -1
    reportedPeakV = 0.0
    reportedSeverity = nil
  }

  /// Feed one smart-BMS frame. Returns a finding to report, or nil when nothing should be reported
  /// this frame (fewer than two usable cells, spread under threshold, sustain window not yet met, or
  /// the already fired warning has not meaningfully changed).
  func onFrame(
    cellVoltages: [Double],
    balancing: [Bool],
    vCharge: Double,
    atMs: Int64
  ) -> CellSpreadFinding? {
    var minV = Double.greatestFiniteMagnitude
    var maxV = -Double.greatestFiniteMagnitude
    var sum = 0.0
    var count = 0
    for v in cellVoltages {
      if !v.isFinite || v <= 0.0 { continue }
      if v < minV { minV = v }
      if v > maxV { maxV = v }
      sum += v
      count += 1
    }
    // Spread needs at least two valid cell groups; a single cell cannot be evaluated and must not
    // count as usable data (otherwise a lone cell would let a whole session read as clean).
    if count < 2 { return nil }
    sawData = true
    let gap = lastFrameMs.map { atMs - $0 }
    lastFrameMs = atMs
    let spread = maxV - minV

    if spread < warnThresholdV {
      // Under threshold: any in-flight sustain episode ends. A durable warning already stored stays
      // put — it clears only via a whole-session clean evaluation at session end, not on a dip.
      overSinceMs = nil
      return nil
    }

    // Start (or restart) the sustain window on a fresh crossing or after a continuity break — a long
    // gap means the intervening time was never observed, so it cannot count toward the sustain.
    if overSinceMs == nil || (gap.map { $0 > CellSpreadDetector.maxFrameGapMs } ?? false) {
      overSinceMs = atMs
    }
    if atMs - (overSinceMs ?? atMs) < sustainMs { return nil }

    // Sustained: fold this frame into the session's peak sustained spread (monotonic).
    if spread > peakV {
      peakV = spread
      worstGroup = worstGroupIndex(cellVoltages, average: sum / Double(count))
    }
    let severity: BoardWarningSeverity = peakV >= criticalThresholdV ? .critical : .warn
    let peakRose = peakV - reportedPeakV >= CellSpreadDetector.reportPeakEpsilonV
    if fired, severity == reportedSeverity, !peakRose { return nil }

    fired = true
    reportedPeakV = peakV
    reportedSeverity = severity
    let charging = vCharge.isFinite && vCharge > CellSpreadDetector.chargeDetectMinV
    let balancingActive = balancing.contains(true)
    return CellSpreadFinding(
      severity: severity,
      payloadJson: payloadJson(
        peakV: peakV,
        worstGroup: worstGroup,
        charging: charging,
        balancing: balancingActive
      )
    )
  }

  /// At session end: report a clean evaluation only when BMS data flowed, no sustained spread fired
  /// this session, and no over-threshold episode is in flight (the session did not end mid-spike).
  /// Transient spikes that already fell back under threshold do not block the clean clear; a session
  /// with no BMS data returns false so a previously stored warning is left untouched.
  func sessionEndClean() -> Bool { sawData && !fired && overSinceMs == nil }

  /// Cell group furthest (absolute) from the pack average — the group breaking away from the pack.
  private func worstGroupIndex(_ cellVoltages: [Double], average: Double) -> Int {
    var worst = -1
    var worstDeviation = -1.0
    for (index, v) in cellVoltages.enumerated() {
      if !v.isFinite || v <= 0.0 { continue }
      let deviation = abs(v - average)
      if deviation > worstDeviation {
        worstDeviation = deviation
        worst = index
      }
    }
    return worst
  }

  private func payloadJson(peakV: Double, worstGroup: Int, charging: Bool, balancing: Bool) -> String {
    BoardWarningPayload.json([
      "peakSpread": BoardWarningPayload.round4(peakV),
      "worstGroup": worstGroup,
      "charging": charging,
      "balancing": balancing,
    ])
  }
}
