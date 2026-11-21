import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/MotorConfigValues.kt
struct MotorConfigValues {
  let boardId: String?
  let signature: UInt32
  let firmware: String
  let capturedAtMs: Int64
  let freshness: BoardConfigFreshness
  let values: [String: Double]

  func number(_ id: String) -> Double? {
    guard let value = values[id], value.isFinite else { return nil }
    return value
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/MotorConfigValues.kt `demotedToLastKnown`
  func demotedToLastKnown() -> MotorConfigValues {
    guard freshness == .fresh else { return self }
    return MotorConfigValues(
      boardId: boardId,
      signature: signature,
      firmware: firmware,
      capturedAtMs: capturedAtMs,
      freshness: .lastKnown,
      values: values
    )
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/MotorConfigValues.kt `toBridgeMap`
  func toBridgeMap() -> [String: Any?] {
    [
      "boardId": boardId,
      "signature": signature,
      "firmware": firmware,
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

  static func lastKnown(
    boardId: String?,
    signature: UInt32,
    firmware: String,
    capturedAtMs: Int64,
    valuesJson: String
  ) throws -> MotorConfigValues {
    MotorConfigValues(
      boardId: boardId,
      signature: signature,
      firmware: firmware,
      capturedAtMs: capturedAtMs,
      freshness: .lastKnown,
      values: try decodeValuesJson(valuesJson)
    )
  }

  private static func decodeValuesJson(_ json: String) throws -> [String: Double] {
    guard let data = json.data(using: .utf8) else { throw ConfigStorageError.invalidCachedJSON }
    guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ConfigStorageError.invalidCachedJSON
    }
    var values: [String: Double] = [:]
    for (id, raw) in parsed {
      if let number = raw as? NSNumber, number.doubleValue.isFinite { values[id] = number.doubleValue }
    }
    return values
  }
}
