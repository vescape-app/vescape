package expo.modules.vescapecore.weather

import expo.modules.vescapecore.alerts.AlertSeverity
import expo.modules.vescapecore.alerts.VoiceAnnouncement
import expo.modules.vescapecore.alerts.VoiceValue
import kotlin.math.roundToInt

/**
 * Older forecasts speak nothing: a rider offline must not be warned from old data.
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `weatherAlertMaxForecastAgeMs`
 */
const val WEATHER_ALERT_MAX_FORECAST_AGE_MS = 30 * 60 * 1_000L

private const val MINUTE_MS = 60_000L
private const val HORIZON_MIN = 180
/** At or under this lead the evaluator reads `minutely_15`, above it hourly. */
private const val QUARTER_HOUR_WINDOW_MIN = 60
/** Above [QUARTER_HOUR_WINDOW_MIN], a rung this soon after the previous weather line is skipped. */
private const val LINE_GAP_MS = 30 * MINUTE_MS
/** A kind with no slot over its threshold for this long forgets its event. */
private const val REARM_MS = 30 * MINUTE_MS

/**
 * The condition a Weather Alert is about. Declaration order is speaking priority, highest first.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertKind`
 */
internal enum class WeatherAlertKind(val voiceKey: String) {
    STORM("weather.storm"),
    WIND("weather.wind"),
    RAIN("weather.rain"),
}

/** Thunderstorm (95/96/99) and freezing drizzle/rain (56/57/66/67): storm-grade, no probability gate. */
private val STORM_WEATHER_CODES = setOf(56, 57, 66, 67, 95, 96, 99)

/** Rain gate: probability applies to hourly slots only, intensity to both. */
internal data class RainThresholds(val minProbabilityPercent: Int, val minMmPerHour: Double)

/** Wind gate: the slot's peak gust, km/h. */
internal data class WindThresholds(val minGustKmh: Double)

/**
 * How bad weather must be to speak. Native-owned so thresholds retune without a migration.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertLevel`
 */
internal enum class WeatherAlertLevel(val rain: RainThresholds, val wind: WindThresholds) {
    SENSITIVE(RainThresholds(30, 0.3), WindThresholds(40.0)),
    NORMAL(RainThresholds(50, 1.0), WindThresholds(55.0)),
    SEVERE(RainThresholds(70, 4.0), WindThresholds(70.0)),
}

/**
 * One line due: [leadMinutes] until the event starts (0 is "now"), [percent] its chance on far rungs.
 *
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
}

/** The tracked event of one kind: the closest lead already spoken (or skipped), and when it was last seen. */
internal data class WeatherEventState(val spokenMinutes: Int, val lastSeenMs: Long)

/** @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertState` */
internal data class WeatherAlertState(
    val events: Map<WeatherAlertKind, WeatherEventState> = emptyMap(),
    val lastLineAtMs: Long? = null,
)

internal data class WeatherAlertResult(val lines: List<WeatherAlertLine>, val state: WeatherAlertState)

private class WeatherEvent(val startMs: Long, val probability: Int?)

/**
 * Weather Alert Evaluator: what to say about [weather] at [nowMs], given what was said before.
 * Pure; the caller owns the clock, the live-connection gate and the state.
 *
 * Per kind, the event is its earliest slot over [level] within 3 h. The first line speaks the lead
 * rounded down; after it only a closer ladder rung (2h, 1h, 30, 15, now) speaks, once. An event
 * that vanishes keeps its state, so a downgrade is silent and a reappearance only escalates.
 *
 * Only the highest active kind speaks (storm > wind > rain). A lower kind under an active higher one
 * still tracks its ladder, so its passed rungs are consumed silently rather than spoken late.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `evaluateWeatherAlerts`
 */
