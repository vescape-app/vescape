package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.resolveConfigRelativeBase
import org.json.JSONObject
import java.util.UUID
import kotlin.math.floor

/** Native owns the preset selection and generated rules in one Room transaction.
 * @parity /modules/vescape-core/ios/telemetry/AlertPresetPersistence.swift
 * @parity /src/modules/alerts/lib/alertPresets.ts
 */
internal object AlertPresetPersistence {
  private val definition by lazy {
    JSONObject(checkNotNull(javaClass.getResourceAsStream("/alert-preset-definitions.json"))
      .bufferedReader().use { it.readText() })
  }
  val metrics = listOf("speed", "duty", "motor-temp", "controller-temp", "battery")
  private val levels = setOf("off", "safe", "normal", "minimal", "custom")
  private fun json(value: Any?) = JSONObject(value as? Map<*, *> ?: emptyMap<String, Any>())
  private fun roundTenth(value: Double) = floor(value * 10 + 0.5) / 10

  /** Older JS skipped unresolved matched specs. Restore only missing relationships, never replace rider state. */
  suspend fun repairMissingRelations(dao: TelemetryDao, boardId: String): Boolean {
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    val selection = json(settings["alertPreset"]); val match = json(settings["matchBoardConfig"])
    val existingIds = dao.getAlertRules(boardId).map { it.id }.toSet()
    var changed = false
    for (metric in metrics.filter { match.optBoolean(it) }) {
      for (rule in generate(dao, boardId, metric, selection.optString(metric, "off"), settings)) {
        if (rule.thresholdKind == "config-relative" && rule.id !in existingIds) { dao.upsertAlertRule(rule); changed = true }
      }
    }
    return changed
  }

  suspend fun regenerateChanged(dao: TelemetryDao, boardId: String, before: Map<String, Any?>) {
    val after = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    val previous = json(before["alertPreset"]); val next = json(after["alertPreset"])
    val previousMatch = json(before["matchBoardConfig"]); val nextMatch = json(after["matchBoardConfig"])
    for (metric in metrics) {
      if (previous.optString(metric, "off") != next.optString(metric, "off") || previousMatch.optBoolean(metric) != nextMatch.optBoolean(metric) ||
        (metric == "speed" && ((before["topSpeedKmh"] as? Number)?.toDouble() != (after["topSpeedKmh"] as? Number)?.toDouble() || previous.optString("speedUnitSystem") != next.optString("speedUnitSystem"))) ||
        (metric == "battery" && before["batteryConfig"] != after["batteryConfig"])) regenerate(dao, boardId, metric)
    }
  }

  suspend fun regenerate(dao: TelemetryDao, boardId: String, onlyMetric: String? = null) {
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    val selection = json(settings["alertPreset"])
    for (metric in onlyMetric?.let { listOf(it) } ?: metrics) {
      dao.getAlertRules(boardId).filter { it.controlId == metric && it.source == "preset" }
        .forEach { dao.deleteAlertRule(boardId, it.id) }
      generate(dao, boardId, metric, selection.optString(metric, "off"), settings)
        .forEach { dao.upsertAlertRule(it) }
    }
  }

