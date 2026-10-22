package expo.modules.vescapecore.weather

import org.junit.Assert.assertEquals
import org.junit.Test

private const val MIN = 60_000L
private const val T0 = 1_781_128_800_000L

private fun hour(startMin: Int, mm: Double = 2.0, probability: Int = 80) =
    WeatherSlot(T0 + startMin * MIN, T0 + (startMin + 60) * MIN, mm, probability, 61, null)

private fun quarter(startMin: Int, mmPerHour: Double = 2.0) =
    WeatherSlot(T0 + startMin * MIN, T0 + (startMin + 15) * MIN, mmPerHour, null, 61, null)

private fun weather(hourly: List<WeatherSlot> = emptyList(), quarters: List<WeatherSlot> = emptyList(), fetchedAtMs: Long = T0) =
    Weather(15, 61, WeatherIcon.CLOUD_RAIN, 0, emptyList(), null, null, 0.0, 0.0, fetchedAtMs, hourly, quarters)

/** Rain starting at [startMin] after T0, in whichever series covers its lead at [nowMin]. */
private fun rainAt(startMin: Int, nowMin: Int, fetchedAtMs: Long = T0 + nowMin * MIN): Weather =
    if (startMin - nowMin > 60) weather(hourly = listOf(hour(startMin)), fetchedAtMs = fetchedAtMs)
    else weather(quarters = (startMin until startMin + 60 step 15).map { quarter(it) }, fetchedAtMs = fetchedAtMs)

/** A dry hourly slot carrying only a weather code and a gust. */
private fun dryHour(startMin: Int, code: Int = 3, gustKmh: Double? = null) =
    WeatherSlot(T0 + startMin * MIN, T0 + (startMin + 60) * MIN, 0.0, 0, code, gustKmh)

/**
 * Weather Alert Evaluator: the rain ladder, rounding, gap, escalation-only, re-arm and stale guard.
 * @parity /modules/vescape-core/ios/weather/WeatherAlertsTests.swift
 */
class WeatherAlertsTest {
    private var state = WeatherAlertState()

    private fun eval(weather: Weather, nowMin: Int): List<Pair<Int, Int?>> {
        val result = evaluateWeatherAlerts(weather, WeatherAlertLevel.NORMAL, T0 + nowMin * MIN, state)
        state = result.state
        return result.lines.map { it.leadMinutes to it.percent }
    }

