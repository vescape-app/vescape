import CoreFoundation
import Foundation

/// @parity /src/modules/alerts/lib/configRelativeFields.ts
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/ConfigRelativeFields.kt
enum BoardConfigSource {
  case refloat
  case motor
}

struct ConfigRelativeField {
  let source: BoardConfigSource
  let scale: Double
  let disabledAtOrAbove: Double?
}

let configRelativeFields: [String: ConfigRelativeField] = [
  "tiltback_duty": ConfigRelativeField(source: .refloat, scale: 100, disabledAtOrAbove: 1),
  "l_temp_fet_start": ConfigRelativeField(source: .motor, scale: 1, disabledAtOrAbove: nil),
  "l_temp_motor_start": ConfigRelativeField(source: .motor, scale: 1, disabledAtOrAbove: nil),
]

/// @parity /src/modules/alerts/lib/configRelativeFields.ts `resolveConfigRelativeBase`
func resolveConfigRelativeBase(
  _ fieldId: String?,
  refloat: [String: Any],
  motor: [String: Any]
) -> Double? {
  guard let fieldId, let field = configRelativeFields[fieldId] else { return nil }
  let source = field.source == .refloat ? refloat : motor
  guard let number = source[fieldId] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
  let raw = number.doubleValue
  guard raw.isFinite, raw > 0 else { return nil }
  if let disabled = field.disabledAtOrAbove, raw >= disabled { return nil }
  return raw * field.scale
}
