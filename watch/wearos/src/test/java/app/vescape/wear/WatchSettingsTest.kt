package app.vescape.wear

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchSettingsTest {
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
