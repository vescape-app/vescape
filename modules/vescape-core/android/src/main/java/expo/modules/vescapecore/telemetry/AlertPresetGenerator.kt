package expo.modules.vescapecore.telemetry

import org.json.JSONObject
import kotlin.math.floor

internal data class PresetPoint(val threshold: Double, val thresholdMax: Double? = null, val repeatSeconds: Long? = null)
internal data class PresetRelation(val fieldId: String, val offset: Double, val maxOffset: Double?)
internal data class GeneratedPresetRule(val point: PresetPoint, val soundType: String, val relation: PresetRelation? = null)
internal data class PresetInput(
  val topSpeedKmh: Double = 50.0,
  val hasBatteryConfig: Boolean = false,
  val speedUnitSystem: String = "metric",
  val matchBoardConfig: Boolean = false,
  val configBase: Double? = null,
)

internal data class PresetDefinition(
  val soundType: String,
  val levels: Map<String, List<PresetPoint>>,
  val scaledByTopSpeed: Boolean,
  val requiresBatteryConfig: Boolean,
)
internal data class PresetMatchDefinition(val fieldId: String, val levels: Map<String, List<PresetPoint>>)

/** Typed catalog and pure calculation shared by saved presets and unsaved wizard previews.
 * @parity /modules/vescape-core/ios/telemetry/AlertPresetGenerator.swift
 */
internal object AlertPresetGenerator {
  val metrics = listOf("speed", "duty", "motor-temp", "controller-temp", "battery")
  val activeLevels = setOf("safe", "normal", "minimal")
  val levels = activeLevels + setOf("off", "custom")
  private const val KMH_PER_MPH = 1.609344

  private fun resource(name: String): JSONObject {
    val stream = checkNotNull(javaClass.getResourceAsStream("/$name.json")) { "Missing preset resource: $name" }
    return stream.bufferedReader().use { JSONObject(it.readText()) }
  }

  private val definitions: Map<String, PresetDefinition> by lazy {
    val catalog = resource("alert-preset-definitions").getJSONObject("metrics")
    metrics.associateWith { metric ->
      val value = catalog.getJSONObject(metric)
      val scaled = optionalBoolean(value, "scaledByTopSpeed")
      require(!scaled || value.getString("family") == "geiger") { "Scaled preset must be a range" }
      PresetDefinition(
        soundType = value.getString("soundType"),
        levels = parseLevels(value),
        scaledByTopSpeed = scaled,
        requiresBatteryConfig = optionalBoolean(value, "requiresBatteryConfig"),
      )
    }
  }
  private val matches: Map<String, PresetMatchDefinition> by lazy {
    val catalog = resource("alert-preset-definitions").getJSONObject("match")
    catalog.keys().asSequence().associateWith { metric ->
      require(metric in metrics) { "Unknown preset match metric: $metric" }
      val value = catalog.getJSONObject(metric)
      PresetMatchDefinition(value.getString("fieldId"), parseLevels(value))
    }
  }
  private val cellPresetIds: Set<String> by lazy {
    val cells = resource("cell-presets").getJSONArray("cells")
    (0 until cells.length()).map { cells.getJSONObject(it).getString("id") }.toSet()
  }

  private fun parseLevels(value: JSONObject): Map<String, List<PresetPoint>> {
    val levels = value.getJSONObject("levels")
    return activeLevels.associateWith { level ->
      when (value.getString("family")) {
        "geiger" -> {
          val range = levels.getJSONObject(level)
          listOf(PresetPoint(finiteNumber(range, "start"), finiteNumber(range, "ceiling")))
        }
        "discrete" -> {
          val points = levels.getJSONArray(level)
          require(points.length() > 0) { "Empty preset ladder" }
          (0 until points.length()).map { index ->
            val point = points.getJSONObject(index)
            val repeat = if (point.isNull("repeatEverySeconds")) null else finiteNumber(point, "repeatEverySeconds")
            require(repeat == null || (repeat > 0 && repeat == floor(repeat))) { "Invalid preset repeat interval" }
            PresetPoint(finiteNumber(point, "threshold"), repeatSeconds = repeat?.toLong())
          }
        }
        else -> error("Unknown preset family")
      }
    }
  }

