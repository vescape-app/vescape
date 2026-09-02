package expo.modules.vescapecore.config

import kotlin.math.abs
import kotlin.math.max
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
    /**
     * Relative tolerance for number fields. Two decodes of the same board bytes can differ by a few
     * ULP once a value has been through the cache JSON or the `float32_auto` reconstruction, and a
     * rider must never be told `0.026 -> 0.026`. Well below the smallest step any Refloat field
     * exposes, so a real edit still diffs.
     */
    private const val NUMBER_TOLERANCE = 1e-6

    private fun changed(a: Any?, b: Any?): Boolean {
      if (a is Double && b is Double) return abs(a - b) > NUMBER_TOLERANCE * max(1.0, max(abs(a), abs(b)))
      return a?.javaClass != b?.javaClass || a != b
    }

    /**
     * Fold new diffs into an undismissed notice rather than replacing it: a Refloat change and a motor
     * config change found in the same session are one piece of news to the rider. A field that diffs
     * twice keeps the newer comparison, in its original position.
     * @parity /modules/vescape-core/ios/config/BoardConfigChangeNotice.swift `mergeDiffs`
     */
    fun mergeDiffs(previous: List<BoardConfigChangeDiff>, incoming: List<BoardConfigChangeDiff>): List<BoardConfigChangeDiff> {
      val byId = LinkedHashMap<String, BoardConfigChangeDiff>()
      for (diff in previous + incoming) byId[diff.fieldId] = diff
      return byId.values.toList()
    }

    fun diff(old: Map<String, Any>, new: Map<String, Any>, schema: RefloatConfigSchema?): List<BoardConfigChangeDiff> {
      val metadata = schema?.fields?.associateBy { it.id }.orEmpty()
      return (old.keys + new.keys).sorted().mapNotNull { id ->
        val a = old[id]; val b = new[id]
        if (!changed(a, b)) null else BoardConfigChangeDiff(id, metadata[id]?.label ?: id, metadata[id]?.unit, a, b)
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
