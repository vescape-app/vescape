package app.vescape.wear

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import expo.modules.vescapecore.watch.GroupRideFrameRider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Heading-up placement of Group Ride marks on a 400 px face, 600 m across (the route's own fit).
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapProjectionTests.swift
 */
class WatchMapProjectionTest {
    private val face = 400f
    private val drop = 30f
    private val inset = 20f
    private val margin = 40f
    /** Pixels per metre: (400 - 20) / 600. */
    private val scale = (face - inset) / 600f

    private fun map(courseDeg: Double = 0.0, spanM: Double? = 600.0) =
        WatchMapProjection(face, face, drop, inset, spanM, courseDeg)

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

    private val sizes = WatchGroupRideMarkSizes(
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
        assertEquals(WatchGroupRideMarkKind.Dot, dot.kind)
        assertEquals(3f, dot.sizePx, 0f)

        val far = map().mark(rider(0.0, 1_000.0), sizes)
        assertEquals(WatchGroupRideMarkKind.Triangle, far.kind)
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
        assertEquals(WatchGroupRideMarkKind.Triangle, map(spanM = 600.0).mark(r, sizes).kind)
        assertEquals(WatchGroupRideMarkKind.Dot, map(spanM = 1_200.0).mark(r, sizes).kind)
    }

    @Test
    fun `marks come farthest first so a close rider draws on top`() {
        val marks = map().marks(listOf(rider(0.0, 50.0), rider(0.0, 2_000.0), rider(0.0, 200.0)), sizes)
        assertEquals(listOf(2_000.0, 200.0, 50.0), marks.map { it.rider.northM })
    }

    // Nav-focus labels

    /** Places one label per mark ([width] × [height] each) and returns their top-lefts. */
    private fun labels(vararg marks: WatchGroupRideMark, width: Float = 30f, height: Float = 10f, focus: Float = 1f) =
        map().placeLabels(marks.toList(), marks.map { Size(width, height) }, gapPx = 3f, navFocus = focus)

    private fun label(mark: WatchGroupRideMark, width: Float = 30f, height: Float = 10f, focus: Float = 1f) =
        labels(mark, width = width, height = height, focus = focus).single()!!

    private fun riderAt(id: String, eastM: Double, northM: Double) =
        GroupRideFrameRider(id, id, 0xFF00FF00.toInt(), eastM, northM, stale = false)

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
    fun `a triangle's label sits inward of its apex`() {
        // Straight ahead: triangle on the top edge, apex down; the label box centres below it.
        val far = map().mark(rider(0.0, 1_000.0), sizes)
        val at = label(far)
        assertEquals(200f - 15f, at.x, 0.01f)
        assertEquals(far.y + far.sizePx + 3f, at.y, 0.01f)
    }

    @Test
    fun `a label just onto the nav readout slides up clear of it`() {
        // At full focus the readout spans y 328–376. A dot level with the readout's top, left of the
        // Rider: its label (y 323–333) slides up to end the 3 px gap above it.
        val onReadout = map().mark(rider(-10.0 / scale, (drop - 128.0) / scale), sizes)
        assertEquals(328f, onReadout.y, 0.01f)
        val at = label(onReadout)
        assertEquals(328f - 3f - 10f, at.y, 0.01f)
        assertFalse(Rect(at, Size(30f, 10f)).overlaps(navReadoutBounds(1f, face, face)))
    }

    @Test
    fun `a triangle's label deep in the nav readout is dropped, not dragged off its mark`() {
        // Straight behind: the triangle sits under the readout; clearing it would move the label
        // far above its apex.
        val behind = map().mark(rider(0.0, -2_000.0), sizes)
        assertEquals(WatchGroupRideMarkKind.Triangle, behind.kind)
        assertNull(labels(behind, height = 20f).single())
    }

    @Test
    fun `two close riders get labels that overlap neither each other nor the other's dot`() {
        // 8 px apart on the same side of the Rider: the second label would sit on the first.
        val near = map().mark(riderAt("near", 60.0, 100.0), sizes)
        val next = map().mark(riderAt("next", 60.0, 100.0 + 8.0 / scale), sizes)
        val (a, b) = labels(near, next)
        val boxA = Rect(a!!, Size(30f, 10f))
        val boxB = Rect(b!!, Size(30f, 10f))
        assertFalse(boxA.overlaps(boxB))
        // The nearer Rider keeps the natural spot; the other is nudged, not dropped.
        assertEquals(near.y - 5f, a.y, 0.01f)
        for ((box, other) in listOf(boxA to next, boxB to near)) {
            assertFalse(box.overlaps(Rect(Offset(other.x, other.y), other.sizePx)))
        }
    }

    @Test
    fun `a label with no clear spot is dropped rather than overlap`() {
        // Seven Riders on one spot: both sides and every nudge fill up before the last.
        val marks = (0 until 7).map { map().mark(riderAt("r$it", 60.0, 100.0), sizes) }
        val placed = labels(*marks.toTypedArray())
        assertEquals(marks[0].y - 5f, placed[0]!!.y, 0.01f)
        assertNull(placed.last())
        val boxes = placed.filterNotNull().map { Rect(it, Size(30f, 10f)) }
        assertTrue(boxes.size >= 2)
        for (i in boxes.indices) for (j in boxes.indices) if (i != j) assertFalse(boxes[i].overlaps(boxes[j]))
    }

    @Test
    fun `a stale rider gets no label but still keeps others' labels off its dot`() {
        val stale = map().mark(riderAt("lost", 60.0, 100.0).copy(stale = true), sizes)
        val live = map().mark(riderAt("live", 40.0, 100.0), sizes)
        val placed = map().placeLabels(listOf(stale, live), listOf(null, Size(30f, 10f)), gapPx = 3f, navFocus = 1f)
        assertNull(placed[0])
        assertFalse(Rect(placed[1]!!, Size(30f, 10f)).overlaps(Rect(Offset(stale.x, stale.y), stale.sizePx)))
    }

    @Test
    fun `a nudged label never lands on its own triangle or any other mark`() {
        // Pairs of far Riders a few degrees apart all round the rim: the farther one's label is
        // crowded off its natural spot and nudged along the edge, back towards its own triangle.
        for (bearing in 0 until 360 step 5) for (apart in listOf(4, 8, 12)) for (distanceM in listOf(700.0, 1_500.0)) {
            val riders = listOf(bearing, bearing + apart).mapIndexed { i, deg ->
                val rad = Math.toRadians(deg.toDouble())
                val d = distanceM + i * 200.0
                riderAt("r$i", d * kotlin.math.sin(rad), d * kotlin.math.cos(rad))
            }
            val marks = map().marks(riders, sizes)
            val size = Size(40f, 12f)
            val placed = map().placeLabels(marks, marks.map { size }, gapPx = 3f, navFocus = 1f)
            for ((i, at) in placed.withIndex()) {
                val box = Rect(at ?: continue, size)
                for (mark in marks) {
                    val hit = if (mark.kind == WatchGroupRideMarkKind.Triangle) {
                        polygonsOverlap(mark.triangleCorners(), listOf(box.topLeft, box.topRight, box.bottomRight, box.bottomLeft))
                    } else {
                        box.overlaps(Rect(Offset(mark.x, mark.y), mark.sizePx))
                    }
                    assertFalse("label $i on ${mark.rider.id} at $bearing° +$apart° $distanceM m", hit)
                }
            }
        }
    }

    /** Convex polygons overlap unless an edge normal of either separates them. */
    private fun polygonsOverlap(a: List<Offset>, b: List<Offset>): Boolean =
        listOf(a, b).all { poly ->
            poly.indices.all { i ->
                val p = poly[i]
                val q = poly[(i + 1) % poly.size]
                val axis = Offset(p.y - q.y, q.x - p.x)
                val pa = a.map { it.x * axis.x + it.y * axis.y }
                val pb = b.map { it.x * axis.x + it.y * axis.y }
                pa.max() > pb.min() + 1e-3f && pb.max() > pa.min() + 1e-3f
            }
        }
}
