package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class NavRouteTest {
    @Test
    fun `course crosses north using shortest turn`() {
        assertEquals(1f, shortestAngleDelta(359f, 0f), 0.001f)
        assertEquals(-1f, shortestAngleDelta(0f, 359f), 0.001f)
    }

    @Test
    fun `course handles unwrapped animation values`() {
        assertEquals(2f, shortestAngleDelta(719f, 1f), 0.001f)
        assertEquals(-20f, shortestAngleDelta(-170f, 170f), 0.001f)
    }
}
