import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt
enum BoardConfigFlagField: String, CaseIterable {
  case ledsOn = "leds.on"
  case headlightsOn = "leds.headlights_on"

  var id: String { rawValue }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt
enum BoardConfigNumberField: String, CaseIterable {
  case faultAdc1 = "fault_adc1"
  case faultAdc2 = "fault_adc2"
  case tiltbackLv = "tiltback_lv"
  case tiltbackHv = "tiltback_hv"
  case tiltbackDuty = "tiltback_duty"

  var id: String { rawValue }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigFields.kt `encodeFlag`
func encodeFlag(_ type: RefloatConfigValueType, _ enabled: Bool) -> Any {
  type == .bool ? enabled : (enabled ? 1.0 : 0.0)
}
