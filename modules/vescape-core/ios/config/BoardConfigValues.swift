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
  let schemaHash: String?
  let schema: RefloatConfigSchema?

  init(
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAtMs: Int64,
    freshness: BoardConfigFreshness,
    values: [String: Any],
    writeBase: BoardConfigWriteBase?,
    schemaHash: String? = nil,
    schema: RefloatConfigSchema? = nil
  ) {
    self.boardId = boardId
    self.refloatBaseVersion = refloatBaseVersion
    self.capturedAtMs = capturedAtMs
    self.freshness = freshness
    self.values = values
    self.writeBase = writeBase
    self.schemaHash = schemaHash ?? writeBase?.schema.hash
    self.schema = schema ?? writeBase?.schema
  }

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
  func withFlag(_ field: BoardConfigFlagField, _ enabled: Bool) throws -> BoardConfigValues? {
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
    let value = encodeFlag(type, enabled)
    var next = values
    next[field.id] = value
    var base = writeBase
    if let writeBase, schemaType != nil {
      base = BoardConfigWriteBase(
        schema: writeBase.schema,
        rawConfig: try RefloatConfigEncoder.encode(
          schema: writeBase.schema, rawConfig: writeBase.rawConfig, fields: [field.id: value]),
        packageSignature: writeBase.packageSignature
      )
    }
    return BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: freshness,
      values: next,
      writeBase: base,
      schemaHash: schemaHash,
      schema: schema
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigValues.kt `withLights`
  func withLights(enabled: Bool, headlightsEnabled: Bool) throws -> BoardConfigValues? {
    try withFlag(.ledsOn, enabled)?.withFlag(.headlightsOn, headlightsEnabled)
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
      "schemaHash": schemaHash,
      "schema": schema?.toBridgeMap(),
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
      writeBase: nil,
      schemaHash: schemaHash,
      schema: schema
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
      writeBase: writeBase,
      schemaHash: schemaHash,
      schema: schema
    )
  }

  static func lastKnown(
    boardId: String?,
    refloatBaseVersion: String?,
    capturedAtMs: Int64,
    valuesJson: String,
    schemaHash: String? = nil,
    schema: RefloatConfigSchema? = nil
  ) throws -> BoardConfigValues {
    BoardConfigValues(
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion,
      capturedAtMs: capturedAtMs,
      freshness: .lastKnown,
      values: try decodeValuesJson(valuesJson),
      writeBase: nil,
      schemaHash: schemaHash,
      schema: schema
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
