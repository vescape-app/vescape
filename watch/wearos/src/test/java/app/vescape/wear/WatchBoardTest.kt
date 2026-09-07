package app.vescape.wear

import com.google.android.gms.wearable.DataMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchBoardTest {
    @Test
    fun `a full payload is read verbatim`() {
        val dataMap = DataMap().apply {
            putBoolean(BOARD_LIGHTS_ENABLED, true)
            putBoolean(BOARD_HEADLIGHTS_ENABLED, false)
            putBoolean(BOARD_LIGHTS_CONTROLLABLE, true)
        }

        assertEquals(
            WatchBoardLights(lightsEnabled = true, headlightsEnabled = false, lightsControllable = true),
            decodeBoardLights(dataMap),
        )
    }

    @Test
    fun `a board that has never said stays unknown rather than off`() {
        // What the phone sends before any echo or config seed: controllability, and no light keys.
        val dataMap = DataMap().apply { putBoolean(BOARD_LIGHTS_CONTROLLABLE, true) }

        val lights = decodeBoardLights(dataMap)

        assertNull(lights.lightsEnabled)
        assertNull(lights.headlightsEnabled)
        assertTrue(lights.lightsControllable)
    }

    @Test
    fun `an older phone that sends nothing at all offers no write`() {
        val lights = decodeBoardLights(DataMap())

        assertNull(lights.lightsEnabled)
        assertNull(lights.headlightsEnabled)
        assertFalse(lights.lightsControllable)
    }

    @Test
    fun `a deleted item resets to unknown`() {
        assertEquals(WatchBoardLights(), decodeBoardLights(null))
    }
}