  private fun optionalBoolean(value: JSONObject, key: String): Boolean {
    if (!value.has(key)) return false
    return value.get(key) as? Boolean ?: error("Invalid preset boolean: $key")
  }

  private fun finiteNumber(value: JSONObject, key: String): Double {
    val number = (value.get(key) as? Number)?.toDouble()
    require(number != null && number.isFinite()) { "Invalid preset number: $key" }
    return number
  }

  fun matchField(metric: String): String? = matches[metric]?.fieldId

  fun validBattery(raw: Any?): Boolean {
    val config = raw as? Map<*, *> ?: return false
    return when (config["mode"]) {
      "manual" -> {
        val min = (config["minVoltage"] as? Number)?.toDouble() ?: return false
        val max = (config["maxVoltage"] as? Number)?.toDouble() ?: return false
        max > min
      }
      "preset" -> config["cellPresetId"] in cellPresetIds
      else -> false
    }
  }

  fun generate(metric: String, level: String, input: PresetInput): List<GeneratedPresetRule> {
    require(metric in metrics) { "Unknown alert preset metric" }
    require(level in levels) { "Invalid preset level" }
    require(input.speedUnitSystem in setOf("metric", "imperial")) { "Invalid unit system" }
    if (level !in activeLevels) return emptyList()
    val definition = definitions.getValue(metric)
    val match = matches[metric].takeIf { input.matchBoardConfig }
    if (match != null) return relativeRules(definition, match, level, input.configBase)
    if (definition.requiresBatteryConfig && !input.hasBatteryConfig) return emptyList()
    return fixedRules(definition, level, input)
  }

  private fun fixedRules(
    definition: PresetDefinition,
    level: String,
    input: PresetInput,
  ): List<GeneratedPresetRule> =
    definition.levels.getValue(level).map { point ->
      val threshold = if (definition.scaledByTopSpeed) speedRange(point, input) else point
      GeneratedPresetRule(threshold, definition.soundType)
    }

  private fun relativeRules(
    definition: PresetDefinition,
    match: PresetMatchDefinition,
    level: String,
    base: Double?,
  ): List<GeneratedPresetRule> =
    match.levels.getValue(level).map { offset ->
      val relation = PresetRelation(match.fieldId, offset.threshold, offset.thresholdMax)
      val point = if (base == null) {
        // No anchor yet: persist the relationship, but no firing threshold.
        PresetPoint(threshold = 0.0, repeatSeconds = offset.repeatSeconds)
      } else {
        PresetPoint(
          threshold = roundTenth(base + offset.threshold),
          thresholdMax = offset.thresholdMax?.let { roundTenth(base + it) },
          repeatSeconds = offset.repeatSeconds,
        )
      }
      GeneratedPresetRule(point, definition.soundType, relation)
    }

  private fun speedRange(point: PresetPoint, input: PresetInput): PresetPoint {
    val top = input.topSpeedKmh.takeIf { it.isFinite() && it > 0 } ?: 50.0
    val start = roundTenth(point.threshold * top)
    val ceiling = roundTenth(checkNotNull(point.thresholdMax) * top)
    if (input.speedUnitSystem == "metric") return PresetPoint(start, ceiling)
    val endMph = maxOf(1.0, minOf(floor(top / KMH_PER_MPH), floor(ceiling / KMH_PER_MPH + 0.5)))
    val startMph = maxOf(0.0, minOf(endMph - 1, floor(start / KMH_PER_MPH + 0.5)))
    return PresetPoint(startMph * KMH_PER_MPH, endMph * KMH_PER_MPH)
  }

  private fun roundTenth(value: Double) = floor(value * 10 + 0.5) / 10
}
