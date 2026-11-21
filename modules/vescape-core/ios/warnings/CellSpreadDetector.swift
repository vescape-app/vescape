import Foundation

struct CellSpreadFinding {
  let severity: BoardWarningSeverity
  let payloadJson: String
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/CellSpreadDetector.kt
final class CellSpreadDetector {
  /// @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_WARN_V`
  static let warnThresholdV = 0.20
  /// @parity /src/modules/battery/lib/bms.ts `CELL_SPREAD_CRITICAL_V`
  static let criticalThresholdV = 0.50
  static let sustainMs: Int64 = 3_000
  static let maxFrameGapMs: Int64 = 3_000
  static let reportPeakEpsilonV = 0.005
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

  func onFrame(
    cellVoltages: [Double],
    balancing: [Bool],
    vCharge: Double,
    atMs: Int64
  ) throws -> CellSpreadFinding? {
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
    if count < 2 { return nil }
    sawData = true
    let gap = lastFrameMs.map { atMs - $0 }
    lastFrameMs = atMs
    let spread = maxV - minV

    if spread < warnThresholdV {
      overSinceMs = nil
      return nil
    }

    if overSinceMs == nil || (gap.map { $0 > CellSpreadDetector.maxFrameGapMs } ?? false) {
      overSinceMs = atMs
    }
    if atMs - (overSinceMs ?? atMs) < sustainMs { return nil }

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
      payloadJson: try payloadJson(
        peakV: peakV,
        worstGroup: worstGroup,
        charging: charging,
        balancing: balancingActive
      )
    )
  }

  func sessionEndClean() -> Bool { sawData && !fired && overSinceMs == nil }

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

  private func payloadJson(peakV: Double, worstGroup: Int, charging: Bool, balancing: Bool) throws -> String {
    try BoardWarningPayload.json([
      "peakSpread": BoardWarningPayload.round4(peakV),
      "worstGroup": worstGroup,
      "charging": charging,
      "balancing": balancing,
    ])
  }
}
