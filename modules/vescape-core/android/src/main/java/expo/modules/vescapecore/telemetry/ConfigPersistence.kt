package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.config.BoardConfigChangeDiff
import expo.modules.vescapecore.config.BoardConfigChangeNotice
import expo.modules.vescapecore.config.BoardConfigRevisionSource
import expo.modules.vescapecore.config.RefloatConfigFieldDecoder
import expo.modules.vescapecore.config.RefloatConfigSchema
import expo.modules.vescapecore.config.RefloatConfigSchemaParser
import org.json.JSONArray
import org.json.JSONObject
import expo.modules.vescapecore.database.BoardConfigChangeNoticeEntity
import expo.modules.vescapecore.database.BoardConfigRevisionEntity
import expo.modules.vescapecore.database.BoardConfigSchemaEntity
import expo.modules.vescapecore.database.BoardConfigValuesEntity
import expo.modules.vescapecore.database.MotorConfigValuesEntity
import expo.modules.vescapecore.database.VescapeDao
import java.util.concurrent.ConcurrentHashMap

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `BoardConfigRevision`
 * @parity /modules/vescape-core/src/index.ts `BoardConfigRevision`
 */
internal data class BoardConfigRevision(
  val id: Long,
  val boardId: String,
  val refloatVersion: String,
  val schemaHash: String,
  val packageSignature: Long,
  val source: BoardConfigRevisionSource,
  val changes: List<BoardConfigChangeDiff>,
  val tuneProfileId: String?,
  val createdAtMs: Long,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "boardId" to boardId,
    "refloatVersion" to refloatVersion,
    "schemaHash" to schemaHash,
    "packageSignature" to packageSignature,
    "source" to source.wire,
    "changes" to changes.map { it.toMap() },
    "tuneProfileId" to tuneProfileId,
    "createdAtMs" to createdAtMs,
  )
}

