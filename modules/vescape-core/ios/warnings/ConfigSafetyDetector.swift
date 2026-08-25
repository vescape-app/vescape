import Foundation

/// Decoded Refloat config values the safety rules evaluate. A `nil` field means the schema did not
/// carry it (or the raw config was too short) — the rules that need it are skipped, never guessed.
struct ConfigSafetyValues {
  let faultAdc1: Double?
  let faultAdc2: Double?
  let tiltbackLv: Double?
  let tiltbackHv: Double?
  let tiltbackDuty: Double?
  let movingFaultDisabled: Bool?
}

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
/// / `tiltback_hv` in whichever units the config value uses. Refloat on VESC 6.05+ supports both
/// **per-cell** values below 10 V and legacy **pack** totals; older firmware supports only pack totals.
/// `supportsPerCellVoltage` resolves firmware capability, then each value resolves its own units. When
/// capability is unknown (`perCell` nil), or when pack mode lacks a series
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

  /// First VESC firmware (major, minor) that supports per-cell `tiltback_lv`/`tiltback_hv` values.
  private static let perCellFwMajor = 6
  private static let perCellFwMinor = 5

  /// Whether the firmware supports per-cell pushback voltages (VESC 6.05+). Pack totals remain valid.
  /// Returns nil when the firmware string is absent or unparseable, so the caller skips the
  /// voltage rules rather than guessing the units.
  static func supportsPerCellVoltage(_ fwVersion: String?) -> Bool? {
    guard let fwVersion,
          let match = fwVersion.range(of: #"(\d+)\.(\d+)"#, options: .regularExpression)
    else { return nil }
    let parts = fwVersion[match].split(separator: ".")
    guard parts.count == 2, let major = Int(parts[0]), let minor = Int(parts[1]) else { return nil }
    return major > perCellFwMajor || (major == perCellFwMajor && minor >= perCellFwMinor)
  }

  static func evaluate(_ values: ConfigSafetyValues, seriesCount: Int?, perCell: Bool?) -> ConfigSafetyReport {
    var findings: [ConfigSafetyFinding] = []
    var clean: [BoardWarningKind] = []

    // footpad-disabled (critical): both ADC switch voltages 0 disables the footpad switch entirely.
    if let adc1 = values.faultAdc1, let adc2 = values.faultAdc2 {
      if adc1 == 0.0, adc2 == 0.0 {
        findings.append(finding(.footpadDisabled, .critical, "fault_adc1/fault_adc2", 0.0, 0.0))
      } else {
        clean.append(.footpadDisabled)
      }
    }

    // lv-pushback-low (critical): LV pushback below the safe minimum, in the firmware's voltage units.
    if let lv = values.tiltbackLv, let bound = voltageBound(lv, cellLvMinV, perCell, seriesCount) {
      if lv < bound {
        findings.append(finding(.lvPushbackLow, .critical, "tiltback_lv", lv, bound))
      } else {
        clean.append(.lvPushbackLow)
      }
    }

    // hv-pushback-high (warn): HV pushback above the safe maximum, in the firmware's voltage units.
    if let hv = values.tiltbackHv, let bound = voltageBound(hv, cellHvMaxV, perCell, seriesCount) {
      if hv > bound {
        findings.append(finding(.hvPushbackHigh, .warn, "tiltback_hv", hv, bound))
      } else {
        clean.append(.hvPushbackHigh)
      }
    }

    // duty-pushback-high (warn): duty pushback threshold set dangerously close to the duty limit.
    if let duty = values.tiltbackDuty {
      if duty > dutyMax {
        findings.append(finding(.dutyPushbackHigh, .warn, "tiltback_duty", duty, dutyMax))
      } else {
        clean.append(.dutyPushbackHigh)
      }
    }

    // moving-fault-disabled (warn): moving faults disabled weakens fault protection while riding.
    if let movingFault = values.movingFaultDisabled {
      if movingFault {
        findings.append(finding(.movingFaultDisabled, .warn, "fault_moving_fault_disabled", 1.0, 0.0))
      } else {
        clean.append(.movingFaultDisabled)
      }
    }

    return ConfigSafetyReport(findings: findings, cleanKinds: clean)
  }

  /// The safe voltage bound in the config value's units. Per-cell-capable firmware follows Refloat's
  /// rule: values below 10 V are per-cell, larger values are pack totals. Nil when firmware capability
  /// is unknown, or a pack total has no series count.
  private static func voltageBound(_ value: Double, _ perCellBound: Double, _ perCellSupported: Bool?, _ seriesCount: Int?) -> Double? {
    switch perCellSupported {
    case .some(true): return value < 10.0 ? perCellBound : seriesCount.map { perCellBound * Double($0) }
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
