import Foundation

/// The Refloat config fields Vescape reads or rebases by name, as a closed set.
///
/// Field *layout* stays runtime truth: offsets, widths and encodings come from the board's own schema
/// XML, because a fork or a custom build may lay the struct out differently than any released tag.
/// Field *identity* does not — the ids below are ours, they change only when we decide to operate on
/// something new, and a typo in one is a compile error rather than a silently absent dictionary key.
///
/// Refloat declares its on/off fields as numeric config params (`type 5` decodes as
/// `RefloatConfigValueType.int8`), so a decoded flag is a `Double`, never a `Bool`. Reading one with a
/// bool accessor returns nil and writing one as a `Bool` poisons the config-change baseline with a
/// value that differs from every later read on runtime type alone. Both mistakes are unrepresentable
/// through `BoardConfigValues.flag(_:)` and `BoardConfigValues.withFlag(_:_:)`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt
enum BoardConfigFlagField: String, CaseIterable {
  case ledsOn = "leds.on"
  case headlightsOn = "leds.headlights_on"
  case movingFaultDisabled = "fault_moving_fault_disabled"

  var id: String { rawValue }
}

/// The Refloat config fields Vescape reads as numbers, as a closed set. Same contract as
/// `BoardConfigFlagField`: ours to name, the board's to lay out.
///
/// These back Board Warnings, so an id that stops resolving does not misreport — it silently stops
/// evaluating, and a critical warning quietly never fires again. `BoardConfigFieldsTests` resolves
/// every one against each supported firmware for exactly that reason.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt
enum BoardConfigNumberField: String, CaseIterable {
  case faultAdc1 = "fault_adc1"
  case faultAdc2 = "fault_adc2"
  case tiltbackLv = "tiltback_lv"
  case tiltbackHv = "tiltback_hv"
  case tiltbackDuty = "tiltback_duty"

  var id: String { rawValue }
}

/// The runtime representation a flag takes for `type`, matching what `RefloatConfigDecoder` produces
/// for the same field. The one place that decides how a flag is spelled inside
/// `BoardConfigValues.values`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt `encodeFlag`
func encodeFlag(_ type: RefloatConfigValueType, _ enabled: Bool) -> Any {
  type == .bool ? enabled : (enabled ? 1.0 : 0.0)
}
