import Foundation

/// A row the server could never store. Permanent for this phone: retrying the same bytes cannot make
/// it succeed, so the engine pauses with the row retained rather than skipping it.
///
/// It names the table and the field only — never the value, which may be a coordinate, a Rider's
/// text or a token.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncJson.kt `SyncProtocolException`
struct SyncProtocolError: Error, Equatable {
  let table: SyncTable
  let field: String
  let problem: String
}

/// A compact JSON object writer that validates as it writes.
///
/// Deliberately not `JSONSerialization`: this has to produce the exact bytes measured against the
/// wire byte cap, in a stable field order. The bounds it enforces are the server's own
/// (`vescape-server` `src/sync/protocol.ts`), applied before transport so a wedged batch is
/// impossible rather than merely unlikely.
///
/// Nullable columns are written as explicit nulls: "cleared" and "not mentioned" are different
/// intents, and a missing key cannot express the first.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncJson.kt `SyncRowWriter`
/// @parity /modules/vescape-server/src/sync/protocol.ts
final class SyncRowWriter {
  private let table: SyncTable
  private var out = "{"

  init(_ table: SyncTable) {
    self.table = table
  }

  func build() -> String { out + "}" }

  /// An identifier the phone chose: a Board id, a settings key, an event name. Never empty.
  @discardableResult
  func keyText(_ field: String, _ value: String) throws -> SyncRowWriter {
    if value.isEmpty { throw fail(field, "must not be empty") }
    return try boundedText(field, value)
  }

  @discardableResult
  func nullableKeyText(_ field: String, _ value: String?) throws -> SyncRowWriter {
    guard let value else { return raw(field, "null") }
    return try keyText(field, value)
  }

  /// A key column the phone derives rather than names, so it may legitimately be empty — a sanitizer
  /// writes `""` as the device id of a sample captured with no Board connected.
  @discardableResult
  func derivedKeyText(_ field: String, _ value: String?) throws -> SyncRowWriter {
    guard let value else { return raw(field, "null") }
    return try boundedText(field, value)
  }

  /// Text the server stores opaquely and hands back unchanged. Uncapped, like the server's.
  @discardableResult
  func text(_ field: String, _ value: String?) -> SyncRowWriter {
    guard let value else { return raw(field, "null") }
    return raw(field, quote(value))
  }

  @discardableResult
  func bool(_ field: String, _ value: Bool) -> SyncRowWriter {
    raw(field, value ? "true" : "false")
  }

  /// Epoch ms, or a duration in ms: non-negative and inside the JSON-safe integer range.
  @discardableResult
  func timestamp(_ field: String, _ value: Int64?) throws -> SyncRowWriter {
    try bounded(field, value, 0, syncSafeIntMax)
  }

  @discardableResult
  func int32(_ field: String, _ value: Int64?) throws -> SyncRowWriter {
    try bounded(field, value, syncInt32Min, syncInt32Max)
  }

  @discardableResult
  func count(_ field: String, _ value: Int64?) throws -> SyncRowWriter {
    try bounded(field, value, 0, syncInt32Max)
  }

  /// A 64-bit column that is not a timestamp — an odometer reading.
  @discardableResult
  func int64(_ field: String, _ value: Int64?) throws -> SyncRowWriter {
    try bounded(field, value, -syncSafeIntMax, syncSafeIntMax)
  }

  /// A real number. Neither infinity nor NaN is expressible in JSON.
  @discardableResult
  func number(_ field: String, _ value: Double?) throws -> SyncRowWriter {
    guard let value else { return raw(field, "null") }
    if !value.isFinite { throw fail(field, "must be finite") }
    let whole = Int64(exactly: value.rounded(.towardZero)) ?? 0
    return raw(field, value == Double(whole) ? String(whole) : String(value))
  }

  private func bounded(_ field: String, _ value: Int64?, _ min: Int64, _ max: Int64) throws -> SyncRowWriter {
    guard let value else { return raw(field, "null") }
    if value < min || value > max { throw fail(field, "is out of bounds") }
    return raw(field, String(value))
  }

  private func boundedText(_ field: String, _ value: String) throws -> SyncRowWriter {
    // UTF-16 code units, matching the server's compiled `value.length <= 128` and Kotlin's
    // `String.length`. Swift's `count` is grapheme clusters, which would let a key through here that
    // the server refuses — and a refused batch is a permanent pause.
    if value.utf16.count > maxSyncKeyLength {
      throw fail(field, "exceeds \(maxSyncKeyLength) characters")
    }
    return raw(field, quote(value))
  }

  @discardableResult
  private func raw(_ field: String, _ encoded: String) -> SyncRowWriter {
    if out.count > 1 { out += "," }
    out += quote(field) + ":" + encoded
    return self
  }

  private func fail(_ field: String, _ problem: String) -> SyncProtocolError {
    SyncProtocolError(table: table, field: field, problem: problem)
  }

  private func quote(_ value: String) -> String {
    var quoted = "\""
    for character in value.unicodeScalars {
      switch character {
      case "\"": quoted += "\\\""
      case "\\": quoted += "\\\\"
      case "\n": quoted += "\\n"
      case "\r": quoted += "\\r"
      case "\t": quoted += "\\t"
      default:
        if character.value < 0x20 {
          quoted += String(format: "\\u%04x", character.value)
        } else {
          quoted.unicodeScalars.append(character)
        }
      }
    }
    return quoted + "\""
  }
}
