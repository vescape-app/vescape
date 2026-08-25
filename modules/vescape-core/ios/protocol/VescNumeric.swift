import Foundation

/// Big-endian readers for VESC's wire encodings, shared by every config and telemetry decoder.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescNumeric.kt
enum VescNumeric {
  static func uint16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
    (UInt16(bytes[offset]) << 8) | UInt16(bytes[offset + 1])
  }

  static func int16(_ bytes: [UInt8], _ offset: Int) -> Int16 {
    Int16(bitPattern: uint16(bytes, offset))
  }

  static func uint32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16)
      | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
  }

  static func int32(_ bytes: [UInt8], _ offset: Int) -> Int32 {
    Int32(bitPattern: uint32(bytes, offset))
  }

  /// VESC's `buffer_get_float32_auto`: a packed sign/exponent/mantissa form that is deliberately
  /// not IEEE-754. Ported from upstream `util/buffer.c`.
  static func float32Auto(_ bytes: [UInt8], _ offset: Int) -> Double {
    let raw = uint32(bytes, offset)
    let eRaw = (raw >> 23) & 0xff
    let sigI = raw & 0x7fffff
    let neg = (raw >> 31) != 0
    if eRaw == 0 && sigI == 0 { return 0.0 }
    let sig = Double(sigI) / (8_388_608.0 * 2.0) + 0.5
    let result = sig * pow(2.0, Double(Int(eRaw) - 126))
    return neg ? -result : result
  }
}
