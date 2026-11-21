package expo.modules.vescapecore.config

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigFields.swift
 */
internal enum class BoardConfigFlagField(val id: String) {
  LEDS_ON("leds.on"),
  HEADLIGHTS_ON("leds.headlights_on"),
}

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigFields.swift
 */
internal enum class BoardConfigNumberField(val id: String) {
  FAULT_ADC1("fault_adc1"),
  FAULT_ADC2("fault_adc2"),
  TILTBACK_LV("tiltback_lv"),
  TILTBACK_HV("tiltback_hv"),
  TILTBACK_DUTY("tiltback_duty"),
}

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigFields.swift `encodeFlag`
 */
internal fun encodeFlag(type: RefloatConfigValueType, enabled: Boolean): Any =
  if (type == RefloatConfigValueType.BOOL) enabled else if (enabled) 1.0 else 0.0
