package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.config.BoardConfigChangeNotice
import expo.modules.vescapecore.config.RefloatConfigSchema
import org.json.JSONObject

/** Production transaction seam shared by the app and host persistence contract. */
internal class ConfigPersistence(private val dao: TelemetryDao) {
  suspend fun saveFreshBoard(
    boardId: String,
    base: String,
    values: Map<String, Any>,
    capturedAt: Long,
    schema: RefloatConfigSchema?,
  ): BoardConfigChangeNotice? {
    val row = dao.replaceBaselineAndNotice(BoardConfigValuesEntity(boardId, base, JSONObject(values).toString(), capturedAt)) { old, existing ->
      val oldValues = old?.let { decodeBoardValues(it.valuesJson) } ?: return@replaceBaselineAndNotice null
      val incoming = BoardConfigChangeNotice.diff(oldValues, values, schema)
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
    val row = dao.replaceMotorBaselineAndNotice(entity) { old, existing ->
      if (old == null || old.mcconfSignature != signature) return@replaceMotorBaselineAndNotice existing
      val incoming = BoardConfigChangeNotice.diff(decodeMotorValues(old.valuesJson), values, null)
      if (incoming.isEmpty()) return@replaceMotorBaselineAndNotice existing
      val previous = existing?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson).diffs }.orEmpty()
      val merged = BoardConfigChangeNotice.mergeDiffs(previous, incoming)
      BoardConfigChangeNoticeEntity(boardId, capturedAt, BoardConfigChangeNotice(boardId, capturedAt, merged).diffsJson())
    }
    return row?.let { BoardConfigChangeNotice.from(it.boardId, it.detectedAt, it.diffsJson) }
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
