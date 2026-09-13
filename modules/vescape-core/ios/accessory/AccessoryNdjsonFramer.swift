import Foundation

/// Why framing ended the protocol session. Both are terminal: the transport disconnects and clears
/// its buffers rather than trying to resynchronise mid-stream.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/AccessoryNdjsonFramer.kt `AccessoryFramingError`
/// @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
enum AccessoryFramingError: String {
  case oversized
  case invalidUtf8 = "invalid-utf8"
}

/// Lines completed by one chunk, plus the failure that ended the stream if one did.
struct AccessoryFramingResult {
  let lines: [String]
  let failure: AccessoryFramingError?
}

/// Newline-delimited JSON reassembly for the Accessory link. BLE packet boundaries are not message
/// boundaries: one notification can carry half a line, several lines, or a byte that finishes a
/// multi-byte character started in the previous one.
///
/// Bounded by construction. The buffer can never hold more than `maxLineBytes`: the byte that would
/// take it past the limit fails the stream instead of being appended, so a peer that never sends an
/// LF costs a fixed 4 KB rather than growing until the process dies. A failure is terminal — the
/// buffer is dropped and every later chunk is refused, because a stream that lost its framing has
/// no trustworthy next boundary.
///
/// UTF-8 is validated per complete line, after reassembly, never per chunk.
///
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

  /// Bytes currently held for the line being assembled. Never exceeds `maxLineBytes`.
  var bufferedBytes: Int { buffer.count }

  var failed: Bool { failure != nil }

  func feed(_ chunk: [UInt8]) -> AccessoryFramingResult {
    if let failure { return AccessoryFramingResult(lines: [], failure: failure) }

    var lines: [String] = []
    for byte in chunk {
      if byte == Self.lineFeed {
        // An empty line is framing, not a message: the protocol sends one object per line, so a
        // stray LF carries nothing to decode.
        if !buffer.isEmpty {
          let bytes = buffer
          buffer.removeAll(keepingCapacity: true)
          // Strict on purpose: `String(bytes:encoding:)` returns nil on a malformed sequence,
          // where `String(decoding:as:)` would substitute replacement characters and hand the
          // parser a line the accessory never sent.
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

  /// Drops everything held. Called on disconnect so a new session starts with no old bytes.
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
