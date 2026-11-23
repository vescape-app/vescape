import Foundation

struct RefloatConfigEncodeException: Error {
  let code: RefloatConfigErrorCode
  let message: String
  init(_ code: RefloatConfigErrorCode, _ message: String) {
    self.code = code
    self.message = message
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt
enum RefloatConfigEncoder {
  static func encode(
    schema: RefloatConfigSchema,
    rawConfig: [UInt8],
    fields: [String: Any]
  ) throws -> [UInt8] {
    let byId = Dictionary(uniqueKeysWithValues: schema.fields.map { ($0.id, $0) })
    let writes: [(RefloatConfigSchemaField, UInt64)] = try fields.map { fieldId, value in
      guard let field = byId[fieldId] else { throw invalid("unknown field \(fieldId)") }
      return (field, try wireBits(field, value))
    }
    var result = rawConfig
    for (field, bits) in writes { put(&result, field, bits) }
    return result
  }

  private static func wireBits(_ field: RefloatConfigSchemaField, _ value: Any) throws -> UInt64 {
    switch field.type {
    case .float32:
      return UInt64(try floatValue(field, value).bitPattern)
    case .float32Auto:
      return UInt64(float32AutoBits(try floatValue(field, value)))
    case .float32Scaled:
      return try integer(field, try number(field, value) * requireScale(field), Int64(Int32.min), Int64(Int32.max))
    case .float16Scaled:
      return try integer(field, try number(field, value) * requireScale(field), Int64(Int16.min), Int64(Int16.max))
    case .int32:
      return try integer(field, try number(field, value), Int64(Int32.min), Int64(Int32.max))
    case .uint32:
      return try integer(field, try number(field, value), 0, Int64(UInt32.max))
    case .int16:
      return try integer(field, try number(field, value), Int64(Int16.min), Int64(Int16.max))
    case .uint16:
      return try integer(field, try number(field, value), 0, Int64(UInt16.max))
    case .int8:
      return try integer(field, try number(field, value), Int64(Int8.min), Int64(Int8.max))
    case .uint8:
      return try integer(field, try number(field, value), 0, Int64(UInt8.max))
    case .bool:
      return try bool(field, value) ? 1 : 0
    }
  }

  private static func put(_ bytes: inout [UInt8], _ field: RefloatConfigSchemaField, _ bits: UInt64) {
    let size: Int
    switch field.type {
    case .float32, .float32Auto, .float32Scaled, .int32, .uint32: size = 4
    case .float16Scaled, .int16, .uint16: size = 2
    case .int8, .uint8, .bool: size = 1
    }
    for i in 0..<size {
      bytes[field.offset + i] = UInt8(truncatingIfNeeded: bits >> UInt64(8 * (size - 1 - i)))
    }
  }

  private enum Input {
    case number(Double)
    case bool(Bool)
  }

  private static func input(_ value: Any) -> Input? {
    guard let number = value as? NSNumber else { return nil }
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
    return .number(number.doubleValue)
  }

  private static func number(_ field: RefloatConfigSchemaField, _ value: Any) throws -> Double {
    guard case let .number(number) = input(value) else {
      throw invalid("\(field.id) expects a number, got \(value)")
    }
    guard number.isFinite else { throw invalid("\(field.id) is not finite") }
    return number
  }

  private static func floatValue(_ field: RefloatConfigSchemaField, _ value: Any) throws -> Float {
    let number = try number(field, value)
    guard abs(number) <= Double(Float.greatestFiniteMagnitude) else {
      throw invalid("\(field.id) = \(number) does not fit a float")
    }
    return Float(number)
  }

  private static func integer(_ field: RefloatConfigSchemaField, _ value: Double, _ min: Int64, _ max: Int64) throws -> UInt64 {
    let rounded = (value + 0.5).rounded(.down)
    guard rounded.isFinite, rounded >= Double(min), rounded <= Double(max) else {
      throw invalid("\(field.id) = \(value) does not fit \(min)...\(max) on the wire")
    }
    return UInt64(bitPattern: Int64(rounded))
  }

  private static func bool(_ field: RefloatConfigSchemaField, _ value: Any) throws -> Bool {
    switch input(value) {
    case let .bool(flag): return flag
    case .number(0): return false
    case .number(1): return true
    default: throw invalid("\(field.id) expects a boolean, got \(value)")
    }
  }

  private static func float32AutoBits(_ value: Float) -> UInt32 {
    let number: Float = abs(value) < 1.5e-38 ? 0 : value
    let (significand, frexpExponent) = frexp(number)
    let significandAbs = abs(significand)
    var exponent = frexpExponent
    var significandBits: UInt32 = 0
    if significandAbs >= 0.5 {
      significandBits = UInt32((significandAbs - 0.5) * 2 * 8_388_608)
      exponent += 126
    }
    var raw = (UInt32(truncatingIfNeeded: exponent & 0xff) << 23) | (significandBits & 0x7fffff)
    if number < 0 { raw |= (UInt32(1) << 31) }
    return raw
  }

  private static func requireScale(_ field: RefloatConfigSchemaField) throws -> Double {
    guard let scale = field.scale else {
      throw RefloatConfigEncodeException(.CONFIG_ENCODE_FAILED, "missing scale for \(field.id)")
    }
    return scale
  }

  private static func invalid(_ message: String) -> RefloatConfigEncodeException {
    RefloatConfigEncodeException(.CONFIG_VALUE_INVALID, message)
  }
}
