package expo.modules.vescapecore.weather

import expo.modules.vescapecore.alerts.AlertSeverity
import expo.modules.vescapecore.alerts.VoiceAnnouncement
import expo.modules.vescapecore.alerts.VoiceValue
import kotlin.math.roundToInt

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `weatherAlertMaxForecastAgeMs`
 */
const val WEATHER_ALERT_MAX_FORECAST_AGE_MS = 30 * 60 * 1_000L

private const val MINUTE_MS = 60_000L
private const val HORIZON_MIN = 180
private const val QUARTER_HOUR_WINDOW_MIN = 60
private const val LINE_GAP_MS = 30 * MINUTE_MS
private const val REARM_MS = 30 * MINUTE_MS

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertTrack`
 */
internal enum class WeatherAlertTrack { PRECIPITATION, WIND }

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertKind`
 * @parity /modules/vescape-core/src/index.ts `WeatherAlertPreviewKind`
 */
internal enum class WeatherAlertKind(val voiceKey: String, val track: WeatherAlertTrack) {
    STORM("weather.storm", WeatherAlertTrack.PRECIPITATION),
    RAIN("weather.rain", WeatherAlertTrack.PRECIPITATION),
    WIND("weather.wind", WeatherAlertTrack.WIND),
}

private val STORM_WEATHER_CODES = setOf(95, 96, 99)

internal data class RainThresholds(val minProbabilityPercent: Int, val minMmPerHour: Double)

internal data class WindThresholds(val minGustKmh: Double)

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertLevel`
 */
internal enum class WeatherAlertLevel(val key: String, val rain: RainThresholds, val wind: WindThresholds) {
    SENSITIVE("sensitive", RainThresholds(30, 0.3), WindThresholds(40.0)),
    NORMAL("normal", RainThresholds(50, 1.0), WindThresholds(55.0)),
    EXTREME("extreme", RainThresholds(70, 4.0), WindThresholds(70.0)),
    ;

    companion object {
        fun of(key: String): WeatherAlertLevel? = entries.firstOrNull { it.key == key }
    }
}

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `weatherAlertLevelSettings`
 * @parity /modules/vescape-core/src/index.ts `WeatherAlertLevelSetting`
 */
internal val WEATHER_ALERT_LEVEL_SETTINGS = listOf("off") + WeatherAlertLevel.entries.map { it.key }

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertSettings`
 */
internal data class WeatherAlertSettings(
    val rain: WeatherAlertLevel? = WeatherAlertLevel.NORMAL,
    val wind: WeatherAlertLevel? = WeatherAlertLevel.NORMAL,
) {
    fun enabled(kind: WeatherAlertKind): Boolean = when (kind) {
        WeatherAlertKind.STORM -> true
        WeatherAlertKind.WIND -> wind != null
        WeatherAlertKind.RAIN -> rain != null
    }

    companion object {
        fun of(rainLevel: String, windLevel: String) =
            WeatherAlertSettings(WeatherAlertLevel.of(rainLevel), WeatherAlertLevel.of(windLevel))
    }
}

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertLine`
 */
internal data class WeatherAlertLine(val kind: WeatherAlertKind, val leadMinutes: Int, val percent: Int?) {
    fun voiceAnnouncement(): VoiceAnnouncement =
        if (leadMinutes == 0) VoiceAnnouncement(AlertSeverity.WARNING, "${kind.voiceKey}.now")
        else VoiceAnnouncement(
            AlertSeverity.WARNING,
            kind.voiceKey,
            listOfNotNull(VoiceValue("duration", leadMinutes), percent?.let { VoiceValue("percent", it) }),
        )

    companion object {
        /**
         * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertLine.preview`
         */
        fun preview(kind: String, leadMinutes: Int, percent: Int?): WeatherAlertLine? =
            WeatherAlertKind.entries.firstOrNull { it.name.equals(kind, ignoreCase = true) }
                ?.let { WeatherAlertLine(it, leadMinutes.coerceAtLeast(0), percent.takeIf { _ -> it.speaksPercent }) }
    }
}

internal data class WeatherEventState(val spokenMinutes: Int, val lastSeenMs: Long, val lastUnderwayMs: Long? = null)

private val WeatherAlertKind.speaksPercent: Boolean get() = this != WeatherAlertKind.WIND

/** @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertState` */
internal data class WeatherAlertState(
    val events: Map<WeatherAlertKind, WeatherEventState> = emptyMap(),
    val lastLineAtMs: Map<WeatherAlertTrack, Long> = emptyMap(),
)

internal data class WeatherAlertResult(val lines: List<WeatherAlertLine>, val state: WeatherAlertState)

private class WeatherEvent(val startMs: Long, val probability: Int?)

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `evaluateWeatherAlerts`
 */
