import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigRevertPlanner.kt `BoardConfigRevertSkippedField`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigRevertSkippedField`
struct BoardConfigRevertSkippedField: Equatable {
  let fieldId: String
  let label: String
  let reason: String

  func toBridgeMap() -> [String: Any] {
    [
      "fieldId": fieldId,
      "label": label,
      "reason": reason,
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigRevertPlanner.kt `BoardConfigRevertPlan`
/// @parity /modules/vescape-core/src/index.ts `BoardConfigRevertPlan`
struct BoardConfigRevertPlan {
  let boardId: String
  let targetRevisionId: Int64
  let targetCreatedAtMs: Int64
  let targetRefloatVersion: String
  let targetSchemaHash: String
  let currentSchemaHash: String
  let sameSchema: Bool
  let changes: [String: Any]
  let skippedFields: [BoardConfigRevertSkippedField]

  func toBridgeMap() -> [String: Any?] {
    [
      "boardId": boardId,
      "targetRevisionId": targetRevisionId,
      "targetCreatedAtMs": targetCreatedAtMs,
      "targetRefloatVersion": targetRefloatVersion,
      "targetSchemaHash": targetSchemaHash,
      "currentSchemaHash": currentSchemaHash,
      "sameSchema": sameSchema,
      "changes": changes,
      "skippedFields": skippedFields.map { $0.toBridgeMap() },
    ]
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardConfigRevertPlanner.kt
enum BoardConfigRevertPlanner {
  static func plan(
    boardId: String,
    currentSchema: RefloatConfigSchema,
    currentRawConfig: [UInt8],
    targetRevisionId: Int64,
    targetCreatedAtMs: Int64,
    targetRefloatVersion: String,
    targetSchema: RefloatConfigSchema,
    targetRawConfig: [UInt8],
    overlay: RefloatFieldOverlay = .shared
  ) -> BoardConfigRevertPlan {
    let sameSchema = currentSchema.hash == targetSchema.hash
    let internalSchemaIds = RefloatConfigEncoder.collectInternalSchemaFieldIds(currentSchema)
      .union(RefloatConfigEncoder.collectInternalSchemaFieldIds(targetSchema))
    let targetValues = RefloatConfigFieldDecoder.decodeFieldMap(schema: targetSchema, rawConfig: targetRawConfig)
    let currentById = Dictionary(uniqueKeysWithValues: currentSchema.fields.map { ($0.id, $0) })

    var changes: [String: Any] = [:]
    var skippedFields: [BoardConfigRevertSkippedField] = []

    for targetField in targetSchema.fields {
      if RefloatConfigEncoder.isInternalField(targetField.id, internalSchemaIds: internalSchemaIds, overlay: overlay) {
        continue
      }

      guard let currentField = currentById[targetField.id] else {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: targetField.id,
            label: targetField.label,
            reason: "Not in current firmware schema"
          )
        )
        continue
      }

      guard let rawTargetValue = targetValues[targetField.id] else {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: targetField.id,
            label: currentField.label,
            reason: "Unable to decode value from saved revision"
          )
        )
        continue
      }

      let size = currentField.type.byteSize
      if currentField.offset < 0 || currentRawConfig.count < currentField.offset + size {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: targetField.id,
            label: currentField.label,
            reason: "Exceeds current config buffer size"
          )
        )
        continue
      }

      let mappedValue: Any
      if !sameSchema,
         RefloatConfigEncoder.isEnumField(targetField),
         RefloatConfigEncoder.isEnumField(currentField),
         !targetField.enumNames.isEmpty,
         !currentField.enumNames.isEmpty {
        guard let rawIndex = rawTargetValue as? Double,
              rawIndex.isFinite,
              rawIndex.rounded(.down) == rawIndex,
              rawIndex >= 0,
              rawIndex < Double(targetField.enumNames.count) else {
          skippedFields.append(
            BoardConfigRevertSkippedField(
              fieldId: targetField.id,
              label: currentField.label,
              reason: "Enum value out of range for saved revision"
            )
          )
          continue
        }
        let optionName = targetField.enumNames[Int(rawIndex)]
        guard let currentIndex = currentField.enumNames.firstIndex(of: optionName) else {
          skippedFields.append(
            BoardConfigRevertSkippedField(
              fieldId: targetField.id,
              label: currentField.label,
              reason: "Option '\(optionName)' is not in current firmware schema"
            )
          )
          continue
        }
        mappedValue = Double(currentIndex)
      } else {
        mappedValue = rawTargetValue
      }

      let candidateValue = normalizeCandidate(currentField, mappedValue)
      let encodedBytes: [UInt8]
      do {
        encodedBytes = try RefloatConfigEncoder.encodeFieldBytes(currentField, candidateValue, overlay: overlay)
      } catch let error as RefloatConfigEncodeException {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: targetField.id,
            label: currentField.label,
            reason: error.message
          )
        )
        continue
      } catch {
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: targetField.id,
            label: currentField.label,
            reason: "Value is not valid for current firmware"
          )
        )
        continue
      }

      if !matchesBytes(currentRawConfig, offset: currentField.offset, encodedBytes: encodedBytes) {
        changes[currentField.id] = candidateValue
      }
    }

    if !sameSchema {
      let targetIds = Set(targetSchema.fields.map(\.id))
      for currentField in currentSchema.fields {
        if targetIds.contains(currentField.id) { continue }
        if RefloatConfigEncoder.isInternalField(currentField.id, internalSchemaIds: internalSchemaIds, overlay: overlay) {
          continue
        }
        skippedFields.append(
          BoardConfigRevertSkippedField(
            fieldId: currentField.id,
            label: currentField.label,
            reason: "Not in saved revision"
          )
        )
      }
    }

    return BoardConfigRevertPlan(
      boardId: boardId,
      targetRevisionId: targetRevisionId,
      targetCreatedAtMs: targetCreatedAtMs,
      targetRefloatVersion: targetRefloatVersion,
      targetSchemaHash: targetSchema.hash,
      currentSchemaHash: currentSchema.hash,
      sameSchema: sameSchema,
      changes: changes,
      skippedFields: skippedFields
    )
  }

  private static func normalizeCandidate(_ field: RefloatConfigSchemaField, _ value: Any) -> Any {
    guard field.type == .bool else { return value }
    if let flag = value as? Bool { return flag }
    if let number = value as? Double {
      if number == 0 { return false }
      if number == 1 { return true }
    }
    return value
  }

  private static func matchesBytes(_ rawConfig: [UInt8], offset: Int, encodedBytes: [UInt8]) -> Bool {
    for i in 0..<encodedBytes.count {
      if rawConfig[offset + i] != encodedBytes[i] { return false }
    }
    return true
  }
}
