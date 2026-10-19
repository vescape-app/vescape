import CoreFoundation
import Foundation

struct RefloatConfigEncodeException: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// Patches Refloat config bytes with Tune Profile field values, big-endian, byte-for-byte identical
/// to the Android encoder so a write verifies against the same board readback.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt
enum RefloatConfigEncoder {
  static func encode(
    schema: RefloatConfigSchema,
    rawConfig: [UInt8],
    fields: [String: Any],
    strict: Bool = false
  ) throws -> [UInt8] {
    var result = rawConfig
    let byId = Dictionary(uniqueKeysWithValues: schema.fields.map { ($0.id, $0) })
    let allowed = Set(REFLOAT_TUNE_GROUPS.flatMap { $0.fields.map { $0.id } })
    for (fieldId, value) in fields {
      if strict, !allowed.contains(fieldId) { throw RefloatConfigEncodeException("Not a tune field: \(fieldId)") }
      guard let field = byId[fieldId] else {
        if strict { throw RefloatConfigEncodeException("Missing draft field in board schema: \(fieldId)") }
        continue
      }
      if strict, field.type != .bool {
        if let boxed = value as? NSNumber, CFGetTypeID(boxed) == CFBooleanGetTypeID() {
          throw RefloatConfigEncodeException("Draft numeric field cannot be Boolean: \(fieldId)")
        }
        let number = try toDouble(value)
        guard number.isFinite, field.min.map({ number >= $0 }) ?? true, field.max.map({ number <= $0 }) ?? true else {
          throw RefloatConfigEncodeException("Draft value outside firmware bounds: \(fieldId)")
        }
        let scaled = floor(number * (field.scale ?? 1) + 0.5)
        switch field.type {
        case .float16Scaled:
          guard scaled >= Double(Int16.min), scaled <= Double(Int16.max) else { throw RefloatConfigEncodeException("Draft value cannot be encoded: \(fieldId)") }
        case .float32Scaled:
          guard scaled >= Double(Int32.min), scaled <= Double(Int32.max) else { throw RefloatConfigEncodeException("Draft value cannot be encoded: \(fieldId)") }
        case .float32, .float32Auto:
          guard Float(number).isFinite else { throw RefloatConfigEncodeException("Draft value cannot be encoded: \(fieldId)") }
        default: break
        }
      }
      try writeValue(&result, field, value)
    }
    return result
  }

  private static func writeValue(_ bytes: inout [UInt8], _ field: RefloatConfigSchemaField, _ value: Any) throws {
    switch field.type {
    case .float32:
      putUInt32(&bytes, field.offset, Float(try toDouble(value)).bitPattern)
    case .float32Scaled:
      let scale = try requireScale(field)
      putUInt32(&bytes, field.offset, UInt32(bitPattern: int32Saturating(roundHalfUp(try toDouble(value) * scale))))
    case .float32Auto:
      writeFloat32Auto(&bytes, field.offset, try toDouble(value))
    case .float16Scaled:
      let scale = try requireScale(field)
      putUInt16(&bytes, field.offset, UInt16(truncatingIfNeeded: int32Saturating(roundHalfUp(try toDouble(value) * scale))))
    case .int32:
      putUInt32(&bytes, field.offset, UInt32(bitPattern: int32Saturating(try toDouble(value).rounded(.towardZero))))
    case .uint32:
      putUInt32(&bytes, field.offset, UInt32(truncatingIfNeeded: int64Saturating(try toDouble(value).rounded(.towardZero))))
    case .int16:
      putUInt16(&bytes, field.offset, UInt16(truncatingIfNeeded: int32Saturating(try toDouble(value).rounded(.towardZero))))
    case .uint16:
      putUInt16(&bytes, field.offset, UInt16(truncatingIfNeeded: int32Saturating(try toDouble(value).rounded(.towardZero))))
    case .int8:
      bytes[field.offset] = UInt8(truncatingIfNeeded: int32Saturating(try toDouble(value).rounded(.towardZero)))
    case .uint8:
      bytes[field.offset] = UInt8(truncatingIfNeeded: int32Saturating(try toDouble(value).rounded(.towardZero)))
    case .bool:
      bytes[field.offset] = try toBool(value) ? 1 : 0
    }
  }

  private static func writeFloat32Auto(_ bytes: inout [UInt8], _ offset: Int, _ value: Double) {
    if value == 0.0 {
      putUInt32(&bytes, offset, 0)
      return
    }
    let neg = value < 0.0
    let absVal = abs(value)
    let e = Int((log(absVal) / log(2.0)).rounded(.down)) + 126
    let eRaw = min(max(e, 0), 255)
    let sig = absVal / pow(2.0, Double(eRaw - 126)) - 0.5
    let sigI = min(max(Int(roundHalfUp(sig * 8_388_608.0 * 2.0)), 0), 0x7fffff)
    var raw = (UInt32(eRaw) << 23) | UInt32(sigI)
    if neg { raw |= (UInt32(1) << 31) }
    putUInt32(&bytes, offset, raw)
  }

  private static func requireScale(_ field: RefloatConfigSchemaField) throws -> Double {
    guard let scale = field.scale else {
      throw RefloatConfigEncodeException("CONFIG_ENCODE_FAILED: missing scale for \(field.id)")
    }
    return scale
  }

  private static func toDouble(_ value: Any) throws -> Double {
    switch value {
    case let v as Double: return v
    case let v as Float: return Double(v)
    case let v as Int: return Double(v)
    case let v as Int64: return Double(v)
    case let v as Bool: return v ? 1.0 : 0.0
    case let v as NSNumber: return v.doubleValue
    default:
      throw RefloatConfigEncodeException("CONFIG_ENCODE_FAILED: cannot convert \(value) to Double")
    }
  }

  private static func toBool(_ value: Any) throws -> Bool {
    switch value {
    case let v as Bool: return v
    case let v as Int: return v != 0
    case let v as Double: return v != 0.0
    case let v as NSNumber: return v.intValue != 0
    default:
      throw RefloatConfigEncodeException("CONFIG_ENCODE_FAILED: cannot convert \(value) to Boolean")
    }
  }

  /// Kotlin `roundToInt` rounds half toward positive infinity (`floor(x + 0.5)`); match it so scaled
  /// and auto-float fields serialize to identical bytes.
  private static func roundHalfUp(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

  private static func int32Saturating(_ value: Double) -> Int32 {
    if value >= Double(Int32.max) { return Int32.max }
    if value <= Double(Int32.min) { return Int32.min }
    return Int32(value)
  }

  private static func int64Saturating(_ value: Double) -> Int64 {
    if value >= Double(Int64.max) { return Int64.max }
    if value <= Double(Int64.min) { return Int64.min }
    return Int64(value)
  }

  private static func putUInt32(_ bytes: inout [UInt8], _ offset: Int, _ value: UInt32) {
    bytes[offset] = UInt8((value >> 24) & 0xff)
    bytes[offset + 1] = UInt8((value >> 16) & 0xff)
    bytes[offset + 2] = UInt8((value >> 8) & 0xff)
    bytes[offset + 3] = UInt8(value & 0xff)
  }

  private static func putUInt16(_ bytes: inout [UInt8], _ offset: Int, _ value: UInt16) {
    bytes[offset] = UInt8((value >> 8) & 0xff)
    bytes[offset + 1] = UInt8(value & 0xff)
  }
}
