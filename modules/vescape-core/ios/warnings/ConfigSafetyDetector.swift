import Foundation

/// One config-safety finding to report through the Board Warning registry.
struct ConfigSafetyFinding {
  let kind: BoardWarningKind
  let severity: BoardWarningSeverity
  let payloadJson: String
}

/// Outcome of one config evaluation. `findings` are the rules that tripped; `cleanKinds` are the rules
/// that evaluated with real data and were fine (so the registry auto-clears them, fault-code model). A
/// rule whose inputs were absent appears in neither list — it is skipped, leaving any stored warning
/// untouched.
struct ConfigSafetyReport {
  let findings: [ConfigSafetyFinding]
  let cleanKinds: [BoardWarningKind]
}

/// Config-scoped Board Warning detector: pure rules over the decoded Refloat safety config plus the
/// board's configured battery series count. Pure evaluation logic per the pure-native-logic ADR; the
/// background config read, series-count lookup, and registry reporting stay in the session controller.
///
/// Thresholds are native constants. The pushback voltage rules (LV/HV) read `tiltback_lv`
/// / `tiltback_hv` in whichever units the firmware uses: Refloat on VESC 6.05+ stores a **per-cell**
/// value (compared directly against the per-cell bound), older firmware stores a **pack** value
/// (compared against `bound × series`, so it needs the series count). `usesPerCellVoltage` resolves the
/// mode from the firmware string; when it cannot (`perCell` nil) — or when pack mode lacks a series
/// count — those two rules are skipped. A rule whose config field is missing from the schema is likewise
/// skipped. Every payload carries the offending parameter, its current value, and the safe bound so the
/// UI can explain the finding.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/ConfigSafetyDetector.kt
enum ConfigSafetyDetector {
  /// Minimum safe low-voltage pushback per cell (V). Pack-mode bound is `this × series`.
  static let cellLvMinV = 3.0
  /// Maximum safe high-voltage pushback per cell (V). Pack-mode bound is `this × series`.
  static let cellHvMaxV = 4.3
  /// Maximum safe duty-cycle pushback threshold (fraction). VESC max duty is 0.95.
  static let dutyMax = 0.85

  /// First VESC firmware (major, minor) that stores `tiltback_lv`/`tiltback_hv` as per-cell values.
  private static let perCellFwMajor = 6
  private static let perCellFwMinor = 5

  /// Whether the firmware stores the pushback voltages per-cell (VESC 6.05+) rather than as a pack
  /// total. Returns nil when the firmware string is absent or unparseable, so the caller skips the
  /// voltage rules rather than guessing the units.
  static func usesPerCellVoltage(_ fwVersion: String?) -> Bool? {
    guard let fwVersion,
          let match = fwVersion.range(of: #"(\d+)\.(\d+)"#, options: .regularExpression)
    else { return nil }
    let parts = fwVersion[match].split(separator: ".")
    guard parts.count == 2, let major = Int(parts[0]), let minor = Int(parts[1]) else { return nil }
    return major > perCellFwMajor || (major == perCellFwMajor && minor >= perCellFwMinor)
  }

  /// Schema field ids the rules read off the Board Config Values map. A field absent from the map
  /// (missing from the schema, truncated, or unparseable) skips its rule.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/ConfigSafetyDetector.kt
  static let faultAdc1Id = "fault_adc1"
  static let faultAdc2Id = "fault_adc2"
  static let tiltbackLvId = "tiltback_lv"
  static let tiltbackHvId = "tiltback_hv"
  static let tiltbackDutyId = "tiltback_duty"
  static let movingFaultDisabledId = "fault_moving_fault_disabled"

  static func evaluate(_ values: BoardConfigValues, seriesCount: Int?, perCell: Bool?) -> ConfigSafetyReport {
    var findings: [ConfigSafetyFinding] = []
    var clean: [BoardWarningKind] = []

    // footpad-disabled (critical): both ADC switch voltages 0 disables the footpad switch entirely.
    if let adc1 = values.number(faultAdc1Id), let adc2 = values.number(faultAdc2Id) {
      if adc1 == 0.0, adc2 == 0.0 {
        findings.append(finding(.footpadDisabled, .critical, "\(faultAdc1Id)/\(faultAdc2Id)", 0.0, 0.0))
      } else {
        clean.append(.footpadDisabled)
      }
    }

    // lv-pushback-low (critical): LV pushback below the safe minimum, in the firmware's voltage units.
    if let lv = values.number(tiltbackLvId), let bound = voltageBound(cellLvMinV, perCell, seriesCount) {
      if lv < bound {
        findings.append(finding(.lvPushbackLow, .critical, tiltbackLvId, lv, bound))
      } else {
        clean.append(.lvPushbackLow)
      }
    }

    // hv-pushback-high (warn): HV pushback above the safe maximum, in the firmware's voltage units.
    if let hv = values.number(tiltbackHvId), let bound = voltageBound(cellHvMaxV, perCell, seriesCount) {
      if hv > bound {
        findings.append(finding(.hvPushbackHigh, .warn, tiltbackHvId, hv, bound))
      } else {
        clean.append(.hvPushbackHigh)
      }
    }

    // duty-pushback-high (warn): duty pushback threshold set dangerously close to the duty limit.
    if let duty = values.number(tiltbackDutyId) {
      if duty > dutyMax {
        findings.append(finding(.dutyPushbackHigh, .warn, tiltbackDutyId, duty, dutyMax))
      } else {
        clean.append(.dutyPushbackHigh)
      }
    }

    // moving-fault-disabled (warn): moving faults disabled weakens fault protection while riding.
    if let movingFault = values.bool(movingFaultDisabledId) {
      if movingFault {
        findings.append(finding(.movingFaultDisabled, .warn, movingFaultDisabledId, 1.0, 0.0))
      } else {
        clean.append(.movingFaultDisabled)
      }
    }

    return ConfigSafetyReport(findings: findings, cleanKinds: clean)
  }

  /// The safe voltage bound in the firmware's units: the per-cell constant directly (per-cell
  /// firmware), or `× series` (pack firmware). Nil when the mode is unknown, or pack mode has no series
  /// count — the caller then skips the rule.
  private static func voltageBound(_ perCellBound: Double, _ perCell: Bool?, _ seriesCount: Int?) -> Double? {
    switch perCell {
    case .some(true): return perCellBound
    case .some(false): return seriesCount.map { perCellBound * Double($0) }
    case .none: return nil
    }
  }

  private static func finding(
    _ kind: BoardWarningKind,
    _ severity: BoardWarningSeverity,
    _ param: String,
    _ value: Double,
    _ bound: Double
  ) -> ConfigSafetyFinding {
    ConfigSafetyFinding(kind: kind, severity: severity, payloadJson: payloadJson(param, value, bound))
  }

  private static func payloadJson(_ param: String, _ value: Double, _ bound: Double) -> String {
    BoardWarningPayload.json([
      "param": param,
      "value": BoardWarningPayload.round4(value),
      "bound": BoardWarningPayload.round4(bound),
    ])
  }
}
