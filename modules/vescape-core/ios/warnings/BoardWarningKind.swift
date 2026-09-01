import Foundation

/// Single source of every Board Warning kind slug. Detectors reference these instead of holding their
/// own per-detector constants, and the registry's typed report path accepts them, so a mistyped kind
/// is a compile error rather than a warning that silently renders as a raw slug. The `rawValue` string
/// is what crosses the bridge and is stored durably; it must stay in lockstep with the JS
/// `BoardWarningKind` union in `modules/vescape-core/src/index.ts`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningKind.kt
/// @parity /modules/vescape-core/src/index.ts `BoardWarningKind`
enum BoardWarningKind: String, CaseIterable {
  case cellSpread = "cell-spread"
  case batteryConfigMismatch = "battery-config-mismatch"
  case footpadDisabled = "footpad-disabled"
  case lvPushbackLow = "lv-pushback-low"
  case hvPushbackHigh = "hv-pushback-high"
  case dutyPushbackHigh = "duty-pushback-high"

  /// Kinds this app once emitted and no longer does. Their slug stays durable in the warnings table,
  /// so a retired kind would otherwise sit on a rider's board forever: nothing evaluates it, so
  /// nothing ever reports it clean. Every config evaluation clears them instead.
  ///
  /// `moving-fault-disabled` flagged Refloat's "Disable Moving Faults" as unsafe. It is a deliberate
  /// mitigation on boards with unreliable footpad sensors, so the warning said nothing a rider could
  /// act on.
  static let retiredWire = ["moving-fault-disabled"]
}

/// Two-level severity, fixed at detection time. Unknown wire values normalize to `warn`. Lives here in
/// the pure warning model (not on the GRDB-backed registry) so detectors and the pure-logic SPM target
/// can reference it without pulling in the durable store.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt `BoardWarningSeverity`
/// @parity /modules/vescape-core/src/index.ts `BoardWarningSeverity`
enum BoardWarningSeverity: String {
  case warn
  case critical

  static func fromWire(_ value: String) -> BoardWarningSeverity { BoardWarningSeverity(rawValue: value) ?? .warn }
}

/// Board Warning payload serialization: deterministic (sorted-key) JSON built via `JSONSerialization`,
/// never hand-assembled strings. Doubles are rounded to 4 decimals before insertion so raw float noise
/// (e.g. a `3.92 - 3.80` subtraction that lands on `0.11999999999999988`) never reaches the wire.
enum BoardWarningPayload {
  static func round4(_ value: Double) -> Double { (value * 10_000).rounded() / 10_000 }

  static func json(_ fields: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
          let string = String(data: data, encoding: .utf8)
    else { return "{}" }
    return string
  }
}
