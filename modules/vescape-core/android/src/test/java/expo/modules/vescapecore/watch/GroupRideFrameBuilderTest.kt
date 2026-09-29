package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilderTests.swift */
class GroupRideFrameBuilderTest {
    private val me = GeoPoint(52.0, 21.0)
    private val nowMs = 1_000_000L

    private fun rider(
        id: String,
        position: GeoPoint? = GeoPoint(52.001, 21.0),
        color: String? = "#FF0000",
        stale: Boolean = false,
        lastSeenMs: Long = nowMs,
    ) = GroupRideRosterRider(id, id.uppercase(), color, position, stale, lastSeenMs)

    private fun build(
        riders: List<GroupRideRosterRider>,
        own: GeoPoint? = me,
        spanM: Double? = 800.0,
    ) = GroupRideFrameBuilder.build(GroupRideRoster("me", riders), own, courseDeg = 90.0, spanM = spanM, nowMs = nowMs)

    @Test
    fun `other riders become east-north offsets from the rider's fix, nearest first`() {
        val frame = build(
            listOf(
                rider("far", GeoPoint(52.0, 21.01)),
                rider("near", GeoPoint(52.001, 21.0)),
            ),
        )

        assertEquals(listOf("near", "far"), frame.riders.map { it.id })
        val near = frame.riders[0]
        assertEquals(0.0, near.eastM, 0.01)
        assertEquals(110.574, near.northM, 0.01)
        val far = frame.riders[1]
        assertEquals(685.0, far.eastM, 1.0)
        assertEquals(0.0, far.northM, 0.01)
        assertEquals(90.0, frame.courseDeg!!, 0.0)
    }

    @Test
    fun `the rider's own entry is never in the frame`() {
        val frame = build(listOf(rider("me"), rider("ola")))

        assertEquals(listOf("ola"), frame.riders.map { it.id })
    }

    @Test
    fun `span falls back to 600 m until the phone map publishes one`() {
        assertEquals(600.0, build(emptyList(), spanM = null).spanM, 0.0)
        assertEquals(600.0, build(emptyList(), spanM = 0.0).spanM, 0.0)
        assertEquals(800.0, build(emptyList(), spanM = 800.0).spanM, 0.0)
    }

    @Test
    fun `without a fix nobody can be placed, but the frame still says joined`() {
        val frame = build(listOf(rider("ola")), own = null)

        assertTrue(frame.riders.isEmpty())
    }

    @Test
    fun `riders without a position or silent past the drop window are left out`() {
        val frame = build(
            listOf(
                rider("nowhere", position = null),
                rider("gone", lastSeenMs = nowMs - GROUP_RIDE_DROP_AFTER_MS),
                rider("ola"),
            ),
        )

        assertEquals(listOf("ola"), frame.riders.map { it.id })
    }

    @Test
    fun `a rider unheard past the stale window is stale even before the relay says so`() {
        val frame = build(
            listOf(
                rider("quiet", lastSeenMs = nowMs - GROUP_RIDE_STALE_AFTER_MS),
                rider("flagged", stale = true, position = GeoPoint(52.002, 21.0)),
            ),
        )

        assertTrue(frame.riders.all { it.stale })
    }

    @Test
    fun `a chosen colour is kept and a missing one falls back by roster position`() {
        val frame = build(
            listOf(
                rider("picked", color = "#10C69A", position = GeoPoint(52.001, 21.0)),
                rider("unpicked", color = null, position = GeoPoint(52.002, 21.0)),
            ),
        )

        assertEquals(0xFF10C69A.toInt(), frame.riders[0].colorArgb)
        // Second in the roster -> second fallback tint (green).
        assertEquals(0xFF22C55E.toInt(), frame.riders[1].colorArgb)
    }

    @Test
    fun `fallback colours follow the phone roster order - own rider first, then nearest`() {
        val frame = GroupRideFrameBuilder.build(
            GroupRideRoster(
                "me",
                listOf(
                    rider("me", color = null),
                    rider("far", position = GeoPoint(52.002, 21.0), color = null),
                    rider("near", position = GeoPoint(52.001, 21.0), color = null),
                ),
            ),
            me, courseDeg = null, spanM = null, nowMs = nowMs,
        )

        // Index 0 is the Rider's own entry; near is 1 (green), far is 2 (amber).
        assertEquals(listOf(0xFF22C55E.toInt(), 0xFFF59E0B.toInt()), frame.riders.map { it.colorArgb })
    }

    @Test
    fun `battery percent and levels come from the rider's presence`() {
        val frame = build(
            listOf(
                rider("low").copy(soc = 0.084, motorTempC = 72.0, ctrlTempC = 40.0),
                rider("hot", GeoPoint(52.002, 21.0)).copy(soc = 0.5, motorTempC = 30.0, ctrlTempC = 81.0),
                rider("walking", GeoPoint(52.003, 21.0)),
            ),
        )

        val (low, hot, walking) = frame.riders
        assertEquals(8, low.batteryPercent)
        assertEquals(TelemetryLevel.CRITICAL, low.batteryLevel)
        assertEquals(TelemetryLevel.WARNING, low.heatLevel)
        assertEquals(50, hot.batteryPercent)
        assertEquals(TelemetryLevel.NORMAL, hot.batteryLevel)
        assertEquals(TelemetryLevel.CRITICAL, hot.heatLevel)
        assertNull(walking.batteryPercent)
        assertEquals(TelemetryLevel.NORMAL, walking.batteryLevel)
        assertEquals(TelemetryLevel.NORMAL, walking.heatLevel)
    }
}