    @Test
    fun `first line rounds the lead down then the ladder speaks each closer rung once`() {
        assertEquals(listOf(150 to 80), eval(rainAt(170, 0), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(170, 10), 10))
        // 2h rung crossed at 115 min, more than 30 min after the first line.
        assertEquals(listOf(120 to 80), eval(rainAt(170, 55), 55))
        assertEquals(listOf(60 to null), eval(rainAt(170, 115), 115))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(170, 125), 125))
        assertEquals(listOf(30 to null), eval(rainAt(170, 145), 145))
        assertEquals(listOf(15 to null), eval(rainAt(170, 160), 160))
        assertEquals(listOf(0 to null), eval(rainAt(170, 170), 170))
        // Raining: never repeats.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(170, 185), 185))
    }

    @Test
    fun `rounds the first line to 15 minutes within the hour and says now under 15`() {
        assertEquals(listOf(45 to null), eval(rainAt(59, 0), 0))
        state = WeatherAlertState()
        assertEquals(listOf(0 to null), eval(rainAt(14, 0), 0))
        state = WeatherAlertState()
        // Already raining at connect: "now" once.
        assertEquals(listOf(0 to null), eval(rainAt(-20, 0), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(-20, 5), 5))
    }

    @Test
    fun `the first line consumes every rung at or above it`() {
        assertEquals(listOf(120 to 80), eval(rainAt(125, 0), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(125, 10), 10))
        assertEquals(listOf(60 to null), eval(rainAt(125, 70), 70))
    }

    @Test
    fun `a rung above an hour within 30 minutes of the previous line is skipped`() {
        assertEquals(listOf(150 to 80), eval(rainAt(150, 0), 0))
        // The forecast pulls it to 100 min: the 2h rung is crossed only 10 min after the last line.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(110, 10), 10))
        // Consumed by the skip, so it does not speak late.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(110, 20), 20))
        assertEquals(listOf(60 to null), eval(rainAt(110, 50), 50))
    }

    @Test
    fun `exactly 30 minutes after the previous line speaks`() {
        assertEquals(listOf(150 to 80), eval(rainAt(150, 0), 0))
        assertEquals(listOf(120 to 80), eval(rainAt(150, 30), 30))
    }

    @Test
    fun `downgrades and delays are silent and a jump closer speaks once`() {
        assertEquals(listOf(120 to 80), eval(rainAt(125, 0), 0))
        // Delayed out to 2.5 h: no line.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(160, 10), 10))
        // Gone: no line, state kept.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(fetchedAtMs = T0 + 20 * MIN), 20))
        // Back and much closer: only the new rung.
        assertEquals(listOf(30 to null), eval(rainAt(45, 25), 25))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(45, 28), 28))
    }

    @Test
    fun `the hourly gate needs probability and the quarter-hour gate does not`() {
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(hourly = listOf(hour(120, probability = 40))), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(hourly = listOf(hour(120, mm = 0.5))), 0))
        // An hourly slot at or under 1 h out is the quarter-hour series' job.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(hourly = listOf(hour(30))), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(quarters = listOf(quarter(30, mmPerHour = 0.8))), 0))
        assertEquals(listOf(30 to null), eval(weather(quarters = listOf(quarter(30, mmPerHour = 1.0))), 0))
    }

    @Test
    fun `an event lost at the 1 h handover keeps its state and only escalates on return`() {
        assertEquals(listOf(90 to 80), eval(rainAt(95, 0), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(95, 30), 30))
        // Inside the hour the quarter-hour series no longer shows it.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(fetchedAtMs = T0 + 40 * MIN), 40))
        assertEquals(listOf(30 to null), eval(rainAt(95, 70), 70))
    }

    @Test
    fun `re-arms after 30 minutes clear`() {
        assertEquals(listOf(0 to null), eval(rainAt(-10, 0), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(-10, 20), 20))
        // A gap shorter than 30 min is still the same event.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(fetchedAtMs = T0 + 40 * MIN), 40))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(60, 49), 49))
        // 30 min with nothing over the threshold.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(fetchedAtMs = T0 + 79 * MIN), 79))
        assertEquals(listOf(120 to 80), eval(rainAt(200, 80), 80))
    }

    @Test
    fun `a forecast older than 30 minutes says nothing`() {
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(100, 31, fetchedAtMs = T0), 31))
        assertEquals(listOf(60 to null), eval(rainAt(100, 40, fetchedAtMs = T0 + 10 * MIN), 40))
    }

    @Test
    fun `percent rounds to tens within 10 to 100`() {
        assertEquals(listOf(90 to 60), eval(weather(hourly = listOf(hour(100, probability = 55))), 0))
    }

    @Test
    fun `speaks duration and percent, or the now key`() {
        val far = WeatherAlertLine(WeatherAlertKind.RAIN, 150, 30).voiceAnnouncement()
        assertEquals("weather.rain", far.key)
        assertEquals(listOf("duration" to 150, "percent" to 30), far.values.map { it.type to it.value })
        val now = WeatherAlertLine(WeatherAlertKind.RAIN, 0, null).voiceAnnouncement()
        assertEquals("weather.rain.now", now.key)
        assertEquals(emptyList<Any>(), now.values)
    }

    @Test
    fun `monitor speaks only while live and keeps state across a reconnect`() {
        var live = false
        var nowMin = 0
        val spoken = mutableListOf<Int>()
        val monitor = WeatherAlertMonitor({ live }, { spoken += it.leadMinutes }, { T0 + nowMin * MIN })
        monitor.evaluate(rainAt(100, 0))
        assertEquals(emptyList<Int>(), spoken)
        live = true
        monitor.evaluate(rainAt(100, 0))
        live = false
        nowMin = 5
        monitor.evaluate(rainAt(100, 5))
        live = true
        monitor.evaluate(rainAt(100, 5))
        assertEquals(listOf(90), spoken)
        monitor.rideEnded()
        monitor.evaluate(rainAt(100, 5))
        assertEquals(listOf(90, 90), spoken)
    }

    private fun kinds(weather: Weather, nowMin: Int): List<Pair<WeatherAlertKind, Int>> {
        val result = evaluateWeatherAlerts(weather, WeatherAlertLevel.NORMAL, T0 + nowMin * MIN, state)
        state = result.state
        return result.lines.map { it.kind to it.leadMinutes }
    }

    @Test
    fun `thunderstorm and freezing rain codes are storm without a probability gate`() {
        for (code in listOf(95, 96, 99, 56, 57, 66, 67)) {
            state = WeatherAlertState()
            assertEquals(listOf(WeatherAlertKind.STORM to 90), kinds(weather(hourly = listOf(dryHour(100, code))), 0))
        }
        state = WeatherAlertState()
        assertEquals(emptyList<Any>(), kinds(weather(hourly = listOf(dryHour(100, 80))), 0))
    }

    @Test
    fun `wind speaks from 55 km h gusts at Normal`() {
        assertEquals(emptyList<Any>(), kinds(weather(hourly = listOf(dryHour(100, gustKmh = 54.9))), 0))
        assertEquals(listOf(WeatherAlertKind.WIND to 90), kinds(weather(hourly = listOf(dryHour(100, gustKmh = 55.0))), 0))
    }

    @Test
    fun `storm and wind lines carry no percent`() {
        val line = evaluateWeatherAlerts(weather(hourly = listOf(dryHour(100, 95))), WeatherAlertLevel.NORMAL, T0, state).lines.single()
        assertEquals(listOf("duration" to 90), line.voiceAnnouncement().values.map { it.type to it.value })
        assertEquals("weather.storm.now", WeatherAlertLine(WeatherAlertKind.STORM, 0, null).voiceAnnouncement().key)
    }

    @Test
    fun `only the highest active kind speaks and a suppressed kind consumes its rungs`() {
        val all = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 95, 60.0)
        assertEquals(listOf(WeatherAlertKind.STORM to 90), kinds(weather(hourly = listOf(all)), 0))
        // Rain and wind alone, storm gone: wind outranks rain, but its 90 min rung was consumed.
        val windRain = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 61, 60.0)
        assertEquals(emptyList<Any>(), kinds(weather(hourly = listOf(windRain)), 10))
        assertEquals(listOf(WeatherAlertKind.WIND to 60), kinds(weather(quarters = listOf(
            WeatherSlot(T0 + 100 * MIN, T0 + 115 * MIN, 2.0, null, 61, 60.0),
        ), fetchedAtMs = T0 + 40 * MIN), 40))
    }
}
