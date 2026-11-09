package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shared test vector: the same ids must land in the same palette slots on every platform.
 *
 * @parity /src/modules/group-ride/lib/riderColor.test.ts `RIDER_COLOR_VECTOR`
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilderTests.swift `riderColorVector`
 */
private val RIDER_COLOR_VECTOR = listOf(
    "" to 1,
    "a" to 0,
    "rider-1" to 2,
    "rider-7" to 3,
    "rider-3" to 4,
    "550e8400-e29b-41d4-a716-446655440000" to 2,
    "Jonáš" to 4,
    "Zoë" to 0,
)

/** @parity /modules/vescape-core/ios/watch/GroupRideFrameBuilderTests.swift */
class GroupRideFrameBuilderTest {
    private val me = GeoPoint(52.0, 21.0)
    private val nowMs = 1_000_000L

    private fun rider(
        id: String,
        position: GeoPoint? = GeoPoint(52.001, 21.0),
        stale: Boolean = false,
        away: Boolean = false,
        lastSeenMs: Long = nowMs,
    ) = GroupRideRosterRider(id, id.uppercase(), position, stale, away, lastSeenMs)

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
    fun `riders without a position are left out`() {
        val frame = build(listOf(rider("nowhere", position = null), rider("ola")))

        assertEquals(listOf("ola"), frame.riders.map { it.id })
    }

    @Test
    fun `an away rider stays at their last position, stale, however long silent`() {
        val frame = build(listOf(rider("away", away = true, lastSeenMs = nowMs - 3_600_000L)))

        assertEquals(listOf("away"), frame.riders.map { it.id })
        assertTrue(frame.riders.single().stale)
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
    fun `riders land in the shared palette slots by id`() {
        for ((id, index) in RIDER_COLOR_VECTOR) assertEquals(id, index, groupRideRiderPaletteIndex(id))
    }

    @Test
    fun `a rider's colour follows their id, not distance, stale or the roster order`() {
        val near = rider("rider-7", GeoPoint(52.001, 21.0))
        val far = rider("rider-1", GeoPoint(52.002, 21.0))
        val before = build(listOf(rider("me"), far, near))
        // They swap places and one goes stale: nobody's colour moves.
        val after = build(listOf(near.copy(position = GeoPoint(52.003, 21.0), stale = true), far))

        val expected = mapOf("rider-7" to GROUP_RIDE_RIDER_COLORS[3], "rider-1" to GROUP_RIDE_RIDER_COLORS[2])
        assertEquals(expected, before.riders.associate { it.id to it.colorArgb })
        assertEquals(expected, after.riders.associate { it.id to it.colorArgb })
        assertEquals(listOf("rider-1", "rider-7"), after.riders.map { it.id })
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
