import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
enum BoardConfigFreshness: String {
  case fresh
  case lastKnown = "last-known"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
struct BoardConfigWriteBase {
  let schema: RefloatConfigSchema
  let rawConfig: [UInt8]
  let packageSignature: UInt32
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt
struct BoardConfigValues {
  let boardId: String?
  let refloatBaseVersion: String?
  let capturedAtMs: Int64
  let freshness: BoardConfigFreshness
  let values: [String: Any]
  let writeBase: BoardConfigWriteBase?

  func number(_ id: String) -> Double? {
    guard let value = values[id], !(value is Bool) else { return nil }
    guard let double = value as? Double else { return nil }
    return double.isFinite ? double : nil
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `number`
  func number(_ field: BoardConfigNumberField) -> Double? {
    number(field.id)
  }

  func bool(_ id: String) -> Bool? {
    values[id] as? Bool
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `flag`
  func flag(_ field: BoardConfigFlagField) -> Bool? {
    if let flag = values[field.id] as? Bool { return flag }
    guard let number = number(field.id) else { return nil }
    return number != 0
  }

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

  func valuesJson() throws -> String {
    guard JSONSerialization.isValidJSONObject(values) else {
      throw CocoaError(.propertyListWriteInvalid)
    }
    let data = try JSONSerialization.data(withJSONObject: values)
    guard let json = String(data: data, encoding: .utf8) else {
      throw CocoaError(.fileWriteInapplicableStringEncoding)
    }
    return json
  }

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

  static func lastKnown(
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAtMs: Int64,
    valuesJson: String
  ) throws -> BoardConfigValues {
    BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: .lastKnown,
      values: try decodeValuesJson(valuesJson),
      writeBase: nil
    )
  }

  private static func decodeValuesJson(_ json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8) else { throw ConfigStorageError.invalidCachedJSON }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ConfigStorageError.invalidCachedJSON
    }
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
