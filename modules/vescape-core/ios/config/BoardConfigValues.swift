import Foundation

/// Whether a Board Config Values object was read from the board in the current Board Session
/// (`fresh`) or restored from the per-Board cache on connect (`provisional`).
///
/// Provisional values may be displayed, but never back a config write: the cache was filled while
/// some earlier session held the link, and the window since then is exactly where another tool could
/// have written the board. See ADR 0035.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
enum BoardConfigFreshness: String {
  case fresh
  case provisional
}

/// The only valid base for a Refloat config write: the raw bytes exactly as the board sent them, the
/// package signature `COMM_SET_CUSTOM_CONFIG` echoes back, and the parsed schema that locates each
/// field inside those bytes.
///
/// A write patches these bytes rather than re-encoding the decoded map, which is what keeps fields
/// outside the curated tune groups intact — never reconstruct config from `BoardConfigValues.values`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
struct BoardConfigWriteBase {
  let schema: RefloatConfigSchema
  let rawConfig: [UInt8]
  let packageSignature: UInt32
}

/// One Board Session's Refloat configuration, native-owned: the decoded map over the whole schema
/// plus (when `fresh`) the write base the bytes came from.
///
/// `values` holds each field in its real type — a bool field is a `Bool`, not `1.0`. A field the
/// schema does not carry, whose bytes are truncated, or that decodes to a non-finite number is
/// **absent** from the map: "missing" and "unparseable" stay indistinguishable to every reader, so a
/// NaN can never pass as a real value.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
struct BoardConfigValues {
  let boardId: String?
  /// Refloat base version the values were decoded against — the cache scope (ADR 0022).
  let refloatBaseVersion: String?
  let capturedAtMs: Int64
  let freshness: BoardConfigFreshness
  /// Decoded fields, keyed by schema field id. Values are `Double` or `Bool`.
  let values: [String: Any]
  /// Present only on `fresh` values; a restored cache row has no bytes to patch.
  let writeBase: BoardConfigWriteBase?

  /// A finite number field, or nil when the field is absent. Never coerces a bool to `1.0` / `0.0` —
  /// a rule asking for a number wants a number.
  func number(_ id: String) -> Double? {
    guard let value = values[id], !(value is Bool) else { return nil }
    guard let double = value as? Double else { return nil }
    return double.isFinite ? double : nil
  }

  /// A bool field, or nil when the field is absent.
  func bool(_ id: String) -> Bool? {
    values[id] as? Bool
  }

  /// Decoded values as the JSON stored in the per-Board cache row. Bools serialize as `true` /
  /// `false` so the restored map keeps the same types.
  func valuesJson() -> String {
    guard
      let data = try? JSONSerialization.data(withJSONObject: values),
      let json = String(data: data, encoding: .utf8)
    else { return "{}" }
    return json
  }

  /// Rebuild a cached object. Always `provisional` and always without a write base.
  static func provisional(
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAtMs: Int64,
    valuesJson: String
  ) -> BoardConfigValues {
    BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: .provisional,
      values: decodeValuesJson(valuesJson),
      writeBase: nil
    )
  }

  /// JSON numbers all arrive as `NSNumber`, so a stored `true` would otherwise read back as `1.0`.
  /// `CFBoolean` is the only way to tell the two apart.
  private static func decodeValuesJson(_ json: String) -> [String: Any] {
    guard
      let data = json.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    var values: [String: Any] = [:]
    for (id, raw) in object {
      if let number = raw as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
          values[id] = number.boolValue
        } else if number.doubleValue.isFinite {
          values[id] = number.doubleValue
        }
      }
    }
    return values
  }
}
