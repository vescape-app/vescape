import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfDecoder.kt
enum McconfDecodeResult {
  case decoded(signature: UInt32, firmware: String, values: [String: Double])
  case unknownSignature(signature: UInt32, byteCount: Int)
  case malformed(reason: String)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfDecoder.kt
enum McconfDecoder {
  static func decode(_ body: [UInt8]) -> McconfDecodeResult {
    if body.count < 4 {
      return .malformed(reason: "blob too short for a signature: \(body.count) bytes")
    }
    let signature = VescNumeric.uint32(body, 0)
    guard let layout = McconfLayouts.bySignature[signature] else {
      return .unknownSignature(signature: signature, byteCount: body.count)
    }
    if body.count != layout.totalBytes {
      return .malformed(
        reason: "blob is \(body.count) bytes, layout \(layout.firmware) needs \(layout.totalBytes)"
      )
    }

    var values: [String: Double] = Dictionary(minimumCapacity: layout.fields.count)
    for field in layout.fields {
      values[field.id] = readValue(body, field)
    }
    return .decoded(signature: signature, firmware: layout.firmware, values: values)
  }

  private static func readValue(_ bytes: [UInt8], _ field: McconfField) -> Double {
    switch field.type {
    case .u8: return Double(bytes[field.offset])
    case .u16: return Double(VescNumeric.uint16(bytes, field.offset))
    case .i16: return Double(VescNumeric.int16(bytes, field.offset))
    case .u32: return Double(VescNumeric.uint32(bytes, field.offset))
    case .i32: return Double(VescNumeric.int32(bytes, field.offset))
    case .f16: return Double(VescNumeric.int16(bytes, field.offset)) / field.scale
    case .f32Auto: return VescNumeric.float32Auto(bytes, field.offset)
    }
  }
}
