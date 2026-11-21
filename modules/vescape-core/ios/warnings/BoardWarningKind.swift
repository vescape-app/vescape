import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningKind.kt
/// @parity /modules/vescape-core/src/index.ts `BoardWarningKind`
enum BoardWarningKind: String, CaseIterable {
  case cellSpread = "cell-spread"
  case batteryConfigMismatch = "battery-config-mismatch"
  case footpadDisabled = "footpad-disabled"
  case lvPushbackLow = "lv-pushback-low"
  case hvPushbackHigh = "hv-pushback-high"
  case dutyPushbackHigh = "duty-pushback-high"

  static let retiredWire = ["moving-fault-disabled"]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt `BoardWarningSeverity`
/// @parity /modules/vescape-core/src/index.ts `BoardWarningSeverity`
enum BoardWarningSeverity: String {
  case warn
  case critical

  static func fromWire(_ value: String) -> BoardWarningSeverity { BoardWarningSeverity(rawValue: value) ?? .warn }
}

enum BoardWarningPayload {
  static func round4(_ value: Double) -> Double { (value * 10_000).rounded() / 10_000 }

  static func json(_ fields: [String: Any]) throws -> String {
    guard JSONSerialization.isValidJSONObject(fields) else {
      throw CocoaError(.propertyListWriteInvalid)
    }
    let data = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])
    guard let string = String(data: data, encoding: .utf8) else {
      throw CocoaError(.fileWriteInapplicableStringEncoding)
    }
    return string
  }
}
