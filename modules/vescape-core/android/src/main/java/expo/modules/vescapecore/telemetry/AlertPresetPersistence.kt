package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.resolveConfigRelativeBase
import org.json.JSONObject
import java.util.UUID

/** Native owns the preset selection and generated rules in one Room transaction.
 * @parity /modules/vescape-core/ios/telemetry/AlertPresetPersistence.swift
 */
internal object AlertPresetPersistence {
  val metrics = AlertPresetGenerator.metrics
  private val levels = AlertPresetGenerator.levels
  private fun json(value: Any?) = JSONObject(value as? Map<*, *> ?: emptyMap<String, Any>())

  fun preview(
    metric: String,
    level: String,
    topSpeedKmh: Double?,
    hasBatteryConfig: Boolean,
    speedUnitSystem: String,
  ): List<AlertRuleEntity> {
    val input = PresetInput(topSpeedKmh ?: 50.0, hasBatteryConfig, speedUnitSystem)
    return records("", metric, AlertPresetGenerator.generate(metric, level, input), createdAt = 0)
  }

  /** Older JS skipped unresolved matched specs. Restore only missing relationships, never replace rider state. */
  suspend fun repairMissingRelations(dao: TelemetryDao, boardId: String): Boolean {
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    val selection = json(settings["alertPreset"])
    val match = json(settings["matchBoardConfig"])
    val existingIds = dao.getAlertRules(boardId).map { it.id }.toSet()
    var changed = false
    for (metric in metrics.filter { match.optBoolean(it) }) {
      for (rule in generate(dao, boardId, metric, selection.optString(metric, "off"), settings)) {
        if (rule.thresholdKind == "config-relative" && rule.id !in existingIds) {
          dao.upsertAlertRule(rule)
          changed = true
        }
      }
    }
    return changed
  }

  suspend fun regenerateChanged(dao: TelemetryDao, boardId: String, before: Map<String, Any?>) {
    val after = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    for (metric in metrics) {
      if (inputsChanged(metric, before, after)) regenerate(dao, boardId, metric)
    }
  }

  private fun inputsChanged(metric: String, before: Map<String, Any?>, after: Map<String, Any?>): Boolean {
    val previous = json(before["alertPreset"])
    val next = json(after["alertPreset"])
    if (previous.optString(metric, "off") != next.optString(metric, "off")) return true
    if (json(before["matchBoardConfig"]).optBoolean(metric) != json(after["matchBoardConfig"]).optBoolean(metric)) return true
    return when (metric) {
      "speed" -> {
        val oldTop = (before["topSpeedKmh"] as? Number)?.toDouble()
        val newTop = (after["topSpeedKmh"] as? Number)?.toDouble()
        oldTop != newTop || previous.optString("speedUnitSystem") != next.optString("speedUnitSystem")
      }
      "battery" -> before["batteryConfig"] != after["batteryConfig"]
      else -> false
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

  suspend fun apply(
    dao: TelemetryDao,
    boardId: String,
    metric: String,
    action: String,
    level: String?,
    matchBoardConfig: Boolean?,
  ) {
    require(metric in metrics) { "Unknown alert preset metric" }
    val board = dao.getBoard(boardId)
    require(board != null && board.deletedAt == null) { "Board not found" }
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }.toMutableMap()
    val selection = json(settings["alertPreset"])
    metrics.forEach { if (selection.optString(it) !in levels) selection.put(it, "off") }
    val now = System.currentTimeMillis()
    var customized = emptyList<AlertRuleEntity>()
    when (action) {
      "select" -> {
        require(level in levels && level != "custom") { "Invalid preset level" }
        selection.put(metric, level)
      }
      "customize" -> {
        repairMissingRelations(dao, boardId)
        if (selection.optString(metric) == "custom") return
        customized = materializeRules(dao, boardId, metric)
        selection.put(metric, "custom")
      }
      "discard-custom" -> {
        dao.getAlertRules(boardId).filter { it.controlId == metric && it.source != "preset" }.forEach { dao.deleteAlertRule(boardId, it.id) }
        selection.put(metric, "normal")
      }
      "match-board-config" -> {
        require(AlertPresetGenerator.matchField(metric) != null && matchBoardConfig != null) { "Metric cannot match board config" }
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

  private suspend fun materializeRules(dao: TelemetryDao, boardId: String, metric: String): List<AlertRuleEntity> {
    val saved = dao.getAlertRules(boardId).filter { it.controlId == metric && it.source == "preset" }
    return saved.mapNotNull { rule ->
      var threshold = rule.threshold
      var thresholdMax = rule.thresholdMax
      if (rule.thresholdKind == "config-relative") {
        val base = resolveBase(dao, boardId, rule.configFieldId) ?: return@mapNotNull null
        val offset = rule.thresholdOffset ?: return@mapNotNull null
        threshold = base + offset
        thresholdMax = rule.thresholdMaxOffset?.let { base + it }
      }
      rule.copy(
        id = UUID.randomUUID().toString(),
        source = null,
        threshold = threshold,
        thresholdMax = thresholdMax,
        thresholdKind = "fixed",
        configFieldId = null,
        thresholdOffset = null,
        thresholdMaxOffset = null,
      )
    }
  }

  private suspend fun resolveBase(dao: TelemetryDao, boardId: String, fieldId: String?): Double? {
    fun values(raw: String?) = raw?.let { jsonValue(JSONObject(it)) as? Map<String, Any> } ?: emptyMap()
    return resolveConfigRelativeBase(fieldId, values(dao.getLatestBoardConfigValues(boardId)?.valuesJson), values(dao.getLatestMotorConfigValues(boardId)?.valuesJson))
  }

  suspend fun generate(
    dao: TelemetryDao,
    boardId: String,
    metric: String,
    level: String,
    settings: Map<String, Any?>,
  ): List<AlertRuleEntity> {
    val selection = json(settings["alertPreset"])
    val matched = json(settings["matchBoardConfig"]).optBoolean(metric)
    val field = AlertPresetGenerator.matchField(metric).takeIf { matched }
    val input = PresetInput(
      topSpeedKmh = (settings["topSpeedKmh"] as? Number)?.toDouble() ?: 50.0,
      hasBatteryConfig = AlertPresetGenerator.validBattery(settings["batteryConfig"]),
      speedUnitSystem = if (selection.optString("speedUnitSystem") == "imperial") "imperial" else "metric",
      matchBoardConfig = matched,
      configBase = field?.let { resolveBase(dao, boardId, it) },
    )
    val savedLevel = level.takeIf { it in levels } ?: "off"
    return records(boardId, metric, AlertPresetGenerator.generate(metric, savedLevel, input), System.currentTimeMillis())
  }

  private fun records(
    boardId: String,
    metric: String,
    specs: List<GeneratedPresetRule>,
    createdAt: Long,
  ): List<AlertRuleEntity> =
    specs.mapIndexed { index, spec ->
      AlertRuleEntity(
        boardId = boardId,
        id = "preset:$metric:$index",
        controlId = metric,
        threshold = spec.point.threshold,
        thresholdMax = spec.point.thresholdMax,
        thresholdKind = if (spec.relation == null) "fixed" else "config-relative",
        configFieldId = spec.relation?.fieldId,
        thresholdOffset = spec.relation?.offset,
        thresholdMaxOffset = spec.relation?.maxOffset,
        enabled = true,
        soundType = spec.soundType,
        createdAt = createdAt,
        repeatEverySeconds = spec.point.repeatSeconds,
        source = "preset",
      )
    }
}
