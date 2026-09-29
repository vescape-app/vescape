package app.vescape.wear

import expo.modules.vescapecore.telemetry.TelemetryLevel
import expo.modules.vescapecore.watch.GroupRideFrameRider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Heading-up placement of Group Ride marks on a 400 px face, 600 m across (the route's own fit).
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjectionTests.swift
 */
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

    private val sizes = GroupRideMarkSizes(
        inRangeMarginPx = margin,
        edgeInsetPx = 1f,
        dotRadiusPx = 3f,
        triangleMinPx = 7f,
        triangleMaxPx = 12f,
    )

    private fun rider(eastM: Double, northM: Double, stale: Boolean = false) =
        GroupRideFrameRider("id", "R", 0xFF00FF00.toInt(), eastM, northM, stale = stale)

    @Test
    fun `a rider on the map is a dot, one beyond it a triangle on the face edge`() {
        val dot = map().mark(rider(0.0, 100.0), sizes)
        assertEquals(GroupRideMarkKind.Dot, dot.kind)
        assertEquals(3f, dot.sizePx, 0f)

        val far = map().mark(rider(0.0, 1_000.0), sizes)
        assertEquals(GroupRideMarkKind.Triangle, far.kind)
        // Straight ahead: the top of the face, one inset pixel in, apex pointing down.
        assertEquals(200f, far.x, 0.01f)
        assertEquals(1f, far.y, 0.01f)
        assertEquals(0f, far.outX, 1e-4f)
        assertEquals(-1f, far.outY, 1e-4f)
    }

    @Test
    fun `the edge point is on the ray from the rider, not from the face centre`() {
        // Due right of the Rider, who sits 30 px below the centre: the ray stays level at y = 230.
        val far = map().mark(rider(5_000.0, 0.0), sizes)
        val edgeR = 199f

        assertEquals(200f + kotlin.math.sqrt(edgeR * edgeR - drop * drop), far.x, 0.01f)
        assertEquals(200f + drop, far.y, 0.01f)
        // The triangle stands square to the rim: outward is from the face centre.
        assertEquals((far.x - 200f) / edgeR, far.outX, 1e-4f)
        assertEquals(drop / edgeR, far.outY, 1e-4f)
    }

    @Test
    fun `a closer far rider gets a bigger triangle, log-scaled out to 3 km`() {
        // Ahead the map ends (160 + drop) / scale metres out.
        val boundaryM = ((160f + drop) / scale).toDouble()
        val justOut = map().mark(rider(0.0, boundaryM + 1.0), sizes).sizePx
        val mid = map().mark(rider(0.0, 1_000.0), sizes).sizePx
        val far = map().mark(rider(0.0, 3_000.0), sizes).sizePx

        assertEquals(12f, justOut, 0.05f)
        assertTrue(mid in 7.5f..11.5f)
        assertEquals(7f, far, 0f)
        assertEquals(7f, map().mark(rider(0.0, 20_000.0), sizes).sizePx, 0f)
        assertEquals(7f + 5f * (1f - (kotlin.math.ln(1_000.0 / boundaryM) / kotlin.math.ln(3_000.0 / boundaryM)).toFloat()), mid, 0.01f)
    }

    @Test
    fun `a stale far rider keeps the smallest triangle`() {
        val boundaryM = ((160f + drop) / scale).toDouble()
        assertEquals(7f, map().mark(rider(0.0, boundaryM + 1.0, stale = true), sizes).sizePx, 0f)
    }

    @Test
    fun `zooming the phone map out brings a far rider onto the map`() {
        val r = rider(0.0, 400.0)
        assertEquals(GroupRideMarkKind.Triangle, map(spanM = 600.0).mark(r, sizes).kind)
        assertEquals(GroupRideMarkKind.Dot, map(spanM = 1_200.0).mark(r, sizes).kind)
    }

    @Test
    fun `marks come farthest first so a close rider draws on top`() {
        val marks = map().marks(listOf(rider(0.0, 50.0), rider(0.0, 2_000.0), rider(0.0, 200.0)), sizes)
        assertEquals(listOf(2_000.0, 200.0, 50.0), marks.map { it.rider.northM })
    }

    // Nav-focus labels

    private fun label(mark: GroupRideMark, width: Float = 30f, height: Float = 10f, focus: Float = 1f) =
        map().labelTopLeft(mark, width, height, gapPx = 3f, ringPx = 4f, navFocus = focus, faceWidth = face, faceHeight = face)

    @Test
    fun `a dot's label sits beside it, on the side away from the rider`() {
        val right = map().mark(rider(50.0, 100.0), sizes)
        assertEquals(right.x + 3f + 3f, label(right).x, 0.01f)
        assertEquals(right.y - 5f, label(right).y, 0.01f)

        val left = map().mark(rider(-50.0, 100.0), sizes)
        assertEquals(left.x - 3f - 3f - 30f, label(left).x, 0.01f)
    }

    @Test
    fun `a dot's label that would run off the face takes the rider's side`() {
        // 150 px right of the centre, level with it: a 60 px label outward would leave the face.
        val nearRim = map().mark(rider(150.0 / scale, 30.0 / scale), sizes)
        assertEquals(350f, nearRim.x, 0.01f)
        assertEquals(nearRim.x - 3f - 3f - 60f, label(nearRim, width = 60f).x, 0.01f)
        assertEquals(nearRim.x + 3f + 3f, label(nearRim, width = 30f).x, 0.01f)
    }

    @Test
    fun `a flagged dot's label clears its ring, a stale one's has no ring to clear`() {
        val hot = rider(50.0, 100.0).copy(heatLevel = TelemetryLevel.WARNING)
        val mark = map().mark(hot, sizes)
        assertEquals(mark.x + 3f + 4f + 3f, label(mark).x, 0.01f)

        val lost = map().mark(hot.copy(stale = true), sizes)
        assertEquals(lost.x + 3f + 3f, label(lost).x, 0.01f)
    }

    @Test
    fun `a triangle's label sits inward of its apex`() {
        // Straight ahead: triangle on the top edge, apex down; the label box centres below it.
        val far = map().mark(rider(0.0, 1_000.0), sizes)
        val at = label(far)
        assertEquals(200f - 15f, at.x, 0.01f)
        assertEquals(far.y + far.sizePx + 3f, at.y, 0.01f)
    }

    @Test
    fun `a label that would sit on the nav readout slides up until clear`() {
        // At full focus the readout's top is 82% down the face.
        val readoutTop = face * 0.82f
        assertEquals(readoutTop - 10f, clearOfNavReadout(180f, 340f, 30f, 10f, 1f, face, face), 0.01f)
        // Beside it, or already above it: untouched.
        assertEquals(340f, clearOfNavReadout(300f, 340f, 30f, 10f, 1f, face, face), 0f)
        assertEquals(300f, clearOfNavReadout(180f, 300f, 30f, 10f, 1f, face, face), 0f)
    }

    @Test
    fun `distance labels drop the space before the unit`() {
        assertEquals("680m", groupRideDistanceLabel(680.0, "metric"))
        assertEquals("2.1km", groupRideDistanceLabel(2_100.0, "metric"))
        assertEquals("1.3mi", groupRideDistanceLabel(2_100.0, "imperial"))
    }
}
