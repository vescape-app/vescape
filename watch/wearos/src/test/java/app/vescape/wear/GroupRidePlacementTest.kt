package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Heading-up placement of Group Ride dots on a 400 px face, 600 m across (the route's own fit). */
class GroupRidePlacementTest {
    private val face = 400f
    private val drop = 30f
    private val inset = 20f
    private val margin = 40f
    /** Pixels per metre: (400 - 20) / 600. */
    private val scale = (face - inset) / 600f

    private fun map(courseDeg: Double = 0.0, spanM: Double? = 600.0) =
        HeadingUpMap(face, face, drop, inset, spanM, courseDeg)

    @Test
    fun `a rider ahead on the course sits straight above the rider`() {
        // Riding east; the other Rider is 100 m east.
        val placed = map(courseDeg = 90.0).place(eastM = 100.0, northM = 0.0, marginPx = margin)

        assertEquals(200f, placed.x, 0.01f)
        assertEquals(200f + drop - 100 * scale, placed.y, 0.01f)
        assertEquals(0f, placed.dirX, 1e-4f)
        assertEquals(-1f, placed.dirY, 1e-4f)
        assertTrue(placed.inRange)
    }

    @Test
    fun `a rider to the north while riding east is on the left`() {
        val placed = map(courseDeg = 90.0).place(eastM = 0.0, northM = 100.0, marginPx = margin)

        assertEquals(200f - 100 * scale, placed.x, 0.01f)
        assertEquals(200f + drop, placed.y, 0.01f)
        assertTrue(placed.inRange)
    }

    @Test
    fun `range is measured from the face centre, not from the dropped rider`() {
        // Straight ahead (north-up): the point is (200, 230 - d * scale). Limit radius = 200 - 40.
        val limitM = (160f + drop) / scale
        assertTrue(map().place(0.0, limitM - 1.0, margin).inRange)
        assertFalse(map().place(0.0, limitM + 1.0, margin).inRange)
        // Behind, the drop brings the edge closer.
        val behindLimitM = (160f - drop) / scale
        assertTrue(map().place(0.0, -(behindLimitM - 1.0), margin).inRange)
        assertFalse(map().place(0.0, -(behindLimitM + 1.0), margin).inRange)
    }

    @Test
    fun `span follows the phone map, clamped like the route`() {
        val wide = map(spanM = 1_200.0).place(0.0, 300.0, margin)
        assertEquals(200f + drop - 300 * (face - inset) / 1_200f, wide.y, 0.01f)
        // Below the route's floor of 150 m the map stops zooming in.
        val tight = map(spanM = 10.0).place(0.0, 10.0, margin)
        assertEquals(200f + drop - 10 * (face - inset) / 150f, tight.y, 0.01f)
        // No span yet: the 600 m fallback.
        assertEquals(map(spanM = 600.0).place(0.0, 50.0, margin), map(spanM = null).place(0.0, 50.0, margin))
    }

    @Test
    fun `relative bearing is clockwise from the course`() {
        assertEquals(0.0, relativeBearingDeg(0.0, 10.0, 0.0), 1e-9)
        assertEquals(270.0, relativeBearingDeg(0.0, 10.0, 90.0), 1e-9)
        assertEquals(180.0, relativeBearingDeg(-10.0, 0.0, 90.0), 1e-9)
    }
}
