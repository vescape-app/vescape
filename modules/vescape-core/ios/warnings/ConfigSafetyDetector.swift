import Foundation

struct ConfigSafetyFinding {
  let kind: BoardWarningKind
  let severity: BoardWarningSeverity
  let payloadJson: String
}

struct ConfigSafetyReport {
  let findings: [ConfigSafetyFinding]
  let cleanKinds: [BoardWarningKind]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/ConfigSafetyDetector.kt
enum ConfigSafetyDetector {
  static let cellLvMinV = 3.0
  static let cellHvMaxV = 4.3
  static let dutyMax = 0.85

  private static let perCellFwMajor = 6
  private static let perCellFwMinor = 5

  static func supportsPerCellVoltage(_ fwVersion: String?) -> Bool? {
    guard let fwVersion,
          let match = fwVersion.range(of: #"(\d+)\.(\d+)"#, options: .regularExpression)
    else { return nil }
    let parts = fwVersion[match].split(separator: ".")
    guard parts.count == 2, let major = Int(parts[0]), let minor = Int(parts[1]) else { return nil }
    return major > perCellFwMajor || (major == perCellFwMajor && minor >= perCellFwMinor)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/ConfigSafetyDetector.kt
  static let faultAdc1Id = BoardConfigNumberField.faultAdc1.id
  static let faultAdc2Id = BoardConfigNumberField.faultAdc2.id
  static let tiltbackLvId = BoardConfigNumberField.tiltbackLv.id
  static let tiltbackHvId = BoardConfigNumberField.tiltbackHv.id
  static let tiltbackDutyId = BoardConfigNumberField.tiltbackDuty.id

  static func evaluate(_ values: BoardConfigValues, seriesCount: Int?, perCell: Bool?) throws -> ConfigSafetyReport {
    var findings: [ConfigSafetyFinding] = []
    var clean: [BoardWarningKind] = []

    if let adc1 = values.number(BoardConfigNumberField.faultAdc1), let adc2 = values.number(BoardConfigNumberField.faultAdc2) {
      if adc1 == 0.0, adc2 == 0.0 {
        findings.append(try finding(.footpadDisabled, .critical, "\(faultAdc1Id)/\(faultAdc2Id)", 0.0, 0.0))
      } else {
        clean.append(.footpadDisabled)
      }
    }

    if let lv = values.number(BoardConfigNumberField.tiltbackLv), let bound = voltageBound(lv, cellLvMinV, perCell, seriesCount) {
      if lv < bound {
        findings.append(try finding(.lvPushbackLow, .critical, tiltbackLvId, lv, bound))
      } else {
        clean.append(.lvPushbackLow)
      }
    }

    if let hv = values.number(BoardConfigNumberField.tiltbackHv), let bound = voltageBound(hv, cellHvMaxV, perCell, seriesCount) {
      if hv > bound {
        findings.append(try finding(.hvPushbackHigh, .warn, tiltbackHvId, hv, bound))
      } else {
        clean.append(.hvPushbackHigh)
      }
    }

    if let duty = values.number(BoardConfigNumberField.tiltbackDuty) {
      if duty > dutyMax {
        findings.append(try finding(.dutyPushbackHigh, .warn, tiltbackDutyId, duty, dutyMax))
      } else {
        clean.append(.dutyPushbackHigh)
      }
    }

    return ConfigSafetyReport(findings: findings, cleanKinds: clean)
  }

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
  ) throws -> ConfigSafetyFinding {
    ConfigSafetyFinding(kind: kind, severity: severity, payloadJson: try payloadJson(param, value, bound))
  }

  private static func payloadJson(_ param: String, _ value: Double, _ bound: Double) throws -> String {
    try BoardWarningPayload.json([
      "param": param,
      "value": BoardWarningPayload.round4(value),
      "bound": BoardWarningPayload.round4(bound),
    ])
  }
}
