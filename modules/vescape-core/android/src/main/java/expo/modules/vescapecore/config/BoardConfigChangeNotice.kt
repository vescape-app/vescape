package expo.modules.vescapecore.config

import kotlin.math.abs
import kotlin.math.max
import org.json.JSONArray
import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `BoardConfigChangeDiff`
 * @parity /modules/vescape-core/src/index.ts `BoardConfigChangeDiff`
 */
internal data class BoardConfigChangeDiff(val fieldId: String, val label: String, val unit: String?, val oldValue: Any?, val newValue: Any?) {
  fun toMap() = mapOf("fieldId" to fieldId, "label" to label, "unit" to unit, "oldValue" to oldValue, "newValue" to newValue)
  fun toJson() = JSONObject().put("fieldId", fieldId).put("label", label).put("unit", unit).put("oldValue", oldValue).put("newValue", newValue)
}

internal data class BoardConfigChangeNotice(val boardId: String, val detectedAtMs: Long, val diffs: List<BoardConfigChangeDiff>) {
  fun toMap() = mapOf("boardId" to boardId, "detectedAtMs" to detectedAtMs, "diffs" to diffs.map { it.toMap() })
  fun diffsJson() = JSONArray().also { a -> diffs.forEach { a.put(it.toJson()) } }.toString()
  companion object {
    /**
     * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `ignoredFieldsSettingKey`
     */
    const val IGNORED_FIELDS_SETTING_KEY = "ignoredConfigChangeFields"

    /**
     * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `volatileMotorFields`
     */
    val VOLATILE_MOTOR_FIELDS: Set<String> = setOf(
      "foc_offsets_current[0]",
      "foc_offsets_current[1]",
      "foc_offsets_current[2]",
      "foc_offsets_voltage[0]",
      "foc_offsets_voltage[1]",
      "foc_offsets_voltage[2]",
      "foc_offsets_voltage_undriven[0]",
      "foc_offsets_voltage_undriven[1]",
      "foc_offsets_voltage_undriven[2]",
    )

    private const val NUMBER_TOLERANCE = 1e-6

    private fun changed(a: Any?, b: Any?): Boolean {
      if (a is Double && b is Double) return abs(a - b) > NUMBER_TOLERANCE * max(1.0, max(abs(a), abs(b)))
      return a?.javaClass != b?.javaClass || a != b
    }

    /**
     * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `mergeDiffs`
     */
    fun mergeDiffs(previous: List<BoardConfigChangeDiff>, incoming: List<BoardConfigChangeDiff>): List<BoardConfigChangeDiff> {
      val byId = LinkedHashMap<String, BoardConfigChangeDiff>()
      for (diff in previous + incoming) byId[diff.fieldId] = diff
      return byId.values.toList()
    }

    fun diff(
      old: Map<String, Any>,
      new: Map<String, Any>,
      schema: RefloatConfigSchema?,
      ignoredFields: Set<String> = emptySet(),
    ): List<BoardConfigChangeDiff> {
      val metadata = schema?.fields?.associateBy { it.id }.orEmpty()
      return (old.keys + new.keys).sorted().mapNotNull { id ->
        if (id in ignoredFields) return@mapNotNull null
        val a = old[id]; val b = new[id]
        if (!changed(a, b)) null else BoardConfigChangeDiff(id, metadata[id]?.label ?: id, metadata[id]?.unit, a, b)
      }
    }

    fun filterDiffs(
      diffs: List<BoardConfigChangeDiff>,
      excludedFields: Set<String>,
    ): List<BoardConfigChangeDiff> = diffs.filterNot { it.fieldId in excludedFields }

    /**
     * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `decodeIgnoredFields`
     */
    fun decodeIgnoredFields(json: String?, onInvalid: (Throwable) -> Unit = {}): List<String> {
      if (json.isNullOrBlank()) return emptyList()
      val array = try {
        JSONArray(json)
      } catch (error: Throwable) {
        onInvalid(error)
        return emptyList()
      }
      val seen = HashSet<String>()
      return buildList {
        for (i in 0 until array.length()) {
          val item = array.opt(i) as? String
          if (!item.isNullOrEmpty() && seen.add(item)) add(item)
        }
      }
    }
    fun from(boardId: String, at: Long, json: String): BoardConfigChangeNotice {
      val array = JSONArray(json)
      return BoardConfigChangeNotice(boardId, at, (0 until array.length()).map { i ->
        val o = array.getJSONObject(i)
        BoardConfigChangeDiff(o.getString("fieldId"), o.getString("label"), o.optString("unit").takeUnless { o.isNull("unit") }, o.opt("oldValue").takeUnless { it == JSONObject.NULL }, o.opt("newValue").takeUnless { it == JSONObject.NULL })
      })
    }
  }
}
