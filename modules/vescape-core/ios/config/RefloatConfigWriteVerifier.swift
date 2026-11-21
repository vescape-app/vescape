import Foundation

enum RefloatConfigWriteVerification {
  case success
  case failure(String)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigWriteVerifier.kt
enum RefloatConfigWriteVerifier {
  static func verifyExactBytes(expected: [UInt8], actual: [UInt8]) -> RefloatConfigWriteVerification {
    if expected == actual { return .success }

    if expected.count != actual.count {
      return .failure(
        "Verification failed: expected \(expected.count) bytes, read back \(actual.count) bytes"
      )
    }

    let firstMismatch = expected.indices.first { expected[$0] != actual[$0] } ?? 0
    return .failure("Verification failed: first byte mismatch at offset \(firstMismatch)")
  }
}
