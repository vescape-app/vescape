import Foundation

/// Whether a Board Config Values object was read from the board in the current Board Session
/// (`fresh`) or restored from the per-Board cache on connect (`lastKnown`).
///
/// Provisional values may be displayed, but never back a config write: the cache was filled while
/// some earlier session held the link, and the window since then is exactly where another tool could
/// have written the board. See ADR 0035.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
enum BoardConfigFreshness: String {
  case fresh
  // Explicit wire string: the bridge contract is `last-known`, which the default rawValue
  // (`lastKnown`) does not spell. Kotlin carries the same strings in `BoardConfigFreshness.wire`.
  case lastKnown = "last-known"
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

  /// One of the number fields Vescape operates on. The typed twin of `number(_:)`, so a rule cannot
  /// name a field the fixture corpus has never seen.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `number`
  func number(_ field: BoardConfigNumberField) -> Double? {
    number(field.id)
  }

  /// A bool field, or nil when the field is absent.
  func bool(_ id: String) -> Bool? {
    values[id] as? Bool
  }

  /// One of the flag fields Vescape operates on, read through whichever representation the schema
  /// produced for it. Refloat spells these as numeric params, so `bool(_:)` alone would answer nil on
  /// every real board — see `BoardConfigFlagField`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `flag`
  func flag(_ field: BoardConfigFlagField) -> Bool? {
    if let flag = values[field.id] as? Bool { return flag }
    guard let number = number(field.id) else { return nil }
    return number != 0
  }

  /// The same values with one flag field set, spelled in the type the board's schema declares for it.
  /// The schema is asked first and the currently decoded value is only a fallback for `lastKnown`
  /// rows, which carry no write base to ask.
  ///
  /// Returns nil when neither source knows the field: inventing a key would itself register as a
  /// config change, which is the exact bug this accessor exists to prevent.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `withFlag`
  func withFlag(_ field: BoardConfigFlagField, _ enabled: Bool) -> BoardConfigValues? {
    let schemaType = writeBase?.schema.fields.first { $0.id == field.id }?.type
    let type: RefloatConfigValueType
    if let schemaType {
      type = schemaType
    } else if values[field.id] is Bool {
      type = .bool
    } else if values[field.id] is Double {
      type = .int8
    } else {
      return nil
    }
    var next = values
    next[field.id] = encodeFlag(type, enabled)
    return withValues(next)
  }

  /// The JS-facing shape: decoded fields plus freshness, and nothing else. The write base never
  /// crosses the bridge — JS has no use for raw bytes and must never be able to assemble a write
  /// from them (ADR 0035).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `toBridgeMap`
  /// @parity /modules/vescape-core/src/index.ts `BoardConfigValues`
  func toBridgeMap() -> [String: Any?] {
    [
      "boardId": boardId,
      "refloatBaseVersion": refloatBaseVersion,
      "capturedAtMs": capturedAtMs,
      "freshness": freshness.rawValue,
      "values": values,
    ]
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

  /// Demote to `lastKnown`, dropping the write base. Called when the BLE link drops: the values
  /// stay worth showing, but the disconnected window is exactly where another central could have
  /// written the board, so they may no longer back a write (ADR 0035).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `demotedToProvisional`
  func demotedToProvisional() -> BoardConfigValues {
    guard freshness == .fresh else { return self }
    return BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: .lastKnown,
      values: values,
      writeBase: nil
    )
  }

  /// The same values with `values` replaced. Swift has no `copy`, and the only caller rebases the
  /// config-change baseline after a runtime command mutated a field on the board.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `BoardConfigValues`
  func withValues(_ values: [String: Any]) -> BoardConfigValues {
    BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: freshness,
      values: values,
      writeBase: writeBase
    )
  }

  /// Rebuild a cached object. Always `lastKnown` and always without a write base.
  static func lastKnown(
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAtMs: Int64,
    valuesJson: String
  ) -> BoardConfigValues {
    BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: .lastKnown,
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