internal fun evaluateWeatherAlerts(
    weather: Weather,
    settings: WeatherAlertSettings,
    nowMs: Long,
    state: WeatherAlertState,
): WeatherAlertResult {
    if (nowMs - weather.fetchedAtMs > WEATHER_ALERT_MAX_FORECAST_AGE_MS) return WeatherAlertResult(emptyList(), state)
    var events = state.events
    var lastLines = state.lastLineAtMs
    val lines = mutableListOf<WeatherAlertLine>()
    val activeTracks = mutableSetOf<WeatherAlertTrack>()
    for (kind in WeatherAlertKind.entries) {
        val lastLineAtMs = lastLines[kind.track]
        if (!settings.enabled(kind)) {
            events = events - kind
            continue
        }
        val event = nextEvent(kind, weather, settings, nowMs)
        if (event == null) {
            val prior = events[kind]
            if (prior != null && nowMs - prior.lastSeenMs >= REARM_MS) events = events - kind
            continue
        }
        val lead = ((event.startMs - nowMs) / MINUTE_MS).toInt().coerceAtLeast(0)
        val prior = events[kind]?.takeUnless {
            lead > 0 && it.lastUnderwayMs != null && nowMs - it.lastUnderwayMs >= REARM_MS
        }
        val spoken: Int?
        val stored: Int
        if (prior == null) {
            spoken = firstLeadMinutes(lead)
            stored = spoken
        } else {
            val rung = ladderRung(lead)
            when {
                rung == null || rung >= prior.spokenMinutes -> { spoken = null; stored = prior.spokenMinutes }
                rung > QUARTER_HOUR_WINDOW_MIN && lastLineAtMs != null && nowMs - lastLineAtMs < LINE_GAP_MS ->
                    { spoken = null; stored = rung }
                else -> { spoken = rung; stored = rung }
            }
        }
        val lastUnderwayMs = if (lead == 0) nowMs else prior?.lastUnderwayMs
        events = events + (kind to WeatherEventState(stored, nowMs, lastUnderwayMs))
        if (activeTracks.add(kind.track) && spoken != null) {
            val percent = event.probability
                ?.takeIf { kind.speaksPercent && spoken > QUARTER_HOUR_WINDOW_MIN }
                ?.let(::percentClip)
            lines += WeatherAlertLine(kind, spoken, percent)
            lastLines = lastLines + (kind.track to nowMs)
        }
    }
    return WeatherAlertResult(lines, WeatherAlertState(events, lastLines))
}

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `firstLeadMinutes`
 */
internal fun firstLeadMinutes(lead: Int): Int = when {
    lead > QUARTER_HOUR_WINDOW_MIN -> minOf(HORIZON_MIN, lead / 30 * 30)
    lead >= 15 -> lead / 15 * 15
    else -> 0
}

private fun ladderRung(lead: Int): Int? = when {
    lead <= 0 -> 0
    lead <= 15 -> 15
    lead <= 30 -> 30
    lead <= 60 -> 60
    lead <= 120 -> 120
    else -> null
}

private fun percentClip(probability: Int): Int = ((probability / 10.0).roundToInt() * 10).coerceIn(10, 100)

private fun nextEvent(kind: WeatherAlertKind, weather: Weather, settings: WeatherAlertSettings, nowMs: Long): WeatherEvent? {
    val window = QUARTER_HOUR_WINDOW_MIN * MINUTE_MS
    val quarters = weather.quarterHourSlots.isNotEmpty()
    val near = (if (quarters) weather.quarterHourSlots else weather.hourlySlots).filter {
        it.endMs > nowMs && it.startMs - nowMs <= window && qualifies(kind, it, settings, hourly = !quarters)
    }
    val far = weather.hourlySlots.filter {
        val lead = it.startMs - nowMs
        lead > window && lead <= HORIZON_MIN * MINUTE_MS && qualifies(kind, it, settings, hourly = true)
    }
    val first = (near + far).minByOrNull { it.startMs } ?: return null
    return WeatherEvent(first.startMs, first.precipitationProbability)
}

private fun qualifies(kind: WeatherAlertKind, slot: WeatherSlot, settings: WeatherAlertSettings, hourly: Boolean): Boolean =
    when (kind) {
        WeatherAlertKind.STORM -> slot.weatherCode in STORM_WEATHER_CODES
        WeatherAlertKind.WIND -> settings.wind?.let { (slot.windGustsKmh ?: 0.0) >= it.wind.minGustKmh } ?: false
        WeatherAlertKind.RAIN -> settings.rain?.rain?.let { gate ->
            slot.precipitationMmPerHour >= gate.minMmPerHour &&
                (!hourly || (slot.precipitationProbability ?: 0) >= gate.minProbabilityPercent)
        } ?: false
    }

/**
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertMonitor`
 */
internal class WeatherAlertMonitor(
    private val isLive: () -> Boolean,
    private val speak: (WeatherAlertLine) -> Unit,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private var state = WeatherAlertState()

    @Volatile var settings = WeatherAlertSettings()

    fun evaluate(weather: Weather?) {
        if (weather == null || !isLive()) return
        val result = evaluateWeatherAlerts(weather, settings, nowMs(), state)
        state = result.state
        result.lines.forEach(speak)
    }

    fun rideEnded() {
        state = WeatherAlertState()
    }
}
