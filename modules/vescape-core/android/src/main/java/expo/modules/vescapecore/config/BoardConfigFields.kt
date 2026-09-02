package expo.modules.vescapecore.config

/**
 * The Refloat config fields Vescape reads or rebases by name, as a closed set.
 *
 * Field *layout* stays runtime truth: offsets, widths and encodings come from the board's own schema
 * XML, because a fork or a custom build may lay the struct out differently than any released tag.
 * Field *identity* does not — the ids below are ours, they change only when we decide to operate on
 * something new, and a typo in one is a compile error rather than a silently absent map key.
 *
 * Refloat declares its on/off fields as numeric config params (`type 5` decodes as
 * [RefloatConfigValueType.INT8]), so a decoded flag is a `Double`, never a `Boolean`. Reading one
 * with a bool accessor returns null and writing one as a `Boolean` poisons the config-change
 * baseline with a value that differs from every later read on runtime type alone. Both mistakes are
 * unrepresentable through [BoardConfigValues.flag] and [BoardConfigValues.withFlag].
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigFields.swift
 */
internal enum class BoardConfigFlagField(val id: String) {
  LEDS_ON("leds.on"),
  HEADLIGHTS_ON("leds.headlights_on"),
}

/**
 * The Refloat config fields Vescape reads as numbers, as a closed set. Same contract as
 * [BoardConfigFlagField]: ours to name, the board's to lay out.
 *
 * These back Board Warnings, so an id that stops resolving does not misreport — it silently stops
 * evaluating, and a critical warning quietly never fires again. `BoardConfigFieldsTest` resolves every
 * one against each supported firmware for exactly that reason.
 *
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
 * The runtime representation a flag takes for [type], matching what [RefloatConfigDecoder] produces
 * for the same field. The one place that decides how a flag is spelled inside
 * [BoardConfigValues.values].
 *
 * @parity /modules/vescape-core/ios/config/BoardConfigFields.swift `encodeFlag`
 */
internal fun encodeFlag(type: RefloatConfigValueType, enabled: Boolean): Any =
  if (type == RefloatConfigValueType.BOOL) enabled else if (enabled) 1.0 else 0.0
