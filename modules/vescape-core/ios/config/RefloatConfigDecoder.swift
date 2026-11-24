import Foundation

struct RefloatConfigDecodeException: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigDecoder.kt
enum RefloatConfigDecoder {
  static func decodeFieldMap(schema: RefloatConfigSchema, rawConfig: [UInt8]) -> [String: Any] {
    var values: [String: Any] = [:]
    for field in schema.fields {
      guard rawConfig.count >= field.offset + field.type.byteSize else { continue }
      // intentional-suppression: one malformed field must not discard other decoded fields
      guard let value = try? readValue(rawConfig, field) else { continue }
      if let double = value as? Double {
        if double.isFinite { values[field.id] = double }
        continue
      }
      values[field.id] = value
    }
    return values
  }

  static func decodeBoardConfigValues(
    schema: RefloatConfigSchema,
    configBytes: RefloatConfigBytes,
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAt: Int64
  ) throws -> BoardConfigValues {
    let requiredLength = schema.fields.map { $0.offset + $0.type.byteSize }.max() ?? 0
    if configBytes.config.count < requiredLength {
      throw RefloatConfigDecodeException(
        "CONFIG_DECODE_FAILED: config length \(configBytes.config.count) < \(requiredLength)"
      )
    }
    return BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAt,
      freshness: .fresh,
      values: decodeFieldMap(schema: schema, rawConfig: configBytes.config),
      writeBase: BoardConfigWriteBase(
        schema: schema,
        rawConfig: configBytes.config,
        packageSignature: configBytes.packageSignature
      )
    )
  }

  private static func readValue(_ bytes: [UInt8], _ field: RefloatConfigSchemaField) throws -> Any {
    switch field.type {
    case .float32:
      return Double(Float(bitPattern: VescNumeric.uint32(bytes, field.offset)))
    case .float32Scaled:
      let scale = try requireScale(field)
      return Double(Int32(bitPattern: VescNumeric.uint32(bytes, field.offset))) / scale
    case .float32Auto:
      return VescNumeric.float32Auto(bytes, field.offset)
    case .float16Scaled:
      let scale = try requireScale(field)
      return Double(Int16(bitPattern: VescNumeric.uint16(bytes, field.offset))) / scale
    case .int32:
      return Double(Int32(bitPattern: VescNumeric.uint32(bytes, field.offset)))
    case .uint32:
      return Double(VescNumeric.uint32(bytes, field.offset))
    case .int16:
      return Double(Int16(bitPattern: VescNumeric.uint16(bytes, field.offset)))
    case .uint16:
      return Double(VescNumeric.uint16(bytes, field.offset))
    case .int8:
      return Double(Int8(bitPattern: bytes[field.offset]))
    case .uint8:
      return Double(bytes[field.offset])
    case .bool:
      return bytes[field.offset] != 0
    }
  }

  private static func requireScale(_ field: RefloatConfigSchemaField) throws -> Double {
    guard let scale = field.scale else {
      throw RefloatConfigDecodeException("CONFIG_DECODE_FAILED: missing scale for \(field.id)")
    }
    return scale
  }
}
