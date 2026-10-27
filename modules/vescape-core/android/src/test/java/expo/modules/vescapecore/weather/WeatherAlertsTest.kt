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
        val result = evaluateWeatherAlerts(weather, WeatherAlertSettings(), T0 + nowMin * MIN, state)
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
        assertEquals(
            emptyList<Pair<Int, Int?>>(),
            eval(weather(hourly = listOf(hour(30)), quarters = listOf(quarter(30, mmPerHour = 0.0))), 0),
        )
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(quarters = listOf(quarter(30, mmPerHour = 0.8))), 0))
        assertEquals(listOf(30 to null), eval(weather(quarters = listOf(quarter(30, mmPerHour = 1.0))), 0))
    }

    @Test
    fun `without a quarter-hour series the hourly gate covers the near hour`() {
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(weather(hourly = listOf(hour(30, probability = 40))), 0))
        assertEquals(listOf(30 to null), eval(weather(hourly = listOf(hour(30))), 0))
        assertEquals(listOf(0 to null), eval(weather(hourly = listOf(hour(-10)), fetchedAtMs = T0 + 30 * MIN), 30))
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
    fun `a later event already in the window re-arms 30 minutes after the one underway`() {
        assertEquals(listOf(0 to null), eval(rainAt(-10, 0), 0))
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(-10, 20), 20))
        // The rain stopped and the next shower is already visible: same event until 30 min clear.
        assertEquals(emptyList<Pair<Int, Int?>>(), eval(rainAt(130, 40), 40))
        assertEquals(listOf(60 to null), eval(rainAt(130, 50), 50))
        assertEquals(listOf(30 to null), eval(rainAt(130, 100), 100))
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

    private fun kinds(
        weather: Weather,
        nowMin: Int,
        settings: WeatherAlertSettings = WeatherAlertSettings(),
    ): List<Pair<WeatherAlertKind, Int>> {
        val result = evaluateWeatherAlerts(weather, settings, T0 + nowMin * MIN, state)
        state = result.state
        return result.lines.map { it.kind to it.leadMinutes }
    }

    @Test
    fun `only thunderstorm codes are storm, without a probability gate`() {
        for (code in listOf(95, 96, 99)) {
            state = WeatherAlertState()
            assertEquals(listOf(WeatherAlertKind.STORM to 90), kinds(weather(hourly = listOf(dryHour(100, code))), 0))
        }
        for (code in listOf(56, 57, 66, 67, 80)) {
            state = WeatherAlertState()
            assertEquals(emptyList<Any>(), kinds(weather(hourly = listOf(dryHour(100, code))), 0))
        }
    }

    @Test
    fun `freezing rain counts as rain only through the rain gate`() {
        val freezing = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 67, null)
        assertEquals(listOf(WeatherAlertKind.RAIN to 90), kinds(weather(hourly = listOf(freezing)), 0))
    }

    @Test
    fun `wind speaks from 55 km h gusts at Normal`() {
        assertEquals(emptyList<Any>(), kinds(weather(hourly = listOf(dryHour(100, gustKmh = 54.9))), 0))
        assertEquals(listOf(WeatherAlertKind.WIND to 90), kinds(weather(hourly = listOf(dryHour(100, gustKmh = 55.0))), 0))
    }

    @Test
    fun `storm speaks percent above an hour like rain, wind never`() {
        val storm = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 0.0, 68, 95, null)
        val far = evaluateWeatherAlerts(weather(hourly = listOf(storm)), WeatherAlertSettings(), T0, state)
        assertEquals(listOf(WeatherAlertKind.STORM to 70), far.lines.map { it.kind to it.percent })
        assertEquals(listOf("duration" to 90, "percent" to 70), far.lines.single().voiceAnnouncement().values.map { it.type to it.value })
        val near = WeatherSlot(T0 + 30 * MIN, T0 + 45 * MIN, 0.0, null, 95, null)
        assertEquals(listOf(30 to null), eval(weather(quarters = listOf(near)), 0))
        assertEquals("weather.storm.now", WeatherAlertLine(WeatherAlertKind.STORM, 0, null).voiceAnnouncement().key)
        state = WeatherAlertState()
        assertEquals(listOf(90 to null), eval(weather(hourly = listOf(dryHour(100, gustKmh = 60.0))), 0))
        assertEquals(70, WeatherAlertLine.preview("storm", 30, 70)?.percent)
        assertEquals(null, WeatherAlertLine.preview("wind", 30, 70)?.percent)
    }

    @Test
    fun `storm outranks rain and a suppressed rain consumes its rungs`() {
        val stormRain = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 95, null)
        assertEquals(listOf(WeatherAlertKind.STORM to 90), kinds(weather(hourly = listOf(stormRain)), 0))
        // Storm gone, rain alone: its 90 min rung was consumed, so it waits for the 1 h rung.
        assertEquals(emptyList<Any>(), kinds(weather(hourly = listOf(hour(100))), 10))
        assertEquals(listOf(WeatherAlertKind.RAIN to 60), kinds(rainAt(100, 40), 40))
    }

    @Test
    fun `wind is independent of storm and rain and speaks after them`() {
        val all = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 95, 60.0)
        assertEquals(listOf(WeatherAlertKind.STORM to 90, WeatherAlertKind.WIND to 90), kinds(weather(hourly = listOf(all)), 0))
        state = WeatherAlertState()
        val windRain = WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 61, 60.0)
        assertEquals(listOf(WeatherAlertKind.RAIN to 90, WeatherAlertKind.WIND to 90), kinds(weather(hourly = listOf(windRain)), 0))
    }

    @Test
    fun `the 30 minute gap is per track`() {
        assertEquals(listOf(WeatherAlertKind.RAIN to 180), kinds(weather(hourly = listOf(hour(180))), 0))
        val gust = dryHour(185, gustKmh = 60.0)
        val both = { nowMin: Int -> weather(hourly = listOf(hour(180), gust), fetchedAtMs = T0 + nowMin * MIN) }
        assertEquals(listOf(WeatherAlertKind.WIND to 120), kinds(both(55), 55))
        // Wind spoke 5 min ago; rain's own last line was an hour ago, so its 2 h rung speaks.
        assertEquals(listOf(WeatherAlertKind.RAIN to 120), kinds(both(60), 60))
    }

    @Test
    fun `a kind turned off says nothing and never blocks another`() {
        val wet = weather(hourly = listOf(WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 61, 60.0)))
        assertEquals(listOf(WeatherAlertKind.WIND to 90), kinds(wet, 0, WeatherAlertSettings(rain = null)))
        state = WeatherAlertState()
        assertEquals(emptyList<Any>(), kinds(wet, 0, WeatherAlertSettings(null, null)))
    }

    @Test
    fun `storms speak with rain and wind off`() {
        val storm = weather(hourly = listOf(WeatherSlot(T0 + 100 * MIN, T0 + 160 * MIN, 2.0, 80, 95, 0.0)))
        assertEquals(listOf(WeatherAlertKind.STORM to 90), kinds(storm, 0, WeatherAlertSettings(null, null)))
    }

    @Test
    fun `levels move the rain and wind gates`() {
        val gust = weather(hourly = listOf(dryHour(100, gustKmh = 45.0)))
        assertEquals(emptyList<Any>(), kinds(gust, 0))
        assertEquals(listOf(WeatherAlertKind.WIND to 90), kinds(gust, 0, WeatherAlertSettings(wind = WeatherAlertLevel.SENSITIVE)))
        state = WeatherAlertState()
        assertEquals(emptyList<Any>(), kinds(rainAt(100, 0), 0, WeatherAlertSettings(rain = WeatherAlertLevel.EXTREME)))
    }

    @Test
    fun `settings read off and unknown levels as off`() {
        assertEquals(WeatherAlertSettings(null, WeatherAlertLevel.EXTREME), WeatherAlertSettings.of("off", "extreme"))
        assertEquals(null, WeatherAlertSettings.of("loud", "normal").rain)
    }
}
