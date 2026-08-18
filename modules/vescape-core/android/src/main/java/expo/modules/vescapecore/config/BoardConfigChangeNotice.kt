package expo.modules.vescapecore.config

import org.json.JSONArray
import org.json.JSONObject

/** @parity /modules/vescape-core/ios/config/BoardConfigChangeNotice.swift */
internal data class BoardConfigChangeDiff(val fieldId: String, val label: String, val unit: String?, val oldValue: Any?, val newValue: Any?) {
  fun toMap() = mapOf("fieldId" to fieldId, "label" to label, "unit" to unit, "oldValue" to oldValue, "newValue" to newValue)
  fun toJson() = JSONObject().put("fieldId", fieldId).put("label", label).put("unit", unit).put("oldValue", oldValue).put("newValue", newValue)
}

internal data class BoardConfigChangeNotice(val boardId: String, val detectedAtMs: Long, val diffs: List<BoardConfigChangeDiff>) {
  fun toMap() = mapOf("boardId" to boardId, "detectedAtMs" to detectedAtMs, "diffs" to diffs.map { it.toMap() })
  fun diffsJson() = JSONArray().also { a -> diffs.forEach { a.put(it.toJson()) } }.toString()
  companion object {
    fun diff(old: Map<String, Any>, new: Map<String, Any>, schema: RefloatConfigSchema?): List<BoardConfigChangeDiff> {
      val metadata = schema?.fields?.associateBy { it.id }.orEmpty()
      return (old.keys + new.keys).sorted().mapNotNull { id ->
        val a = old[id]; val b = new[id]
        val equal = a?.javaClass == b?.javaClass && a == b
        if (equal) null else BoardConfigChangeDiff(id, metadata[id]?.label ?: id, metadata[id]?.unit, a, b)
      }
    }
    fun from(boardId: String, at: Long, json: String): BoardConfigChangeNotice? = runCatching {
      val array = JSONArray(json)
      BoardConfigChangeNotice(boardId, at, (0 until array.length()).map { i ->
        val o = array.getJSONObject(i)
        BoardConfigChangeDiff(o.getString("fieldId"), o.getString("label"), o.optString("unit").takeUnless { o.isNull("unit") }, o.opt("oldValue").takeUnless { it == JSONObject.NULL }, o.opt("newValue").takeUnless { it == JSONObject.NULL })
      })
    }.getOrNull()
  }
}
