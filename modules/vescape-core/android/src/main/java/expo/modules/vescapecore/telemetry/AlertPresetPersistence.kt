package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.AlertPresetSpec
import expo.modules.vescapecore.alerts.GeigerLevel
import expo.modules.vescapecore.alerts.PRESET_RULE_PREFIX
import expo.modules.vescapecore.alerts.resolveConfigRelativeBase
import kotlin.coroutines.cancellation.CancellationException
import org.json.JSONObject
import expo.modules.vescapecore.database.AlertRuleEntity
import expo.modules.vescapecore.database.VescapeDao

/**
 * @parity /modules/vescape-core/ios/telemetry/AlertPresetPersistence.swift
 */
internal object AlertPresetPersistence {
  val metrics = AlertPresetGenerator.metrics

  private val DEFAULT_SPEC = AlertPresetSpec("normal")

  private fun rowId(metric: String) = "$PRESET_RULE_PREFIX$metric"

  fun isPresetId(id: String) = id.startsWith(PRESET_RULE_PREFIX)

  fun preview(
    metric: String,
    spec: String,
    topSpeedKmh: Double?,
    hasBatteryConfig: Boolean,
    distanceUnit: String,
  ): List<AlertRuleEntity> {
    val parsed = requireNotNull(AlertPresetSpec.parse(spec)) { "Invalid preset spec" }
    val input = PresetInput(topSpeedKmh ?: 50.0, hasBatteryConfig, distanceUnit)
    return records("", metric, AlertPresetGenerator.generate(metric, parsed, input), createdAt = 0)
  }

  suspend fun specs(dao: VescapeDao, boardId: String): Map<String, String> {
    val rows = presetRows(dao.getAlertRules(boardId))
    return metrics.associateWith { rows[it]?.spec ?: DEFAULT_SPEC.encode() }
  }

  suspend fun expandedRules(dao: VescapeDao, boardId: String, reportFailure: (Throwable) -> Unit): List<AlertRuleEntity> {
    val rows = dao.getAlertRules(boardId)
    val riderRules = rows.filterNot { isPresetId(it.id) }
    val board = dao.getBoard(boardId)
    if (board == null || board.deletedAt != null) return riderRules
    val presets = presetRows(rows)
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    val units = validDistanceUnit(dao.getAppSetting("distanceUnit")?.let { decodeSettingJson(it.valueJson) }) ?: "km"
    val expanded = metrics.flatMap { metric ->
      try {
        val spec = presets[metric]?.let { AlertPresetSpec.parse(it.spec) ?: AlertPresetSpec("off") } ?: DEFAULT_SPEC
        val field = AlertPresetGenerator.matchField(metric).takeIf { spec.option("match") == "on" }
        val input = PresetInput(
          topSpeedKmh = (settings["topSpeedKmh"] as? Number)?.toDouble() ?: 50.0,
          hasBatteryConfig = AlertPresetGenerator.validBattery(settings["batteryConfig"]),
          distanceUnit = units,
          configBase = field?.let { resolveBase(dao, boardId, it) },
        )
        records(boardId, metric, AlertPresetGenerator.generate(metric, spec, input), presets[metric]?.createdAt ?: 0)
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        reportFailure(error)
        emptyList()
      }
    }
    return riderRules + expanded
  }

  suspend fun apply(dao: VescapeDao, boardId: String, metric: String, level: String?, geiger: String?, match: Boolean?) {
    require(metric in metrics) { "Unknown alert preset metric" }
    require(listOfNotNull(level, geiger, match).size == 1) { "Expected one preset change" }
    val board = dao.getBoard(boardId)
    require(board != null && board.deletedAt == null) { "Board not found" }
    val current = AlertPresetSpec.parse(specs(dao, boardId).getValue(metric)) ?: DEFAULT_SPEC
    val next = when {
      level != null -> {
        require(level in AlertPresetGenerator.levels) { "Invalid preset level" }
        current.copy(level = level)
      }
      geiger != null -> {
        require(AlertPresetGenerator.hasGeiger(metric) && GeigerLevel.entries.any { it.id == geiger }) { "Invalid geiger level" }
        current.withOption("geiger", geiger)
      }
      else -> {
        require(AlertPresetGenerator.matchField(metric) != null) { "Metric cannot match board config" }
        current.withOption("match", if (match == true) "on" else null)
      }
    }
    val row = presetRow(boardId, metric, next.encode(), System.currentTimeMillis())
    if (row == null) dao.deleteAlertRule(boardId, rowId(metric)) else dao.upsertAlertRule(row)
  }

  fun presetRow(boardId: String, metric: String, spec: String, createdAt: Long): AlertRuleEntity? {
    require(metric in metrics) { "Unknown alert preset metric" }
    val parsed = requireNotNull(AlertPresetSpec.parse(spec)) { "Invalid preset spec" }
    if (parsed == DEFAULT_SPEC) return null
    return AlertRuleEntity(
      boardId = boardId,
      id = rowId(metric),
      controlId = metric,
      threshold = 0.0,
      thresholdMax = null,
      enabled = true,
      spec = spec,
      createdAt = createdAt,
    )
  }

  private fun presetRows(rows: List<AlertRuleEntity>): Map<String, AlertRuleEntity> =
    rows.filter { it.id == rowId(it.controlId) }.associateBy { it.controlId }

  private suspend fun resolveBase(dao: VescapeDao, boardId: String, fieldId: String): Double? {
    fun values(raw: String?) = raw?.let { jsonValue(JSONObject(it)) as? Map<String, Any> } ?: emptyMap()
    return resolveConfigRelativeBase(fieldId, values(dao.getLatestBoardConfigValues(boardId)?.valuesJson), values(dao.getLatestMotorConfigValues(boardId)?.valuesJson))
  }

  private fun records(
    boardId: String,
    metric: String,
    rules: List<GeneratedPresetRule>,
    createdAt: Long,
  ): List<AlertRuleEntity> =
    rules.mapIndexed { index, rule ->
      AlertRuleEntity(
        boardId = boardId,
        id = "${rowId(metric)}:$index",
        controlId = metric,
        threshold = rule.point.threshold,
        thresholdMax = rule.point.thresholdMax,
        thresholdKind = if (rule.relation == null) "fixed" else "config-relative",
        configFieldId = rule.relation?.fieldId,
        thresholdOffset = rule.relation?.offset,
        thresholdMaxOffset = rule.relation?.maxOffset,
        enabled = true,
        spec = rule.spec,
        createdAt = createdAt,
        repeatEverySeconds = rule.point.repeatSeconds,
      )
    }
}