internal fun evaluateWeatherAlerts(
    weather: Weather,
    level: WeatherAlertLevel,
    nowMs: Long,
    state: WeatherAlertState,
): WeatherAlertResult {
    if (nowMs - weather.fetchedAtMs > WEATHER_ALERT_MAX_FORECAST_AGE_MS) return WeatherAlertResult(emptyList(), state)
    var events = state.events
    var lastLineAtMs = state.lastLineAtMs
    val lines = mutableListOf<WeatherAlertLine>()
    var higherActive = false
    for (kind in WeatherAlertKind.entries) {
        val prior = events[kind]
        val event = nextEvent(kind, weather, level, nowMs)
        if (event == null) {
            if (prior != null && nowMs - prior.lastSeenMs >= REARM_MS) events = events - kind
            continue
        }
        val lead = ((event.startMs - nowMs) / MINUTE_MS).toInt().coerceAtLeast(0)
        val spoken: Int?
        val stored: Int
        if (prior == null) {
            spoken = firstLeadMinutes(lead)
            stored = spoken
        } else {
            val rung = ladderRung(lead)
            when {
                rung == null || rung >= prior.spokenMinutes -> { spoken = null; stored = prior.spokenMinutes }
                // Skipped rungs are consumed, so a late line never names a rung already passed.
                rung > QUARTER_HOUR_WINDOW_MIN && lastLineAtMs != null && nowMs - lastLineAtMs < LINE_GAP_MS ->
                    { spoken = null; stored = rung }
                else -> { spoken = rung; stored = rung }
            }
        }
        events = events + (kind to WeatherEventState(stored, nowMs))
        val suppressed = higherActive
        higherActive = true
        if (spoken != null && !suppressed) {
            val percent = event.probability
                ?.takeIf { kind == WeatherAlertKind.RAIN && spoken > QUARTER_HOUR_WINDOW_MIN }
                ?.let(::percentClip)
            lines += WeatherAlertLine(kind, spoken, percent)
            lastLineAtMs = nowMs
        }
    }
    return WeatherAlertResult(lines, WeatherAlertState(events, lastLineAtMs))
}

/**
 * First line: above 1 h down to 30 min (capped at 3 h), from 15 min down to 15 min, under it "now".
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `firstLeadMinutes`
 */
internal fun firstLeadMinutes(lead: Int): Int = when {
    lead > QUARTER_HOUR_WINDOW_MIN -> minOf(HORIZON_MIN, lead / 30 * 30)
    lead >= 15 -> lead / 15 * 15
    else -> 0
}

/** Closest ladder rung [lead] has crossed, or null while it is still beyond 2 h. */
private fun ladderRung(lead: Int): Int? = when {
    lead <= 0 -> 0
    lead <= 15 -> 15
    lead <= 30 -> 30
    lead <= 60 -> 60
    lead <= 120 -> 120
    else -> null
}

/** Nearest ten, 10–100: the `percent` clips a line can speak. */
private fun percentClip(probability: Int): Int = ((probability / 10.0).roundToInt() * 10).coerceIn(10, 100)

private fun nextEvent(kind: WeatherAlertKind, weather: Weather, level: WeatherAlertLevel, nowMs: Long): WeatherEvent? {
    val window = QUARTER_HOUR_WINDOW_MIN * MINUTE_MS
    val near = weather.quarterHourSlots.filter {
        it.endMs > nowMs && it.startMs - nowMs <= window && qualifies(kind, it, level, hourly = false)
    }
    val far = weather.hourlySlots.filter {
        val lead = it.startMs - nowMs
        lead > window && lead <= HORIZON_MIN * MINUTE_MS && qualifies(kind, it, level, hourly = true)
    }
    val first = (near + far).minByOrNull { it.startMs } ?: return null
    return WeatherEvent(first.startMs, first.precipitationProbability)
}

private fun qualifies(kind: WeatherAlertKind, slot: WeatherSlot, level: WeatherAlertLevel, hourly: Boolean): Boolean =
    when (kind) {
        WeatherAlertKind.STORM -> slot.weatherCode in STORM_WEATHER_CODES
        WeatherAlertKind.WIND -> (slot.windGustsKmh ?: 0.0) >= level.wind.minGustKmh
        WeatherAlertKind.RAIN -> {
            val gate = level.rain
            slot.precipitationMmPerHour >= gate.minMmPerHour &&
                (!hourly || (slot.precipitationProbability ?: 0) >= gate.minProbabilityPercent)
        }
    }

/**
 * Runs the evaluator against the live forecast while a Board is connected and hands due lines to
 * [speak]. State lives as long as this monitor (the Board Session, per app process), so a Bluetooth
 * dropout and reconnect never re-announces; [rideEnded] forgets it. Main thread only.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertMonitor`
 */
internal class WeatherAlertMonitor(
    private val isLive: () -> Boolean,
    private val speak: (WeatherAlertLine) -> Unit,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private var state = WeatherAlertState()

    /** Evaluate [weather] (a refresh, or the known forecast at connect); silent off a live link. */
    fun evaluate(weather: Weather?) {
        if (weather == null || !isLive()) return
        val result = evaluateWeatherAlerts(weather, LEVEL, nowMs(), state)
        state = result.state
        result.lines.forEach(speak)
    }

    fun rideEnded() {
        state = WeatherAlertState()
    }

    private companion object {
        /** Fixed until rider-set levels land (#600). */
        val LEVEL = WeatherAlertLevel.NORMAL
    }
}
