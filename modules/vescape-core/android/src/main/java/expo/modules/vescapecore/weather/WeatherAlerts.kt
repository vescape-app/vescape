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
/** Above [QUARTER_HOUR_WINDOW_MIN], a rung this soon after the previous line of its track is skipped. */
private const val LINE_GAP_MS = 30 * MINUTE_MS
/** A kind clear this long forgets its event: nothing over its threshold, or its event over and the next not yet begun. */
private const val REARM_MS = 30 * MINUTE_MS

/**
 * An independent Weather Alert line: its own events, gap and priority. Declaration order is
 * enqueue order when both speak in one evaluation.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertTrack`
 */
internal enum class WeatherAlertTrack { PRECIPITATION, WIND }

/**
 * The condition a Weather Alert is about. Within a [track], declaration order is speaking
 * priority, highest first: storm outranks rain; wind is a track of its own.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertKind`
 * @parity /modules/vescape-core/src/index.ts `WeatherAlertPreviewKind`
 */
internal enum class WeatherAlertKind(val voiceKey: String, val track: WeatherAlertTrack) {
    STORM("weather.storm", WeatherAlertTrack.PRECIPITATION),
    RAIN("weather.rain", WeatherAlertTrack.PRECIPITATION),
    WIND("weather.wind", WeatherAlertTrack.WIND),
}

/** Thunderstorm only (95/96/99): storm-grade, no probability gate. */
private val STORM_WEATHER_CODES = setOf(95, 96, 99)

/** Rain gate: probability applies to hourly slots only, intensity to both. */
internal data class RainThresholds(val minProbabilityPercent: Int, val minMmPerHour: Double)

/** Wind gate: the slot's peak gust, km/h. */
internal data class WindThresholds(val minGustKmh: Double)

/**
 * How bad weather must be to speak. Native-owned so thresholds retune without a migration.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertLevel`
 */
internal enum class WeatherAlertLevel(val key: String, val rain: RainThresholds, val wind: WindThresholds) {
    SENSITIVE("sensitive", RainThresholds(30, 0.3), WindThresholds(40.0)),
    NORMAL("normal", RainThresholds(50, 1.0), WindThresholds(55.0)),
    EXTREME("extreme", RainThresholds(70, 4.0), WindThresholds(70.0)),
    ;

    companion object {
        /** Stored setting value to level; `off` and unknown values are null. */
        fun of(key: String): WeatherAlertLevel? = entries.firstOrNull { it.key == key }
    }
}

/**
 * Stored values of the rain and wind alert level settings: `off` or a [WeatherAlertLevel] key.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `weatherAlertLevelSettings`
 * @parity /modules/vescape-core/src/index.ts `WeatherAlertLevelSetting`
 */
internal val WEATHER_ALERT_LEVEL_SETTINGS = listOf("off") + WeatherAlertLevel.entries.map { it.key }
internal const val WEATHER_ALERT_LEVEL_DEFAULT = "normal"

/**
 * The rider's Weather Alert settings: a null level turns that kind off. Storms always speak.
 *
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

    companion object {
        /**
         * The line the evaluator would speak for [kind] (`storm`/`wind`/`rain`), for the dev preview.
         * @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertLine.preview`
         */
        fun preview(kind: String, leadMinutes: Int, percent: Int?): WeatherAlertLine? =
            WeatherAlertKind.entries.firstOrNull { it.name.equals(kind, ignoreCase = true) }
                ?.let { WeatherAlertLine(it, leadMinutes.coerceAtLeast(0), percent.takeIf { _ -> it.speaksPercent }) }
    }
}

/**
 * The tracked event of one kind: the closest lead already spoken (or skipped), when it was last
 * seen in the window, and when it was last underway (null until it starts).
 */
internal data class WeatherEventState(val spokenMinutes: Int, val lastSeenMs: Long, val lastUnderwayMs: Long? = null)

/** Storm and rain lines add the slot's precipitation chance; wind has none to speak. */
private val WeatherAlertKind.speaksPercent: Boolean get() = this != WeatherAlertKind.WIND

/** @parity /modules/vescape-core/ios/weather/WeatherAlerts.swift `WeatherAlertState` */
internal data class WeatherAlertState(
    val events: Map<WeatherAlertKind, WeatherEventState> = emptyMap(),
    /** When each track last spoke, for the 30 min gap above 1 h. */
    val lastLineAtMs: Map<WeatherAlertTrack, Long> = emptyMap(),
)

internal data class WeatherAlertResult(val lines: List<WeatherAlertLine>, val state: WeatherAlertState)

private class WeatherEvent(val startMs: Long, val probability: Int?)

/**
 * Weather Alert Evaluator: what to say about [weather] at [nowMs], given what was said before.
 * Pure; the caller owns the clock, the live-connection gate and the state.
 *
 * Per enabled kind, the event is its earliest slot over its [settings] level within 3 h. The first line speaks the lead
 * rounded down; after it only a closer ladder rung (2h, 1h, 30, 15, now) speaks, once. An event
 * that vanishes keeps its state, so a downgrade is silent and a reappearance only escalates.
 *
 * Tracks are independent: storm/rain and wind each keep their own events and gap, and storm/rain
 * lines are enqueued before wind. Within storm/rain only the highest active kind speaks (storm >
 * rain); rain under an active storm still tracks its ladder, so its passed rungs are consumed
 * silently rather than spoken late. A kind turned off forgets its event and never suppresses another.
 *
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
        // A later event after 30 min clear of the one underway is a new event, even with it already in the window.
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
                // Skipped rungs are consumed, so a late line never names a rung already passed.
                rung > QUARTER_HOUR_WINDOW_MIN && lastLineAtMs != null && nowMs - lastLineAtMs < LINE_GAP_MS ->
                    { spoken = null; stored = rung }
                else -> { spoken = rung; stored = rung }
            }
        }
        val lastUnderwayMs = if (lead == 0) nowMs else prior?.lastUnderwayMs
        events = events + (kind to WeatherEventState(stored, nowMs, lastUnderwayMs))
        // `add` is false when a higher kind of the track is already active.
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

private fun nextEvent(kind: WeatherAlertKind, weather: Weather, settings: WeatherAlertSettings, nowMs: Long): WeatherEvent? {
    val window = QUARTER_HOUR_WINDOW_MIN * MINUTE_MS
    // Without a `minutely_15` series the hourly one covers the near hour too, gate and all.
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

    /** The rider's levels, applied from App Settings (off the main thread); read at the next evaluation. */
    @Volatile var settings = WeatherAlertSettings()

    /** Evaluate [weather] (a refresh, or the known forecast at connect); silent off a live link. */
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
