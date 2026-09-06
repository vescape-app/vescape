import Foundation

/// Outcome of decoding a `COMM_GET_MCCONF` blob.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfDecoder.kt
enum McconfDecodeResult {
  /// Signature resolved to a known layout and every field was read.
  case decoded(signature: UInt32, firmware: String, values: [String: Double])
  /// Well-formed blob, but no layout carries this signature. Report it so a table can be added.
  case unknownSignature(signature: UInt32, byteCount: Int)
  /// Blob too short to hold even a signature, or shorter than the layout it claims.
  case malformed(reason: String)
}

/// Decodes a `COMM_GET_MCCONF` blob against the layout its signature identifies.
///
/// The board serves no schema for motor config, so offsets come from tables generated from firmware's
/// own serializer (`McconfLayouts`). An unrecognized signature decodes nothing rather than guessing:
/// a plausible-looking wrong value is worse than an absent one (ADR 0036).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/McconfDecoder.kt
enum McconfDecoder {
  /// - Parameter body: the response payload with its leading command byte already stripped.
  static func decode(_ body: [UInt8]) -> McconfDecodeResult {
    if body.count < 4 {
      return .malformed(reason: "blob too short for a signature: \(body.count) bytes")
    }
    let signature = VescNumeric.uint32(body, 0)
    guard let layout = McconfLayouts.bySignature[signature] else {
      return .unknownSignature(signature: signature, byteCount: body.count)
    }
    // Exact, not "at least": a signature identifies one layout of one length. A longer blob means
    // the framing or the table is wrong, and decoding its prefix would return plausible garbage.
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
    case .u32: return Double(VescNumeric.uint32(bytes, field.offset))
    case .i32: return Double(VescNumeric.int32(bytes, field.offset))
    case .f16: return Double(VescNumeric.int16(bytes, field.offset)) / field.scale
    case .f32Auto: return VescNumeric.float32Auto(bytes, field.offset)
    }
  }
}
