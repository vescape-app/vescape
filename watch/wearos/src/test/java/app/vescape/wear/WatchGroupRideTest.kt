package app.vescape.wear

import expo.modules.vescapecore.telemetry.TelemetryLevel
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The wrist's Group Ride: the course it holds, the page's rows (order, names, bearings, the one
 * status slot), the nav-focus label flag and the distance label.
 *
 * @parity /modules/vescape-core/ios/watch/WatchGroupRideTests.swift
 */
class WatchGroupRideTest {
    private fun rider(
        id: String,
        northM: Double = 100.0,
        eastM: Double = 0.0,
        name: String = id,
        stale: Boolean = false,
        batteryPercent: Int? = 60,
        batteryLevel: TelemetryLevel = TelemetryLevel.NORMAL,
        heatLevel: TelemetryLevel = TelemetryLevel.NORMAL,
    ) = GroupRideFrameRider(id, name, 0, eastM, northM, stale, batteryPercent, batteryLevel, heatLevel)

    private fun group(vararg riders: GroupRideFrameRider, courseDeg: Double = 0.0) =
        WatchGroupRide(courseDeg, 600.0, riders.toList())

    @Test
    fun `rows run nearest first, ties by id`() {
        val rows = group(
            rider("far", northM = 900.0),
            rider("b", northM = 50.0),
            rider("a", eastM = 50.0, northM = 0.0),
            rider("near", northM = 10.0),
        ).roster()

        assertEquals(listOf("near", "a", "b", "far"), rows.map { it.rider.id })
    }

    @Test
    fun `alone is an empty roster`() {
        assertTrue(group().roster().isEmpty())
    }

    @Test
    fun `bearing is relative to the course`() {
        // Riding east; the other Rider is due north, so on the left.
        val row = group(rider("a", northM = 100.0), courseDeg = 90.0).roster().single()

        assertEquals(270.0, row.bearingDeg, 1e-9)
    }

    @Test
    fun `names are cut to five characters without splitting a surrogate pair`() {
        val rows = group(
            rider("a", name = "Maksymilian", northM = 1.0),
            rider("b", name = "🛹🛹🛹🛹🛹🛹", northM = 2.0),
            rider("c", name = "Ola", northM = 3.0),
        ).roster()

        assertEquals(listOf("Maksy", "🛹🛹🛹🛹🛹", "Ola"), rows.map { it.name })
    }

    @Test
    fun `stale reads lost whatever the readings say`() {
        val status = groupRideStatus(rider("a", stale = true, heatLevel = TelemetryLevel.CRITICAL, batteryLevel = TelemetryLevel.CRITICAL))

        assertEquals(WatchGroupRideStatus.Stale, status)
    }

    @Test
    fun `hot outranks a low battery`() {
        val status = groupRideStatus(rider("a", heatLevel = TelemetryLevel.WARNING, batteryPercent = 5, batteryLevel = TelemetryLevel.CRITICAL))

        assertEquals(WatchGroupRideStatus.Hot(TelemetryLevel.WARNING), status)
    }

    @Test
    fun `battery carries its level`() {
        val status = groupRideStatus(rider("a", batteryPercent = 25, batteryLevel = TelemetryLevel.WARNING))

        assertEquals(WatchGroupRideStatus.Battery(25, TelemetryLevel.WARNING), status)
    }

    @Test
    fun `no board is a dash, and a hot rider without one still shows the thermometer`() {
        assertEquals(WatchGroupRideStatus.NoBoard, groupRideStatus(rider("a", batteryPercent = null)))
        assertEquals(
            WatchGroupRideStatus.Hot(TelemetryLevel.CRITICAL),
            groupRideStatus(rider("b", batteryPercent = null, heatLevel = TelemetryLevel.CRITICAL)),
        )
    }

    @Test
    fun `a label flags heat, else a battery above normal, never a stale rider`() {
        assertEquals(
            WatchGroupRideStatus.Hot(TelemetryLevel.WARNING),
            groupRideLabelFlag(rider("a", heatLevel = TelemetryLevel.WARNING, batteryPercent = 5, batteryLevel = TelemetryLevel.CRITICAL)),
        )
        assertEquals(
            WatchGroupRideStatus.Battery(12, TelemetryLevel.CRITICAL),
            groupRideLabelFlag(rider("b", batteryPercent = 12, batteryLevel = TelemetryLevel.CRITICAL)),
        )
        assertNull(groupRideLabelFlag(rider("c", batteryPercent = 80)))
        assertNull(groupRideLabelFlag(rider("d", batteryPercent = null)))
        assertNull(groupRideLabelFlag(rider("e", stale = true, heatLevel = TelemetryLevel.CRITICAL)))
    }

    @Test
    fun `the wrist keeps the last course while frames carry none`() {
        val moving = WatchGroupRide.accepting(GroupRideFrame(courseDeg = 120.0, spanM = 600.0, riders = emptyList()), previous = null)
        val stopped = WatchGroupRide.accepting(GroupRideFrame(courseDeg = null, spanM = 600.0, riders = emptyList()), previous = moving)

        assertEquals(120.0, stopped.courseDeg, 0.0)
    }

    @Test
    fun `distance labels drop the space before the unit`() {
        assertEquals("680m", groupRideDistanceLabel(680.0, "metric"))
        assertEquals("2.1km", groupRideDistanceLabel(2_100.0, "metric"))
        assertEquals("1.3mi", groupRideDistanceLabel(2_100.0, "imperial"))
    }
}