  suspend fun apply(dao: TelemetryDao, boardId: String, metric: String, action: String, level: String?, matchBoardConfig: Boolean?) {
    require(metric in metrics) { "Unknown alert preset metric" }
    require(dao.getBoard(boardId)?.deletedAt == null && dao.getBoard(boardId) != null) { "Board not found" }
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }.toMutableMap()
    val selection = json(settings["alertPreset"])
    metrics.forEach { if (selection.optString(it) !in levels) selection.put(it, "off") }
    val now = System.currentTimeMillis()
    var customized = emptyList<AlertRuleEntity>()
    when (action) {
      "select" -> { require(level in levels && level != "custom") { "Invalid preset level" }; selection.put(metric, level) }
      "customize" -> {
        repairMissingRelations(dao, boardId)
        if (selection.optString(metric) == "custom") return
        customized = dao.getAlertRules(boardId).filter { it.controlId == metric && it.source == "preset" }.mapNotNull { rule ->
          val base = if (rule.thresholdKind == "config-relative") resolveBase(dao, boardId, rule.configFieldId) ?: return@mapNotNull null else null
          rule.copy(id = UUID.randomUUID().toString(), source = null,
            threshold = if (base != null) base + (rule.thresholdOffset ?: return@mapNotNull null) else rule.threshold,
            thresholdMax = if (base != null) rule.thresholdMaxOffset?.let { base + it } else rule.thresholdMax,
            thresholdKind = "fixed", configFieldId = null, thresholdOffset = null, thresholdMaxOffset = null)
        }
        selection.put(metric, "custom")
      }
      "discard-custom" -> {
        dao.getAlertRules(boardId).filter { it.controlId == metric && it.source != "preset" }.forEach { dao.deleteAlertRule(boardId, it.id) }
        selection.put(metric, "normal")
      }
      "match-board-config" -> {
        require(definition.getJSONObject("match").has(metric) && matchBoardConfig != null) { "Metric cannot match board config" }
        val match = json(settings["matchBoardConfig"]).put(metric, matchBoardConfig)
        dao.upsertBoardSetting(BoardSettingEntity(boardId, "matchBoardConfig", match.toString(), now))
      }
      else -> error("Unknown alert preset action")
    }
    if (metric == "speed" && action in setOf("select", "discard-custom") && selection.optString(metric) !in setOf("off", "custom")) {
      val units = dao.getAppSetting("unitSystem")?.let { decodeSettingJson(it.valueJson) }
      selection.put("speedUnitSystem", if (units == "imperial") "imperial" else "metric")
    }
    dao.upsertBoardSetting(BoardSettingEntity(boardId, "alertPreset", selection.toString(), now))
    regenerate(dao, boardId, metric)
    customized.forEach { dao.upsertAlertRule(it) }
  }

  private suspend fun resolveBase(dao: TelemetryDao, boardId: String, fieldId: String?): Double? {
    fun values(raw: String?) = raw?.let { jsonValue(JSONObject(it)) as? Map<String, Any> } ?: emptyMap()
    return resolveConfigRelativeBase(fieldId, values(dao.getLatestBoardConfigValues(boardId)?.valuesJson), values(dao.getLatestMotorConfigValues(boardId)?.valuesJson))
  }

  suspend fun generate(dao: TelemetryDao, boardId: String, metric: String, level: String, settings: Map<String, Any?>): List<AlertRuleEntity> {
    if (level !in setOf("safe", "normal", "minimal")) return emptyList()
    val config = definition.getJSONObject("metrics").getJSONObject(metric)
    val match = if (json(settings["matchBoardConfig"]).optBoolean(metric)) definition.getJSONObject("match").optJSONObject(metric) else null
    val chosen = match ?: config
    val field = match?.getString("fieldId")
    val base = if (field != null) resolveBase(dao, boardId, field) else null
    if (match == null && config.optBoolean("requiresBatteryConfig") && !validBattery(settings["batteryConfig"])) return emptyList()
    fun rule(index: Int, start: Double, end: Double?, repeat: Long?) = AlertRuleEntity(
      boardId = boardId, id = "preset:$metric:$index", controlId = metric,
      threshold = if (field == null) start else base?.let { roundTenth(it + start) } ?: 0.0,
      thresholdMax = if (field == null) end else base?.let { b -> end?.let { roundTenth(b + it) } },
      thresholdKind = if (field == null) "fixed" else "config-relative", configFieldId = field,
      thresholdOffset = if (field == null) null else start, thresholdMaxOffset = if (field == null) null else end,
      enabled = true, soundType = config.getString("soundType"), createdAt = System.currentTimeMillis(), repeatEverySeconds = repeat, source = "preset",
    )
    if (chosen.getString("family") == "discrete") {
      val points = chosen.getJSONObject("levels").getJSONArray(level)
      return (0 until points.length()).map { index ->
        val point = points.getJSONObject(index)
        rule(index, point.getDouble("threshold"), null, if (point.isNull("repeatEverySeconds")) null else point.getLong("repeatEverySeconds"))
      }
    }
    val range = chosen.getJSONObject("levels").getJSONObject(level)
    var start = range.getDouble("start")
    var end = range.getDouble("ceiling")
    if (match == null && config.optBoolean("scaledByTopSpeed")) {
      val top = (settings["topSpeedKmh"] as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 } ?: 50.0
      start = roundTenth(start * top); end = roundTenth(end * top)
      if (json(settings["alertPreset"]).optString("speedUnitSystem") == "imperial") {
        end = maxOf(1.0, minOf(floor(top / 1.609344), floor(end / 1.609344 + 0.5)))
        start = maxOf(0.0, minOf(end - 1, floor(start / 1.609344 + 0.5)))
        start *= 1.609344; end *= 1.609344
      }
    }
    return listOf(rule(0, start, end, null))
  }

  private val cellPresetIds by lazy {
    val data = JSONObject(checkNotNull(javaClass.getResourceAsStream("/cell-presets.json")).bufferedReader().use { it.readText() })
    val presets = data.getJSONArray("cells")
    (0 until presets.length()).map { presets.getJSONObject(it).getString("id") }.toSet()
  }
  private fun validBattery(raw: Any?): Boolean {
    val config = json(raw)
    return when (config.optString("mode")) {
      "manual" -> config.optDouble("maxVoltage") > config.optDouble("minVoltage")
      "preset" -> config.optString("cellPresetId") in cellPresetIds
      else -> false
    }
  }
}