internal class ConfigPersistence(
  private val dao: VescapeDao,
  private val onInvalidIgnoredFields: (Throwable) -> Unit = {},
  private val onInvalidSchemaXml: (Throwable) -> Unit = {},
) {
  suspend fun saveFreshBoard(
    boardId: String,
    base: String,
    values: Map<String, Any>,
    capturedAt: Long,
    schema: RefloatConfigSchema?,
    refloatVersion: String? = null,
    rawConfig: ByteArray? = null,
    packageSignature: Long? = null,
  ): BoardConfigChangeNotice? {
    val schemaEntity = schema?.takeIf { it.hash.isNotBlank() && it.rawXml.isNotBlank() }?.let {
      BoardConfigSchemaEntity(schemaHash = it.hash, rawXml = it.rawXml, createdAt = capturedAt)
    }
    val row = dao.replaceBaselineAndNotice(
      BoardConfigValuesEntity(boardId, base, JSONObject(values).toString(), capturedAt, schema?.hash?.takeIf { it.isNotBlank() }),
      schemaEntity,
      buildNotice = { old, existing, ignoredJson ->
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
      },
      buildRevision = { latest ->
        buildRevisionEntity(
          latest = latest,
          boardId = boardId,
          refloatVersion = refloatVersion?.takeIf { it.isNotBlank() } ?: base,
          schema = schema,
          rawConfig = rawConfig,
          packageSignature = packageSignature,
          values = values,
          source = BoardConfigRevisionSource.EXTERNAL,
          tuneProfileId = null,
          createdAt = capturedAt,
        )
      },
    )
    return row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `saveWrite`
   */
  suspend fun saveBoardWrite(
    boardId: String,
    base: String,
    values: Map<String, Any>,
    capturedAt: Long,
    schema: RefloatConfigSchema?,
    refloatVersion: String? = null,
    rawConfig: ByteArray? = null,
    packageSignature: Long? = null,
    source: BoardConfigRevisionSource = BoardConfigRevisionSource.APP,
    tuneProfileId: String? = null,
  ) {
    val schemaEntity = schema?.takeIf { it.hash.isNotBlank() && it.rawXml.isNotBlank() }?.let {
      BoardConfigSchemaEntity(schemaHash = it.hash, rawXml = it.rawXml, createdAt = capturedAt)
    }
    dao.saveBoardConfigWrite(
      BoardConfigValuesEntity(boardId, base, JSONObject(values).toString(), capturedAt, schema?.hash?.takeIf { it.isNotBlank() }),
      schemaEntity,
    ) { latest ->
      buildRevisionEntity(
        latest = latest,
        boardId = boardId,
        refloatVersion = refloatVersion?.takeIf { it.isNotBlank() } ?: base,
        schema = schema,
        rawConfig = rawConfig,
        packageSignature = packageSignature,
        values = values,
        source = source,
        tuneProfileId = tuneProfileId,
        createdAt = capturedAt,
      )
    }
  }

  /**
   * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `loadRevisions`
   */
  suspend fun loadRevisions(boardId: String, limit: Int = DEFAULT_REVISIONS_LIMIT): List<BoardConfigRevision> {
    if (boardId.isBlank() || limit <= 0) return emptyList()
    return dao.getBoardConfigRevisions(boardId, limit).map { row ->
      BoardConfigRevision(
        id = row.id,
        boardId = row.boardId,
        refloatVersion = row.refloatVersion,
        schemaHash = row.schemaHash,
        packageSignature = row.packageSignature,
        source = BoardConfigRevisionSource.fromWire(row.source),
        changes = BoardConfigChangeNotice.from(row.boardId, row.createdAt, row.changesJson).diffs,
        tuneProfileId = row.tuneProfileId,
        createdAtMs = row.createdAt,
      )
    }
  }

  private suspend fun buildRevisionEntity(
    latest: BoardConfigRevisionEntity?,
    boardId: String,
    refloatVersion: String,
    schema: RefloatConfigSchema?,
    rawConfig: ByteArray?,
    packageSignature: Long?,
    values: Map<String, Any>,
    source: BoardConfigRevisionSource,
    tuneProfileId: String?,
    createdAt: Long,
  ): BoardConfigRevisionEntity? {
    val validSchema = schema?.takeIf { it.hash.isNotBlank() && it.rawXml.isNotBlank() } ?: return null
    val bytes = rawConfig ?: return null
    val signature = packageSignature ?: return null
    if (latest == null) {
      return BoardConfigRevisionEntity(
        boardId = boardId,
        refloatVersion = refloatVersion,
        schemaHash = validSchema.hash,
        packageSignature = signature,
        rawConfig = bytes,
        source = source.wire,
        changesJson = "[]",
        tuneProfileId = tuneProfileId,
        createdAt = createdAt,
      )
    }
    val previousSchema = if (latest.schemaHash == validSchema.hash) validSchema else loadSchema(latest.schemaHash)
    val diffs = if (previousSchema != null) {
      val previousValues = RefloatConfigFieldDecoder.decodeFieldMap(previousSchema, latest.rawConfig)
      val computed = BoardConfigChangeNotice.diff(
        previousValues,
        values,
        validSchema,
        BoardConfigChangeNotice.VOLATILE_MOTOR_FIELDS,
      )
      if (computed.isEmpty()) return null
      computed
    } else {
      if (latest.rawConfig.contentEquals(bytes)) return null
      emptyList()
    }
    val changesJson = BoardConfigChangeNotice(boardId, createdAt, diffs).diffsJson()
    return BoardConfigRevisionEntity(
      boardId = boardId,
      refloatVersion = refloatVersion,
      schemaHash = validSchema.hash,
      packageSignature = signature,
      rawConfig = bytes,
      source = source.wire,
      changesJson = changesJson,
      tuneProfileId = tuneProfileId,
      createdAt = createdAt,
    )
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
    parsedSchemaCache[schemaHash]?.let { return it }
    val row = dao.getBoardConfigSchema(schemaHash) ?: return null
    val parsed = try {
      RefloatConfigSchemaParser.parse(row.rawXml.toByteArray(Charsets.UTF_8))
    } catch (error: Throwable) {
      onInvalidSchemaXml(error)
      return null
    }
    parsedSchemaCache[schemaHash] = parsed
    return parsed
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

  companion object {
    const val DEFAULT_REVISIONS_LIMIT = 200
    private val parsedSchemaCache = ConcurrentHashMap<String, RefloatConfigSchema>()
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
