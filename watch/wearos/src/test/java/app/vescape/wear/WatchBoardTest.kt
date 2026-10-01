package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchBoardTest {
    @Test
    fun `a full payload is read verbatim`() {
        val payload = mapOf(
            BOARD_LIGHTS_ENABLED to true,
            BOARD_HEADLIGHTS_ENABLED to false,
            BOARD_LIGHTS_CONTROLLABLE to true,
        )

        assertEquals(
            WatchBoardLights(lightsEnabled = true, headlightsEnabled = false, lightsControllable = true),
            decodeBoardLightsPayload(payload),
        )
    }

    @Test
    fun `a board that has never said stays unknown rather than off`() {
        // What the phone sends before any echo or config seed: controllability, and no light keys.
        val payload = mapOf(BOARD_LIGHTS_CONTROLLABLE to true)

        val lights = decodeBoardLightsPayload(payload)

        assertNull(lights.lightsEnabled)
        assertNull(lights.headlightsEnabled)
        assertTrue(lights.lightsControllable)
    }

    @Test
    fun `an older phone that sends nothing at all offers no write`() {
        val lights = decodeBoardLightsPayload(emptyMap())

        assertNull(lights.lightsEnabled)
        assertNull(lights.headlightsEnabled)
        assertFalse(lights.lightsControllable)
    }

    @Test
    fun `a deleted item resets to unknown`() {
        assertEquals(WatchBoardLights(), decodeBoardLightsPayload(null))
    }
}
