package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.alerts.AlertPresetSpec
import expo.modules.vescapecore.alerts.GeigerLevel
import org.json.JSONObject
import kotlin.math.floor

internal data class PresetPoint(val threshold: Double, val thresholdMax: Double? = null, val repeatSeconds: Long? = null)
internal data class PresetRelation(val fieldId: String, val offset: Double, val maxOffset: Double?)
internal data class GeneratedPresetRule(val point: PresetPoint, val soundType: String, val relation: PresetRelation? = null)
internal data class PresetInput(
  val topSpeedKmh: Double = 50.0,
  val hasBatteryConfig: Boolean = false,
  val speedUnitSystem: String = "metric",
  /** Base of the metric's config-relative points; read only when its spec has `match=on`. */
  val configBase: Double? = null,
)

internal data class PresetDefinition(
  val soundType: String,
  val levels: Map<String, List<PresetPoint>>,
  val scaledByTopSpeed: Boolean,
  val requiresBatteryConfig: Boolean,
)
internal data class PresetMatchDefinition(val fieldId: String, val levels: Map<String, List<PresetPoint>>)

/** Typed catalog and pure expansion of a preset spec, shared by saved rows and unsaved wizard previews.
 * @parity /modules/vescape-core/ios/telemetry/AlertPresetGenerator.swift
 */
internal object AlertPresetGenerator {
  val metrics = listOf("speed", "duty", "motor-temp", "controller-temp", "battery")
  val activeLevels = setOf("safe", "normal", "minimal")
  val levels = activeLevels + "off"
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

  /** True when [metric]'s definition ticks, so its spec may carry a `geiger=` option. */
  fun hasGeiger(metric: String): Boolean = definitions[metric]?.soundType?.startsWith("geiger:") == true

  /**
   * The rules [spec] stands for. `off`, an unknown level (from a newer app), or a guard failure
   * expands to none. `match=on` gives config-relative points; `geiger=` replaces the tick level.
   */
  fun generate(metric: String, spec: AlertPresetSpec, input: PresetInput): List<GeneratedPresetRule> {
    require(metric in metrics) { "Unknown alert preset metric" }
    require(input.speedUnitSystem in setOf("metric", "imperial")) { "Invalid unit system" }
    val level = spec.level.takeIf { it in activeLevels } ?: return emptyList()
    val definition = definitions.getValue(metric)
    val geiger = spec.option("geiger")?.takeIf { value -> GeigerLevel.entries.any { it.id == value } }
    val soundType = if (geiger != null && definition.soundType.startsWith("geiger:")) "geiger:$geiger" else definition.soundType
    val match = matches[metric].takeIf { spec.option("match") == "on" }
    if (match != null) return relativeRules(soundType, match, level, input.configBase)
    if (definition.requiresBatteryConfig && !input.hasBatteryConfig) return emptyList()
    return fixedRules(definition, soundType, level, input)
  }

  private fun fixedRules(
    definition: PresetDefinition,
    soundType: String,
    level: String,
    input: PresetInput,
  ): List<GeneratedPresetRule> =
    definition.levels.getValue(level).let { points ->
      points.mapIndexed { index, point ->
        val threshold = if (definition.scaledByTopSpeed) speedRange(point, input) else point
        GeneratedPresetRule(threshold, pointSoundType(soundType, index, points.size))
      }
    }

  private fun relativeRules(
    soundType: String,
    match: PresetMatchDefinition,
    level: String,
    base: Double?,
  ): List<GeneratedPresetRule> =
    match.levels.getValue(level).let { offsets -> offsets.mapIndexed { index, offset ->
      val relation = PresetRelation(match.fieldId, offset.threshold, offset.thresholdMax)
      val point = if (base == null) {
        // No anchor yet: keep the relationship, but no firing threshold.
        PresetPoint(threshold = 0.0, repeatSeconds = offset.repeatSeconds)
      } else {
        PresetPoint(
          threshold = roundTenth(base + offset.threshold),
          thresholdMax = offset.thresholdMax?.let { roundTenth(base + it) },
          repeatSeconds = offset.repeatSeconds,
        )
      }
      GeneratedPresetRule(point, pointSoundType(soundType, index, offsets.size), relation)
    } }

  /**
   * Sound of a ladder's point [index] of [count]. A `voice:<key>` definition speaks each point with a
   * severity by rank: the last (most severe) point `critical`, the first `info`, the rest `warning`;
   * a one-point ladder is `critical`.
   *
   * @parity /modules/vescape-core/ios/telemetry/AlertPresetGenerator.swift `pointSoundType`
   */
  private fun pointSoundType(soundType: String, index: Int, count: Int): String {
    if (!soundType.startsWith("voice:")) return soundType
    val severity = when (index) {
      count - 1 -> "critical"
      0 -> "info"
      else -> "warning"
    }
    return "voice($severity):${soundType.removePrefix("voice:")}"
  }

  private fun speedRange(point: PresetPoint, input: PresetInput): PresetPoint {
    val top = input.topSpeedKmh.takeIf { it.isFinite() && it > 0 } ?: 50.0
    val unitScale = if (input.speedUnitSystem == "imperial") KMH_PER_MPH else 1.0
    val ceiling = maxOf(1.0, minOf(floor(top / unitScale), floor(checkNotNull(point.thresholdMax) * top / unitScale + 0.5)))
    val start = maxOf(0.0, minOf(ceiling - 1, floor(point.threshold * top / unitScale + 0.5)))
    return PresetPoint(start * unitScale, ceiling * unitScale)
  }

  private fun roundTenth(value: Double) = floor(value * 10 + 0.5) / 10
}
