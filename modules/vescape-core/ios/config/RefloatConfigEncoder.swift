import Foundation

struct RefloatConfigEncodeException: Error {
  let code: RefloatConfigErrorCode
  let message: String
  init(_ code: RefloatConfigErrorCode, _ message: String) {
    self.code = code
    self.message = message
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt `FieldNumericRange`
struct FieldNumericRange: Equatable {
  let min: Double
  let max: Double
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt `EncodedChangeset`
struct EncodedChangeset {
  let rawConfig: [UInt8]
  let changedFieldIds: Set<String>
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigEncoder.kt
enum RefloatConfigEncoder {
  static func encode(
    schema: RefloatConfigSchema,
    rawConfig: [UInt8],
    fields: [String: Any]
  ) throws -> [UInt8] {
    try encodeChangeset(schema: schema, rawConfig: rawConfig, changes: fields).rawConfig
  }

  static func encodeChangeset(
    schema: RefloatConfigSchema,
    rawConfig: [UInt8],
    changes: [String: Any]
  ) throws -> EncodedChangeset {
    let byId = Dictionary(uniqueKeysWithValues: schema.fields.map { ($0.id, $0) })
    let validated: [(RefloatConfigSchemaField, [UInt8])] = try changes.map { fieldId, value in
      guard let field = byId[fieldId] else { throw invalid("unknown field \(fieldId)") }
      if value is NSNull { throw invalid("\(field.id) cannot be null") }
      let size = field.type.byteSize
      if field.offset < 0 || rawConfig.count < field.offset + size {
        throw RefloatConfigEncodeException(
          .CONFIG_ENCODE_FAILED,
          "config length \(rawConfig.count) < \(field.offset + size) for \(field.id)"
        )
      }
      let bytes = try encodeAndVerifyField(field, value)
      return (field, bytes)
    }

    let effectiveWrites = validated.filter { field, encodedBytes in
      !matchesExistingBytes(rawConfig, offset: field.offset, encodedBytes: encodedBytes)
    }

    if effectiveWrites.isEmpty {
      return EncodedChangeset(rawConfig: rawConfig, changedFieldIds: [])
    }

    var allowedOffsets = Set<Int>()
    for (field, encodedBytes) in effectiveWrites {
      for i in 0..<encodedBytes.count {
        let offset = field.offset + i
        if !allowedOffsets.insert(offset).inserted {
          throw RefloatConfigEncodeException(
            .CONFIG_ENCODE_FAILED,
            "overlapping field byte range at offset \(offset) for \(field.id)"
          )
        }
      }
    }

    var result = rawConfig
    for (field, encodedBytes) in effectiveWrites {
      for i in 0..<encodedBytes.count {
        result[field.offset + i] = encodedBytes[i]
      }
    }

    try assertOnlyAllowedBytesChanged(base: rawConfig, patched: result, allowedOffsets: allowedOffsets)
    return EncodedChangeset(
      rawConfig: result,
      changedFieldIds: Set(effectiveWrites.map { $0.0.id })
    )
  }

  static func effectiveRange(_ field: RefloatConfigSchemaField) throws -> FieldNumericRange? {
    if field.type == .bool { return nil }
    let wireMin: Double
    let wireMax: Double
    switch field.type {
    case .float32, .float32Auto:
      wireMin = -Double(Float.greatestFiniteMagnitude)
      wireMax = Double(Float.greatestFiniteMagnitude)
    case .float32Scaled:
      let scale = try requireScale(field)
      wireMin = Double(Int32.min) / scale
      wireMax = Double(Int32.max) / scale
    case .float16Scaled:
      let scale = try requireScale(field)
      wireMin = Double(Int16.min) / scale
      wireMax = Double(Int16.max) / scale
    case .int32:
      wireMin = Double(Int32.min)
      wireMax = Double(Int32.max)
    case .uint32:
      wireMin = 0
      wireMax = Double(UInt32.max)
    case .int16:
      wireMin = Double(Int16.min)
      wireMax = Double(Int16.max)
    case .uint16:
      wireMin = 0
      wireMax = Double(UInt16.max)
    case .int8:
      wireMin = Double(Int8.min)
      wireMax = Double(Int8.max)
    case .uint8:
      wireMin = 0
      wireMax = Double(UInt8.max)
    case .bool:
      return nil
    }
    let minVal = field.min.flatMap { $0.isFinite ? max(wireMin, $0) : nil } ?? wireMin
    let maxVal = field.max.flatMap { $0.isFinite ? min(wireMax, $0) : nil } ?? wireMax
    return FieldNumericRange(min: minVal, max: maxVal)
  }

  private static func encodeAndVerifyField(_ field: RefloatConfigSchemaField, _ value: Any) throws -> [UInt8] {
    let bits = try validateAndEncode(field, value)
    let bytes = toBytes(size: field.type.byteSize, bits: bits)
    let decoded = try decodeWireBytes(field, bytes)
    let roundTripBits = try encodeWireBits(field, decoded)
    if roundTripBits != bits {
      throw invalid("\(field.id) = \(value) failed wire round-trip")
    }
    return bytes
  }

  private static func decodeWireBytes(_ field: RefloatConfigSchemaField, _ bytes: [UInt8]) throws -> Any {
    var raw: UInt64 = 0
    for b in bytes { raw = (raw << 8) | UInt64(b) }
    switch field.type {
    case .float32:
      return Double(Float(bitPattern: UInt32(truncatingIfNeeded: raw)))
    case .float32Scaled:
      return Double(Int32(bitPattern: UInt32(truncatingIfNeeded: raw))) / (try requireScale(field))
    case .float32Auto:
      return decodeFloat32Auto(UInt32(truncatingIfNeeded: raw))
    case .float16Scaled:
      return Double(Int16(bitPattern: UInt16(truncatingIfNeeded: raw))) / (try requireScale(field))
    case .int32:
      return Double(Int32(bitPattern: UInt32(truncatingIfNeeded: raw)))
    case .uint32:
      return Double(UInt32(truncatingIfNeeded: raw))
    case .int16:
      return Double(Int16(bitPattern: UInt16(truncatingIfNeeded: raw)))
    case .uint16:
      return Double(UInt16(truncatingIfNeeded: raw))
    case .int8:
      return Double(Int8(bitPattern: UInt8(truncatingIfNeeded: raw)))
    case .uint8:
      return Double(UInt8(truncatingIfNeeded: raw))
    case .bool:
      return UInt8(truncatingIfNeeded: raw) != 0
    }
  }

  private static func decodeFloat32Auto(_ raw: UInt32) -> Double {
    let eRaw = (raw >> 23) & 0xff
    let sigI = raw & 0x7fffff
    let neg = (raw >> 31) != 0
    if eRaw == 0 && sigI == 0 { return 0.0 }
    let sig = Double(sigI) / (8_388_608.0 * 2.0) + 0.5
    let result = ldexp(sig, Int(eRaw) - 126)
    return neg ? -result : result
  }

  private static func isEnumField(_ field: RefloatConfigSchemaField) -> Bool {
    field.xmlType == 4 || (field.xmlType == nil && !field.enumNames.isEmpty)
  }

  private static func isIntegerType(_ type: RefloatConfigValueType) -> Bool {
    switch type {
    case .int32, .uint32, .int16, .uint16, .int8, .uint8: return true
    default: return false
    }
  }

  private static func validateAndEncode(_ field: RefloatConfigSchemaField, _ value: Any) throws -> UInt64 {
    if field.type == .bool {
      return try bool(field, value) ? 1 : 0
    }
    let n = try number(field, value)
    if isIntegerType(field.type) && n.rounded(.down) != n {
      throw invalid("\(field.id) expects an integer, got \(n)")
    }
    if isEnumField(field) && !field.enumNames.isEmpty {
      if n < 0 || n >= Double(field.enumNames.count) {
        throw invalid("\(field.id) = \(n) is outside enum range 0...\(field.enumNames.count - 1)")
      }
    }
    if let range = try effectiveRange(field), n < range.min || n > range.max {
      throw invalid("\(field.id) = \(n) is outside effective range \(range.min)...\(range.max)")
    }
    return try encodeWireBits(field, n)
  }

  private static func encodeWireBits(_ field: RefloatConfigSchemaField, _ value: Any) throws -> UInt64 {
    if field.type == .bool {
      return try bool(field, value) ? 1 : 0
    }
    let n = try number(field, value)
    switch field.type {
    case .float32:
      return UInt64(try floatValue(field, n).bitPattern)
    case .float32Auto:
      return UInt64(float32AutoBits(try floatValue(field, n)))
    case .float32Scaled:
      return try scaledInteger(field, n * requireScale(field), Int64(Int32.min), Int64(Int32.max))
    case .float16Scaled:
      return try scaledInteger(field, n * requireScale(field), Int64(Int16.min), Int64(Int16.max))
    case .int32:
      return try exactInteger(field, n, Int64(Int32.min), Int64(Int32.max))
    case .uint32:
      return try exactInteger(field, n, 0, Int64(UInt32.max))
    case .int16:
      return try exactInteger(field, n, Int64(Int16.min), Int64(Int16.max))
    case .uint16:
      return try exactInteger(field, n, 0, Int64(UInt16.max))
    case .int8:
      return try exactInteger(field, n, Int64(Int8.min), Int64(Int8.max))
    case .uint8:
      return try exactInteger(field, n, 0, Int64(UInt8.max))
    case .bool:
      return try bool(field, value) ? 1 : 0
    }
  }

  private static func toBytes(size: Int, bits: UInt64) -> [UInt8] {
    (0..<size).map { i in UInt8(truncatingIfNeeded: bits >> UInt64(8 * (size - 1 - i))) }
  }

  private static func matchesExistingBytes(_ rawConfig: [UInt8], offset: Int, encodedBytes: [UInt8]) -> Bool {
    for i in 0..<encodedBytes.count {
      if rawConfig[offset + i] != encodedBytes[i] { return false }
    }
    return true
  }

  private static func assertOnlyAllowedBytesChanged(
    base: [UInt8],
    patched: [UInt8],
    allowedOffsets: Set<Int>
  ) throws {
    if base.count != patched.count {
      throw RefloatConfigEncodeException(
        .CONFIG_ENCODE_FAILED,
        "patched config size \(patched.count) != base size \(base.count)"
      )
    }
    for i in base.indices {
      if !allowedOffsets.contains(i) && base[i] != patched[i] {
        throw RefloatConfigEncodeException(
          .CONFIG_ENCODE_FAILED,
          "unexpected byte mutation at offset \(i)"
        )
      }
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

  private static func floatValue(_ field: RefloatConfigSchemaField, _ number: Double) throws -> Float {
    guard abs(number) <= Double(Float.greatestFiniteMagnitude) else {
      throw invalid("\(field.id) = \(number) does not fit a float")
    }
    return Float(number)
  }

  private static func exactInteger(_ field: RefloatConfigSchemaField, _ value: Double, _ min: Int64, _ max: Int64) throws -> UInt64 {
    guard value.isFinite, value.rounded(.down) == value, value >= Double(min), value <= Double(max) else {
      throw invalid("\(field.id) = \(value) does not fit \(min)...\(max) on the wire")
    }
    return UInt64(bitPattern: Int64(value))
  }

  private static func scaledInteger(_ field: RefloatConfigSchemaField, _ value: Double, _ min: Int64, _ max: Int64) throws -> UInt64 {
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
    guard scale.isFinite, scale > 0 else {
      throw RefloatConfigEncodeException(.CONFIG_ENCODE_FAILED, "invalid scale \(scale) for \(field.id)")
    }
    return scale
  }

  private static func invalid(_ message: String) -> RefloatConfigEncodeException {
    RefloatConfigEncodeException(.CONFIG_VALUE_INVALID, message)
  }
}
