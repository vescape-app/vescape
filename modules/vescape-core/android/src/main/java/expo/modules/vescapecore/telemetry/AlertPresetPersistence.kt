package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.AlertPresetSpec
import expo.modules.vescapecore.alerts.GeigerLevel
import expo.modules.vescapecore.alerts.PRESET_RULE_PREFIX
import expo.modules.vescapecore.alerts.resolveConfigRelativeBase
import kotlin.coroutines.cancellation.CancellationException
import org.json.JSONObject

/**
 * An Alert Preset is one `alerts` row per Board and metric, id `preset:<metric>`, whose spec is
 * `preset(<level>)[:key=value,…]`. Native expands the rows whenever it loads rules; the expanded
 * rules are never stored.
 *
 * @parity /modules/vescape-core/ios/telemetry/AlertPresetPersistence.swift
 */
internal object AlertPresetPersistence {
  val metrics = AlertPresetGenerator.metrics

  /** A metric without a preset row: the app default. */
  private val DEFAULT_SPEC = AlertPresetSpec("normal")

  private fun rowId(metric: String) = "$PRESET_RULE_PREFIX$metric"

  /** True for a stored preset row or an expanded preset rule: neither is a rider's rule. */
  fun isPresetId(id: String) = id.startsWith(PRESET_RULE_PREFIX)

  /** Expand an unsaved draft [spec] for the add-board wizard, without touching the database. */
  fun preview(
    metric: String,
    spec: String,
    topSpeedKmh: Double?,
    hasBatteryConfig: Boolean,
    speedUnitSystem: String,
  ): List<AlertRuleEntity> {
    val parsed = requireNotNull(AlertPresetSpec.parse(spec)) { "Invalid preset spec" }
    val input = PresetInput(topSpeedKmh ?: 50.0, hasBatteryConfig, speedUnitSystem)
    return records("", metric, AlertPresetGenerator.generate(metric, parsed, input), createdAt = 0)
  }

  /** Each metric's stored spec, or the app default when it has no row. */
  suspend fun specs(dao: TelemetryDao, boardId: String): Map<String, String> {
    val rows = presetRows(dao.getAlertRules(boardId))
    return metrics.associateWith { rows[it]?.spec ?: DEFAULT_SPEC.encode() }
  }

  /**
   * The Board's rules as native evaluates them and JS reads them: rider rules plus expanded presets.
   * A missing or tombstoned Board expands nothing. A metric that fails to expand is passed to
   * [reportFailure] and skipped, so the rider rules and the other metrics still load.
   */
  suspend fun expandedRules(dao: TelemetryDao, boardId: String, reportFailure: (Throwable) -> Unit): List<AlertRuleEntity> {
    val rows = dao.getAlertRules(boardId)
    val riderRules = rows.filterNot { isPresetId(it.id) }
    val board = dao.getBoard(boardId)
    if (board == null || board.deletedAt != null) return riderRules
    val presets = presetRows(rows)
    val settings = dao.getBoardSettings(boardId).associate { it.key to decodeSettingJson(it.valueJson) }
    val units = validUnitSystem(dao.getAppSetting("unitSystem")?.let { decodeSettingJson(it.valueJson) }) ?: "metric"
    val expanded = metrics.flatMap { metric ->
      try {
        // A row this app cannot read expands to nothing rather than the default.
        val spec = presets[metric]?.let { AlertPresetSpec.parse(it.spec) ?: AlertPresetSpec("off") } ?: DEFAULT_SPEC
        val field = AlertPresetGenerator.matchField(metric).takeIf { spec.option("match") == "on" }
        val input = PresetInput(
          topSpeedKmh = (settings["topSpeedKmh"] as? Number)?.toDouble() ?: 50.0,
          hasBatteryConfig = AlertPresetGenerator.validBattery(settings["batteryConfig"]),
          speedUnitSystem = units,
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

  /** Rewrite [metric]'s preset row with exactly one of a new level, geiger level, or match choice. */
  suspend fun apply(dao: TelemetryDao, boardId: String, metric: String, level: String?, geiger: String?, match: Boolean?) {
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
    dao.upsertAlertRule(presetRow(boardId, metric, next.encode(), System.currentTimeMillis()))
  }

  /** [metric]'s stored preset row holding [spec]; rejects an unknown metric or a non-preset spec. */
  fun presetRow(boardId: String, metric: String, spec: String, createdAt: Long): AlertRuleEntity {
    require(metric in metrics) { "Unknown alert preset metric" }
    require(AlertPresetSpec.parse(spec) != null) { "Invalid preset spec" }
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

  private suspend fun resolveBase(dao: TelemetryDao, boardId: String, fieldId: String): Double? {
    fun values(raw: String?) = raw?.let { jsonValue(JSONObject(it)) as? Map<String, Any> } ?: emptyMap()
    return resolveConfigRelativeBase(fieldId, values(dao.getLatestBoardConfigValues(boardId)?.valuesJson), values(dao.getLatestMotorConfigValues(boardId)?.valuesJson))
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
        id = "${rowId(metric)}:$index",
        controlId = metric,
        threshold = spec.point.threshold,
        thresholdMax = spec.point.thresholdMax,
        thresholdKind = if (spec.relation == null) "fixed" else "config-relative",
        configFieldId = spec.relation?.fieldId,
        thresholdOffset = spec.relation?.offset,
        thresholdMaxOffset = spec.relation?.maxOffset,
        enabled = true,
        spec = spec.soundType,
        createdAt = createdAt,
        repeatEverySeconds = spec.point.repeatSeconds,
      )
    }
}
