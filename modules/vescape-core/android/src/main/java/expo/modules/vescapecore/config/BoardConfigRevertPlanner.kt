package expo.modules.vescapecore.config

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
    val internalSchemaIds = collectInternalSchemaFieldIds(currentSchema) +
      collectInternalSchemaFieldIds(targetSchema)
    val targetValues = RefloatConfigFieldDecoder.decodeFieldMap(targetSchema, targetRawConfig)
    val currentById = currentSchema.fields.associateBy { it.id }

    val changes = LinkedHashMap<String, Any>()
    val skippedFields = mutableListOf<BoardConfigRevertSkippedField>()

    for (targetField in targetSchema.fields) {
      if (isInternalField(targetField.id, internalSchemaIds, overlay)) continue

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

      val candidateValue = normalizeCandidate(currentField, rawTargetValue)
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

  private fun isInternalField(
    fieldId: String,
    internalSchemaIds: Set<String>,
    overlay: RefloatFieldOverlay,
  ): Boolean = overlay.isInternal(fieldId) || fieldId.startsWith("meta.") || fieldId in internalSchemaIds

  private fun collectInternalSchemaFieldIds(schema: RefloatConfigSchema): Set<String> {
    val ids = HashSet<String>()
    for (group in schema.groups) {
      val groupInternal = group.name.equals("internal", ignoreCase = true)
      for (subgroup in group.subgroups) {
        if (!groupInternal && !subgroup.name.equals("meta", ignoreCase = true)) continue
        for (item in subgroup.items) {
          if (item is RefloatConfigSchemaGroupItem.Field) ids.add(item.fieldId)
        }
      }
    }
    return ids
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
