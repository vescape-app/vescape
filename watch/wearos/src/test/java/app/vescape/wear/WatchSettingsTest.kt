package app.vescape.wear

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchSettingsTest {
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
            assertEquals("metric", WatchSettings.decode(mapOf(SETTING_UNIT_SYSTEM to invalid)).unitSystem)
        }
        assertEquals("metric", WatchSettings.decode(emptyMap()).unitSystem)
        val retained = mapOf<String, Any?>(SETTING_UNIT_SYSTEM to "imperial", SETTING_NAV_ARROW to true)
        assertEquals("imperial", WatchSettings.decode(retained).unitSystem)
        assertEquals(WatchSettings.decode(retained), WatchSettings.decode(retained.toMap()))
        assertEquals("metric", WatchSettings.decode(retained + (SETTING_UNIT_SYSTEM to "metric")).unitSystem)
    }

    @Test
    fun `tilt rate defaults until a phone sends it and is held to a sane range`() {
        assertEquals(DEFAULT_TILT_RATE_PERCENT, WatchSettings.decode(emptyMap()).tiltRatePercent)
        assertEquals(30, WatchSettings.decode(mapOf(SETTING_TILT_RATE to 30)).tiltRatePercent)
        assertEquals(100, WatchSettings.decode(mapOf(SETTING_TILT_RATE to 5000)).tiltRatePercent)
        assertEquals(DEFAULT_TILT_RATE_PERCENT, WatchSettings.decode(mapOf(SETTING_TILT_RATE to "fast")).tiltRatePercent)
    }

    @Test
    fun `a phone rider colour becomes an opaque wrist colour`() {
        assertEquals(Color(0xFF38BDF8), parseRiderColor("#38bdf8"))
        // Written without the hash, or with padding, by an older or future phone build.
        assertEquals(Color(0xFF38BDF8), parseRiderColor(" 38BDF8 "))
        assertEquals(Color(0x8038BDF8), parseRiderColor("#8038bdf8"))
    }

    @Test
    fun `anything the wrist cannot read leaves it on its own palette`() {
        assertNull(parseRiderColor(null))
        // Blank is how the phone says "rider picked no colour".
        assertNull(parseRiderColor(""))
        assertNull(parseRiderColor("rebeccapurple"))
        assertNull(parseRiderColor("#38bdf"))
        assertNull(parseRiderColor("#zzzzzz"))
    }
}
