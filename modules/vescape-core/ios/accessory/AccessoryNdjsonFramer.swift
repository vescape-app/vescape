import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryNdjsonFramer.kt `AccessoryFramingError`
/// @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
enum AccessoryFramingError: String {
  case oversized
  case invalidUtf8 = "invalid-utf8"
}

struct AccessoryFramingResult {
  let lines: [String]
  let failure: AccessoryFramingError?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryNdjsonFramer.kt
final class AccessoryNdjsonFramer {
  private static let lineFeed: UInt8 = 0x0A

  private let maxLineBytes: Int
  private var buffer: [UInt8] = []
  private var failure: AccessoryFramingError?

  init(maxLineBytes: Int = AccessoryProtocol.maxLineBytes) {
    self.maxLineBytes = maxLineBytes
    buffer.reserveCapacity(min(256, maxLineBytes))
  }

  var bufferedBytes: Int { buffer.count }

  var failed: Bool { failure != nil }

  func feed(_ chunk: [UInt8]) -> AccessoryFramingResult {
    if let failure { return AccessoryFramingResult(lines: [], failure: failure) }

    var lines: [String] = []
    for byte in chunk {
      if byte == Self.lineFeed {
        if !buffer.isEmpty {
          let bytes = buffer
          buffer.removeAll(keepingCapacity: true)
          guard let decoded = String(bytes: bytes, encoding: .utf8) else {
            return fail(lines, .invalidUtf8)
          }
          lines.append(decoded)
        }
        continue
      }
      if buffer.count == maxLineBytes { return fail(lines, .oversized) }
      buffer.append(byte)
    }
    return AccessoryFramingResult(lines: lines, failure: nil)
  }

  func reset() {
    buffer.removeAll(keepingCapacity: false)
    buffer.reserveCapacity(min(256, maxLineBytes))
    failure = nil
  }

  private func fail(_ lines: [String], _ error: AccessoryFramingError) -> AccessoryFramingResult {
    failure = error
    buffer.removeAll(keepingCapacity: false)
    return AccessoryFramingResult(lines: lines, failure: error)
  }
}
