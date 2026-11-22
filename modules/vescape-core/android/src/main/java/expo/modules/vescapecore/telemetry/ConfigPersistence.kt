package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.config.BoardConfigChangeNotice
import expo.modules.vescapecore.config.RefloatConfigSchema
import org.json.JSONObject
import expo.modules.vescapecore.database.BoardConfigChangeNoticeEntity
import expo.modules.vescapecore.database.BoardConfigValuesEntity
import expo.modules.vescapecore.database.MotorConfigValuesEntity
import expo.modules.vescapecore.database.VescapeDao

internal class ConfigPersistence(private val dao: VescapeDao) {
  suspend fun saveFreshBoard(
    boardId: String,
    base: String,
    values: Map<String, Any>,
    capturedAt: Long,
    schema: RefloatConfigSchema?,
  ): BoardConfigChangeNotice? {
    val row = dao.replaceBaselineAndNotice(BoardConfigValuesEntity(boardId, base, JSONObject(values).toString(), capturedAt)) { old, existing, ignoredJson ->
      val oldValues = old?.let { decodeBoardValues(it.valuesJson) } ?: return@replaceBaselineAndNotice null
      val ignored = BoardConfigChangeNotice.decodeIgnoredFields(ignoredJson)
      val incoming = BoardConfigChangeNotice.diff(oldValues, values, schema, ignored)
      if (incoming.isEmpty()) return@replaceBaselineAndNotice null
      val previous = existing?.let {
        BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson).diffs
      }.orEmpty()
      val merged = BoardConfigChangeNotice.mergeDiffs(previous, incoming)
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
      if (old == null || old.mcconfSignature != signature) return@replaceMotorBaselineAndNotice existing
      val ignored = BoardConfigChangeNotice.decodeIgnoredFields(ignoredJson) + BoardConfigChangeNotice.VOLATILE_MOTOR_FIELDS
      val incoming = BoardConfigChangeNotice.diff(decodeMotorValues(old.valuesJson), values, null, ignored)
      if (incoming.isEmpty()) return@replaceMotorBaselineAndNotice existing
      val previous = existing?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson).diffs }.orEmpty()
      val merged = BoardConfigChangeNotice.mergeDiffs(previous, incoming)
      BoardConfigChangeNoticeEntity(boardId, capturedAt, BoardConfigChangeNotice(boardId, capturedAt, merged).diffsJson())
    }
    return row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
  }

  suspend fun pruneNotice(boardId: String, ignoredFields: Set<String>): Pair<Boolean, BoardConfigChangeNotice?> {
    if (ignoredFields.isEmpty()) return false to null
    val (changed, updated) = dao.updateBoardConfigChangeNotice(boardId) { existing ->
      if (existing == null) return@updateBoardConfigChangeNotice false to null
      val current = BoardConfigChangeNotice.from(existing.boardId, existing.detectedAt, existing.diffsJson)
      val remaining = current.diffs.filterNot { it.fieldId in ignoredFields }
      if (remaining.size == current.diffs.size) return@updateBoardConfigChangeNotice false to existing
      if (remaining.isEmpty()) return@updateBoardConfigChangeNotice true to null
      true to BoardConfigChangeNoticeEntity(
        boardId = current.boardId,
        detectedAt = current.detectedAtMs,
        diffsJson = BoardConfigChangeNotice(current.boardId, current.detectedAtMs, remaining).diffsJson(),
      )
    }
    return changed to updated?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
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
