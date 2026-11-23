import Foundation

enum RefloatConfigWriteVerification {
  case success
  case failure(String)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigWriteVerifier.kt
enum RefloatConfigWriteVerifier {
  private static let metaIsDefault = "meta.is_default"

  static func verify(schema: RefloatConfigSchema, written: [UInt8], readBack: [UInt8]) -> RefloatConfigWriteVerification {
    let expected = expectedReadBack(schema, written)
    if expected == readBack { return .success }

    if expected.count != readBack.count {
      return .failure(
        "Verification failed: expected \(expected.count) bytes, read back \(readBack.count) bytes"
      )
    }

    let firstMismatch = expected.indices.first { expected[$0] != readBack[$0] } ?? 0
    return .failure("Verification failed: first byte mismatch at offset \(firstMismatch)")
  }

  private static func expectedReadBack(_ schema: RefloatConfigSchema, _ written: [UInt8]) -> [UInt8] {
    guard schema.fields.contains(where: { $0.id == metaIsDefault }) else { return written }
    return (try? RefloatConfigEncoder.encode(schema: schema, rawConfig: written, fields: [metaIsDefault: 0])) ?? written
  }
}
