package expo.modules.vescapecore.config

import org.json.JSONObject

// @parity /modules/vescape-core/ios/config/RefloatFieldOverlay.swift `RefloatFieldRisk`
// @parity /src/modules/board/lib/refloatFieldOverlay.ts `RefloatFieldRisk`
internal enum class RefloatFieldRisk(val wire: String) {
  RISKY("risky"),
  INTERNAL("internal");

  companion object {
    fun fromWire(raw: String?): RefloatFieldRisk? = when (raw) {
      "risky" -> RISKY
      "internal" -> INTERNAL
      else -> null
    }
  }
}

// @parity /modules/vescape-core/ios/config/RefloatFieldOverlay.swift `RefloatFieldOverlayEntry`
internal data class RefloatFieldOverlayEntry(
  val hardMin: Double? = null,
  val hardMax: Double? = null,
  val risk: RefloatFieldRisk? = null,
)

// @parity /modules/vescape-core/ios/config/RefloatFieldOverlay.swift
// @parity /src/modules/board/lib/refloatFieldOverlay.ts
internal class RefloatFieldOverlay(
  val entries: Map<String, RefloatFieldOverlayEntry>,
) {
  fun entry(fieldId: String): RefloatFieldOverlayEntry? = entries[fieldId]

  fun isInternal(fieldId: String): Boolean = entries[fieldId]?.risk == RefloatFieldRisk.INTERNAL

  companion object {
    val empty = RefloatFieldOverlay(emptyMap())

    val shared: RefloatFieldOverlay by lazy { loadBundled() }

    private fun loadBundled(): RefloatFieldOverlay {
      val stream = checkNotNull(RefloatFieldOverlay::class.java.getResourceAsStream("/refloat-field-overlay.json")) {
        "Missing bundled resource: refloat-field-overlay.json"
      }
      val text = stream.bufferedReader().use { it.readText() }
      return parse(text)
    }

    internal fun parse(jsonText: String): RefloatFieldOverlay {
      val root = JSONObject(jsonText)
      val fields = root.optJSONObject("fields") ?: return empty
      val result = mutableMapOf<String, RefloatFieldOverlayEntry>()
      for (fieldId in fields.keys()) {
        val raw = fields.optJSONObject(fieldId) ?: continue
        val hardLimit = raw.optJSONObject("hardLimit")
        val hardMin = hardLimit?.let { finiteNumber(it, "min") }
        val hardMax = hardLimit?.let { finiteNumber(it, "max") }
        val risk = if (raw.isNull("risk")) null else RefloatFieldRisk.fromWire(raw.optString("risk", ""))
        if (hardMin != null || hardMax != null || risk != null) {
          result[fieldId] = RefloatFieldOverlayEntry(
            hardMin = hardMin,
            hardMax = hardMax,
            risk = risk,
          )
        }
      }
      return RefloatFieldOverlay(result)
    }

    private fun finiteNumber(obj: JSONObject, key: String): Double? {
      if (!obj.has(key) || obj.isNull(key)) return null
      val value = (obj.opt(key) as? Number)?.toDouble() ?: return null
      return value.takeIf { it.isFinite() }
    }
  }
}
