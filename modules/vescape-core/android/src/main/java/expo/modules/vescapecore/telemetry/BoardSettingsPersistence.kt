package expo.modules.vescapecore.telemetry

import org.json.JSONArray
import org.json.JSONObject

internal fun decodeSettingJson(json: String): Any? = jsonValue(JSONObject("{\"v\":$json}").get("v"))

internal fun jsonValue(value: Any?): Any? = when (value) {
  JSONObject.NULL -> null
  is JSONObject -> value.keys().asSequence().associateWith { key -> jsonValue(value.get(key)) }
  is JSONArray -> List(value.length()) { index -> jsonValue(value.get(index)) }
  else -> value
}

/** Production Room operations shared by the Android adapter and host persistence contract. */
internal class BoardSettingsPersistence(private val dao: TelemetryDao) {
  suspend fun getBoards(): List<BoardEntity> = dao.getBoards()
  suspend fun getBoard(id: String): BoardEntity? = dao.getBoard(id)
  suspend fun getBoardSettings(boardId: String): List<BoardSettingEntity> = dao.getBoardSettings(boardId)
  suspend fun getBoardSettings(boardIds: List<String>): List<BoardSettingEntity> =
    if (boardIds.isEmpty()) emptyList() else dao.getBoardSettings(boardIds)

  suspend fun upsertBoard(
    board: BoardEntity,
    settings: List<BoardSettingEntity>,
    deletedKeys: List<String>,
  ) = dao.upsertBoardWithSettings(board, settings, deletedKeys)

  suspend fun deleteBoard(id: String, deletedAt: Long) = dao.deleteBoardWithSettings(id, deletedAt)
  suspend fun getSettings(): List<AppSettingEntity> = dao.getAllAppSettings()
  suspend fun getSettings(defaults: Map<String, Any?>): Map<String, Any?> {
    val merged = defaults.toMutableMap()
    getSettings().forEach { row -> merged[row.key] = decodeSettingJson(row.valueJson) }
    return merged
  }
  suspend fun upsertSetting(setting: AppSettingEntity) = dao.upsertAppSetting(setting)
  suspend fun deleteSetting(key: String) = dao.deleteAppSetting(key)
}
