package expo.modules.vescapecore.config

import kotlin.math.floor

// @parity /modules/vescape-core/ios/config/BoardConfigRevertPlanner.swift `BoardConfigRevertSkippedField`
// @parity /modules/vescape-core/src/index.ts `BoardConfigRevertSkippedField`
internal data class BoardConfigRevertSkippedField(
  val fieldId: String,
  val label: String,
  val reason: String,
) {
  fun toBridgeMap(): Map<String, Any> = mapOf(
    "fieldId" to fieldId,
    "label" to label,
    "reason" to reason,
  )
}

// @parity /modules/vescape-core/ios/config/BoardConfigRevertPlanner.swift `BoardConfigRevertPlan`
// @parity /modules/vescape-core/src/index.ts `BoardConfigRevertPlan`
internal data class BoardConfigRevertPlan(
  val boardId: String,
  val targetRevisionId: Long,
  val targetCreatedAtMs: Long,
  val targetRefloatVersion: String,
  val targetSchemaHash: String,
  val currentSchemaHash: String,
  val sameSchema: Boolean,
  val changes: Map<String, Any>,
  val skippedFields: List<BoardConfigRevertSkippedField>,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "boardId" to boardId,
    "targetRevisionId" to targetRevisionId,
    "targetCreatedAtMs" to targetCreatedAtMs,
    "targetRefloatVersion" to targetRefloatVersion,
    "targetSchemaHash" to targetSchemaHash,
    "currentSchemaHash" to currentSchemaHash,
    "sameSchema" to sameSchema,
    "changes" to changes,
    "skippedFields" to skippedFields.map { it.toBridgeMap() },
  )
}

// @parity /modules/vescape-core/ios/config/BoardConfigRevertPlanner.swift
internal object BoardConfigRevertPlanner {
  fun plan(
    boardId: String,
    currentSchema: RefloatConfigSchema,
    currentRawConfig: ByteArray,
    targetRevisionId: Long,
    targetCreatedAtMs: Long,
    targetRefloatVersion: String,
    targetSchema: RefloatConfigSchema,
    targetRawConfig: ByteArray,
    overlay: RefloatFieldOverlay = RefloatFieldOverlay.shared,
  ): BoardConfigRevertPlan {
    val sameSchema = currentSchema.hash == targetSchema.hash
    val internalSchemaIds = RefloatConfigEncoder.collectInternalSchemaFieldIds(currentSchema) +
      RefloatConfigEncoder.collectInternalSchemaFieldIds(targetSchema)
    val targetValues = RefloatConfigFieldDecoder.decodeFieldMap(targetSchema, targetRawConfig)
    val currentById = currentSchema.fields.associateBy { it.id }

    val changes = LinkedHashMap<String, Any>()
    val skippedFields = mutableListOf<BoardConfigRevertSkippedField>()

    for (targetField in targetSchema.fields) {
      if (RefloatConfigEncoder.isInternalField(targetField.id, internalSchemaIds, overlay)) continue

      val currentField = currentById[targetField.id]
      if (currentField == null) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = targetField.id,
            label = targetField.label,
            reason = "Not in current firmware schema",
          ),
        )
        continue
      }

      val rawTargetValue = targetValues[targetField.id]
      if (rawTargetValue == null) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = targetField.id,
            label = currentField.label,
            reason = "Unable to decode value from saved revision",
          ),
        )
        continue
      }

      val size = currentField.type.byteSize
      if (currentField.offset < 0 || currentRawConfig.size < currentField.offset + size) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = targetField.id,
            label = currentField.label,
            reason = "Exceeds current config buffer size",
          ),
        )
        continue
      }

      val mappedValue = if (!sameSchema &&
        RefloatConfigEncoder.isEnumField(targetField) &&
        RefloatConfigEncoder.isEnumField(currentField) &&
        targetField.enumNames.isNotEmpty() &&
        currentField.enumNames.isNotEmpty()
      ) {
        val rawIndex = (rawTargetValue as? Number)?.toDouble()
        if (rawIndex == null || !rawIndex.isFinite() || floor(rawIndex) != rawIndex ||
          rawIndex < 0.0 || rawIndex >= targetField.enumNames.size.toDouble()
        ) {
          skippedFields.add(
            BoardConfigRevertSkippedField(
              fieldId = targetField.id,
              label = currentField.label,
              reason = "Enum value out of range for saved revision",
            ),
          )
          continue
        }
        val optionName = targetField.enumNames[rawIndex.toInt()]
        val currentIndex = currentField.enumNames.indexOf(optionName)
        if (currentIndex < 0) {
          skippedFields.add(
            BoardConfigRevertSkippedField(
              fieldId = targetField.id,
              label = currentField.label,
              reason = "Option '$optionName' is not in current firmware schema",
            ),
          )
          continue
        }
        currentIndex.toDouble()
      } else {
        rawTargetValue
      }

      val candidateValue = normalizeCandidate(currentField, mappedValue)
      val encodedBytes = try {
        RefloatConfigEncoder.encodeFieldBytes(currentField, candidateValue, overlay)
      } catch (error: RefloatConfigEncodeException) {
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = targetField.id,
            label = currentField.label,
            reason = error.message ?: "Value is not valid for current firmware",
          ),
        )
        continue
      }

      if (!matchesBytes(currentRawConfig, currentField.offset, encodedBytes)) {
        changes[currentField.id] = candidateValue
      }
    }

    if (!sameSchema) {
      val targetIds = targetSchema.fields.mapTo(HashSet()) { it.id }
      for (currentField in currentSchema.fields) {
        if (currentField.id in targetIds) continue
        if (RefloatConfigEncoder.isInternalField(currentField.id, internalSchemaIds, overlay)) continue
        skippedFields.add(
          BoardConfigRevertSkippedField(
            fieldId = currentField.id,
            label = currentField.label,
            reason = "Not in saved revision",
          ),
        )
      }
    }

    return BoardConfigRevertPlan(
      boardId = boardId,
      targetRevisionId = targetRevisionId,
      targetCreatedAtMs = targetCreatedAtMs,
      targetRefloatVersion = targetRefloatVersion,
      targetSchemaHash = targetSchema.hash,
      currentSchemaHash = currentSchema.hash,
      sameSchema = sameSchema,
      changes = changes,
      skippedFields = skippedFields,
    )
  }

  private fun normalizeCandidate(field: RefloatConfigSchemaField, value: Any): Any {
    if (field.type != RefloatConfigValueType.BOOL) return value
    return when (value) {
      is Boolean -> value
      is Double -> when (value) {
        0.0 -> false
        1.0 -> true
        else -> value
      }
      else -> value
    }
  }

  private fun matchesBytes(rawConfig: ByteArray, offset: Int, encodedBytes: ByteArray): Boolean {
    for (i in encodedBytes.indices) {
      if (rawConfig[offset + i] != encodedBytes[i]) return false
    }
    return true
  }
}
