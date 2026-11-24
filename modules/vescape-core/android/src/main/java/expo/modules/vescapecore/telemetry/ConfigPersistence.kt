package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.config.BoardConfigChangeNotice
import expo.modules.vescapecore.config.RefloatConfigSchema
import expo.modules.vescapecore.config.RefloatConfigSchemaParser
import org.json.JSONArray
import org.json.JSONObject
import expo.modules.vescapecore.database.BoardConfigChangeNoticeEntity
import expo.modules.vescapecore.database.BoardConfigSchemaEntity
import expo.modules.vescapecore.database.BoardConfigValuesEntity
import expo.modules.vescapecore.database.MotorConfigValuesEntity
import expo.modules.vescapecore.database.VescapeDao

internal class ConfigPersistence(
  private val dao: VescapeDao,
  private val onInvalidIgnoredFields: (Throwable) -> Unit = {},
) {
  suspend fun saveFreshBoard(
    boardId: String,
    base: String,
    values: Map<String, Any>,
    capturedAt: Long,
    schema: RefloatConfigSchema?,
  ): BoardConfigChangeNotice? {
    val schemaEntity = schema?.takeIf { it.hash.isNotBlank() && it.rawXml.isNotBlank() }?.let {
      BoardConfigSchemaEntity(schemaHash = it.hash, rawXml = it.rawXml, createdAt = capturedAt)
    }
    val row = dao.replaceBaselineAndNotice(
      BoardConfigValuesEntity(boardId, base, JSONObject(values).toString(), capturedAt, schema?.hash?.takeIf { it.isNotBlank() }),
      schemaEntity,
    ) { old, existing, ignoredJson ->
      val oldValues = old?.let { decodeBoardValues(it.valuesJson) } ?: return@replaceBaselineAndNotice null
      val ignored = BoardConfigChangeNotice.decodeIgnoredFields(ignoredJson, onInvalidIgnoredFields).toSet()
      val incoming = BoardConfigChangeNotice.diff(oldValues, values, schema, ignored)
      if (incoming.isEmpty()) return@replaceBaselineAndNotice null
      val previous = existing?.let {
        BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson).diffs
      }.orEmpty()
      val excluded = ignored + BoardConfigChangeNotice.VOLATILE_MOTOR_FIELDS
      val merged = BoardConfigChangeNotice.mergeDiffs(
        BoardConfigChangeNotice.filterDiffs(previous, excluded),
        incoming,
      )
      BoardConfigChangeNoticeEntity(boardId, capturedAt, BoardConfigChangeNotice(boardId, capturedAt, merged).diffsJson())
    }
    return row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
  }

  suspend fun saveFreshMotor(
    boardId: String,
    signature: Long,
    firmware: String,
    values: Map<String, Double>,
    capturedAt: Long,
  ): BoardConfigChangeNotice? {
    val entity = MotorConfigValuesEntity(boardId, signature, firmware, JSONObject(values as Map<*, *>).toString(), capturedAt)
    val row = dao.replaceMotorBaselineAndNotice(entity) { old, existing, ignoredJson ->
      if (old == null || old.mcconfSignature != signature) return@replaceMotorBaselineAndNotice null
      val ignored = BoardConfigChangeNotice.decodeIgnoredFields(ignoredJson, onInvalidIgnoredFields).toSet() +
        BoardConfigChangeNotice.VOLATILE_MOTOR_FIELDS
      val incoming = BoardConfigChangeNotice.diff(decodeMotorValues(old.valuesJson), values, null, ignored)
      if (incoming.isEmpty()) return@replaceMotorBaselineAndNotice null
      val previous = existing?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson).diffs }.orEmpty()
      val merged = BoardConfigChangeNotice.mergeDiffs(
        BoardConfigChangeNotice.filterDiffs(previous, ignored),
        incoming,
      )
      BoardConfigChangeNoticeEntity(boardId, capturedAt, BoardConfigChangeNotice(boardId, capturedAt, merged).diffsJson())
    }
    return row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
  }

  suspend fun loadNotice(boardId: String): BoardConfigChangeNotice? {
    val row = dao.getBoardConfigChangeNotice(boardId) ?: return null
    val loaded = BoardConfigChangeNotice.from(row.boardId, row.detectedAt, row.diffsJson)
    val ignoredJson = dao.getBoardSetting(boardId, BoardConfigChangeNotice.IGNORED_FIELDS_SETTING_KEY)?.valueJson
    val excluded = BoardConfigChangeNotice.decodeIgnoredFields(ignoredJson, onInvalidIgnoredFields).toSet() +
      BoardConfigChangeNotice.VOLATILE_MOTOR_FIELDS
    val filtered = BoardConfigChangeNotice.filterDiffs(loaded.diffs, excluded)
    if (filtered.isEmpty()) return null
    return loaded.copy(diffs = filtered)
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `setFieldIgnored`
   */
  suspend fun setFieldIgnored(
    boardId: String,
    fieldId: String,
    ignored: Boolean,
    now: Long = System.currentTimeMillis(),
  ) {
    if (boardId.isBlank() || fieldId.isBlank()) return
    dao.setIgnoredConfigChangeField(boardId, now) { currentJson ->
      val current = BoardConfigChangeNotice.decodeIgnoredFields(currentJson, onInvalidIgnoredFields).toMutableList()
      if (ignored) {
        if (fieldId !in current) current.add(fieldId)
      } else {
        current.removeAll { it == fieldId }
      }
      if (current.isEmpty()) null else JSONArray(current).toString()
    }
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `clearIgnoredFields`
   */
  suspend fun clearIgnoredFields(boardId: String) {
    if (boardId.isBlank()) return
    dao.deleteBoardSetting(boardId, BoardConfigChangeNotice.IGNORED_FIELDS_SETTING_KEY)
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `loadSchema`
   */
  suspend fun loadSchema(schemaHash: String): RefloatConfigSchema? {
    if (schemaHash.isBlank()) return null
    val row = dao.getBoardConfigSchema(schemaHash) ?: return null
    return try {
      RefloatConfigSchemaParser.parse(row.rawXml.toByteArray(Charsets.UTF_8))
    } catch (_: Exception) {
      null
    }
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `saveSchema`
   */
  suspend fun saveSchema(schema: RefloatConfigSchema, createdAt: Long) {
    if (schema.hash.isBlank() || schema.rawXml.isBlank()) return
    dao.insertBoardConfigSchemaIfAbsent(
      BoardConfigSchemaEntity(schemaHash = schema.hash, rawXml = schema.rawXml, createdAt = createdAt),
    )
  }

  private fun decodeBoardValues(json: String): Map<String, Any> = JSONObject(json).keys().asSequence().mapNotNull { key ->
    when (val value = JSONObject(json).get(key)) {
      is Boolean -> key to value
      is Number -> value.toDouble().takeIf(Double::isFinite)?.let { key to it }
      else -> null
    }
  }.toMap()

  private fun decodeMotorValues(json: String): Map<String, Double> = JSONObject(json).keys().asSequence().mapNotNull { key ->
    (JSONObject(json).get(key) as? Number)?.toDouble()?.takeIf(Double::isFinite)?.let { key to it }
  }.toMap()
}
