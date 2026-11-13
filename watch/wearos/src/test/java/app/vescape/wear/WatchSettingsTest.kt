package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class WatchSettingsTest {
    @org.junit.Test fun timeFormatDefaultsAndClockBoundaries() {
        assertEquals("24h", WatchSettings.decode(emptyMap()).timeFormat)
        assertEquals("24h", WatchSettings.decode(mapOf(SETTING_TIME_FORMAT to "system")).timeFormat)
        assertEquals("12h", WatchSettings.decode(mapOf(SETTING_TIME_FORMAT to "12h")).timeFormat)
        assertEquals("12:00 AM", formatHour(0, "12h"))
        assertEquals("12:00 PM", formatHour(720, "12h"))
        assertEquals("2:05 PM", formatHour(845, "12h"))
        assertEquals("2:05:09 PM", formatHour(845, "12h", 9))
    }

    @Test fun `telemetry trail is enabled for older phones and false survives settings reload`() {
        assertEquals(true, WatchSettings.decode(emptyMap()).telemetryTrailEnabled)
        assertEquals(true, WatchSettings.decode(mapOf(SETTING_TELEMETRY_TRAIL to "false")).telemetryTrailEnabled)
        val payload = mapOf<String, Any?>(SETTING_TELEMETRY_TRAIL to false)
        assertEquals(false, WatchSettings.decode(payload).telemetryTrailEnabled)
        assertEquals(WatchSettings.decode(payload), WatchSettings.decode(payload.toMap()))
        assertEquals(true, WatchSettings.decode(payload + (SETTING_TELEMETRY_TRAIL to true)).telemetryTrailEnabled)
    }

    @Test fun `street map is enabled for older phones and false survives settings reload`() {
        assertEquals(true, WatchSettings.decode(emptyMap()).streetMapEnabled)
        assertEquals(false, WatchSettings.decode(mapOf(SETTING_STREET_MAP to false)).streetMapEnabled)
    }

    @Test fun `telemetry group is enabled for older phones and false survives settings reload`() {
        assertEquals(true, WatchSettings.decode(emptyMap()).telemetryGroupEnabled)
        assertEquals(true, WatchSettings.decode(mapOf(SETTING_TELEMETRY_GROUP to "false")).telemetryGroupEnabled)
        assertEquals(false, WatchSettings.decode(mapOf(SETTING_TELEMETRY_GROUP to false)).telemetryGroupEnabled)
    }

    @Test fun `telemetry route is enabled for older phones and false survives settings reload`() {
        assertEquals(true, WatchSettings.decode(emptyMap()).telemetryRouteEnabled)
        assertEquals(true, WatchSettings.decode(mapOf(SETTING_TELEMETRY_ROUTE to "false")).telemetryRouteEnabled)
        assertEquals(false, WatchSettings.decode(mapOf(SETTING_TELEMETRY_ROUTE to false)).telemetryRouteEnabled)
    }

    /** Issue #557: an older phone, or a value off the steps, reads as the 60 % default. */
    @Test fun `map behind gauges keeps its step and falls back to the default`() {
        assertEquals(60, WatchSettings.decode(emptyMap()).mapGaugesPercent)
        assertEquals(30, WatchSettings.decode(mapOf(SETTING_MAP_GAUGES to 30)).mapGaugesPercent)
        assertEquals(0, WatchSettings.decode(mapOf(SETTING_MAP_GAUGES to 0)).mapGaugesPercent)
        for (invalid in listOf(50, 15, 100, -30, "90", true, null)) {
            assertEquals(60, WatchSettings.decode(mapOf(SETTING_MAP_GAUGES to invalid)).mapGaugesPercent)
        }
    }

    @Test
    fun `settings updates and restart restore the phone preference with lenient defaults`() {
        for (invalid in listOf(null, "unknown", 1, true)) {
            assertEquals("km", WatchSettings.decode(mapOf(SETTING_DISTANCE_UNIT to invalid)).distanceUnit)
        }
        assertEquals("km", WatchSettings.decode(emptyMap()).distanceUnit)
        val retained = mapOf<String, Any?>(SETTING_DISTANCE_UNIT to "mi", SETTING_NAV_ARROW to true)
        assertEquals("mi", WatchSettings.decode(retained).distanceUnit)
        assertEquals(WatchSettings.decode(retained), WatchSettings.decode(retained.toMap()))
        assertEquals("km", WatchSettings.decode(retained + (SETTING_DISTANCE_UNIT to "km")).distanceUnit)
    }

    @Test
    fun `tilt rate defaults until a phone sends it and is held to a sane range`() {
        assertEquals(DEFAULT_TILT_RATE_PERCENT, WatchSettings.decode(emptyMap()).tiltRatePercent)
        assertEquals(30, WatchSettings.decode(mapOf(SETTING_TILT_RATE to 30)).tiltRatePercent)
        assertEquals(100, WatchSettings.decode(mapOf(SETTING_TILT_RATE to 5000)).tiltRatePercent)
        assertEquals(DEFAULT_TILT_RATE_PERCENT, WatchSettings.decode(mapOf(SETTING_TILT_RATE to "fast")).tiltRatePercent)
    }
}
