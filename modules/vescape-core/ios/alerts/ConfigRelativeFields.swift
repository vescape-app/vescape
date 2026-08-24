import Foundation

/// The board config fields an Alert Rule can anchor itself to, and what each one means.
///
/// A config-relative rule stores only a field id and an offset (ADR 0035): the relationship is the
/// durable truth, and the threshold is resolved against whatever the board currently reports.
/// Resolving needs two things the field id alone does not carry — which config the field lives in
/// and what units it is in — so they live here rather than on every rule. They are properties of the
/// VESC/Refloat field itself, not of the rider's rule.
///
/// @parity /src/modules/alerts/lib/configRelativeFields.ts
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/ConfigRelativeFields.kt
enum BoardConfigSource {
  case refloat
  case motor
}

struct ConfigRelativeField {
  let source: BoardConfigSource
  /// Multiplier taking the stored value into the metric's own units (duty 0.9 → 90%).
  let scale: Double
  /// The stored value at or above which the board's own protection is off — VESC treats a duty
  /// pushback of 1.0 as "never push back". Rules anchored to a disabled field stay dormant rather
  /// than resolving to a threshold the board will never act on. `nil`: no such sentinel.
  let disabledAtOrAbove: Double?
}

let configRelativeFields: [String: ConfigRelativeField] = [
  "tiltback_duty": ConfigRelativeField(source: .refloat, scale: 100, disabledAtOrAbove: 1),
  "l_temp_fet_start": ConfigRelativeField(source: .motor, scale: 1, disabledAtOrAbove: nil),
  "l_temp_motor_start": ConfigRelativeField(source: .motor, scale: 1, disabledAtOrAbove: nil),
]

/// The field's current value in the metric's units, or `nil` when it cannot anchor a rule — the
/// config was never read, the field is missing from this firmware's layout, or the board has that
/// protection switched off.
///
/// @parity /src/modules/alerts/lib/configRelativeFields.ts `resolveConfigRelativeBase`
func resolveConfigRelativeBase(
  _ fieldId: String?,
  refloat: [String: Any],
  motor: [String: Any]
) -> Double? {
  guard let fieldId, let field = configRelativeFields[fieldId] else { return nil }
  let source = field.source == .refloat ? refloat : motor
  guard let number = source[fieldId] as? NSNumber else { return nil }
  let raw = number.doubleValue
  guard raw.isFinite, raw > 0 else { return nil }
  if let disabled = field.disabledAtOrAbove, raw >= disabled { return nil }
  return raw * field.scale
}
