package expo.modules.vescapecore.weather

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun forecastBody(temperatureC: Int) =
    """{"current":{"time":"2026-06-10T12:00","temperature_2m":$temperatureC.0,"weather_code":3}}"""

/**
 * Forecast lifecycle: the freshness and distance gate, coalescing of in-flight requests without
 * losing the ride's newest position, and retention of a successful result across later failures.
 * @parity /modules/vescape-core/ios/weather/WeatherCoordinatorTests.swift
 */
class WeatherCoordinatorTest {
    /** Records every request and hands each one's completion back for manual resolution. */
    private class RecordingTransport : WeatherTransport {
        val urls = mutableListOf<String>()
        private val pending = mutableListOf<(String?) -> Unit>()

        val inFlight: Int get() = pending.size

        override fun fetch(url: String, onResult: (String?) -> Unit) {
            urls.add(url)
            pending.add(onResult)
        }

        fun resolveLast(body: String?) {
            pending.removeAt(pending.size - 1)(body)
        }
    }

    private var now = 1_000L
    private val transport = RecordingTransport()
    private val coordinator = WeatherCoordinator(transport = transport, nowMs = { now })

    @Test
    fun `holds a fresh forecast rather than refetching per GPS Fix`() {
        coordinator.onPosition(52.2000, 21.0000)
        transport.resolveLast(forecastBody(20))

        // A metre down the road, seconds later: same grid cell, same ten-minute window.
        coordinator.onPosition(52.2001, 21.0001)
        now += 60_000

        assertEquals(1, transport.urls.size)
        assertEquals(20, coordinator.current?.temperatureC)
    }

    @Test
    fun `refetches once the rider leaves the area the forecast describes`() {
        coordinator.onPosition(52.2, 21.0)
        transport.resolveLast(forecastBody(20))

        coordinator.onPosition(52.4, 21.0)

        assertEquals(2, transport.urls.size)
        assertTrue(transport.urls.last().contains("latitude=52.4"))
    }

    @Test
    fun `refetches once the forecast ages out where the rider is standing`() {
        coordinator.onPosition(52.2, 21.0)
        transport.resolveLast(forecastBody(20))

        now += WeatherCoordinator.FORECAST_TTL_MS
        coordinator.onPosition(52.2, 21.0)

        assertEquals(2, transport.urls.size)
    }

    @Test
    fun `follows the ride to the position that arrived mid-fetch`() {
        coordinator.onPosition(52.2, 21.0)
        // The ride keeps moving while the request is out; those Fixes must not simply be dropped.
        coordinator.onPosition(52.3, 21.0)
        coordinator.onPosition(52.5, 21.0)
        assertEquals(1, transport.inFlight)

        transport.resolveLast(forecastBody(20))

        assertEquals(2, transport.urls.size)
        assertTrue(transport.urls.last().contains("latitude=52.5"))
    }

    @Test
    fun `drops a mid-fetch position that the landed forecast already describes`() {
        coordinator.onPosition(52.2000, 21.0)
        coordinator.onPosition(52.2001, 21.0)

        transport.resolveLast(forecastBody(20))

        assertEquals(1, transport.urls.size)
    }

    @Test
    fun `keeps the last good forecast when a later refresh fails`() {
        coordinator.onPosition(52.2, 21.0)
        transport.resolveLast(forecastBody(20))

        now += WeatherCoordinator.FORECAST_TTL_MS
        coordinator.onPosition(52.2, 21.0)
        transport.resolveLast(null)

        assertEquals(20, coordinator.current?.temperatureC)
    }

    @Test
    fun `starts empty and ignores a rider refresh before the first fetch`() {
        coordinator.refresh()

        assertNull(coordinator.current)
        assertEquals(0, transport.urls.size)
    }

    @Test
    fun `notifies listeners on every successful refresh only`() {
        val seen = mutableListOf<Int?>()
        coordinator.addChangeListener { seen.add(it?.temperatureC) }

        coordinator.onPosition(52.2, 21.0)
        transport.resolveLast(forecastBody(20))
        now += WeatherCoordinator.FORECAST_TTL_MS
        coordinator.onPosition(52.2, 21.0)
        transport.resolveLast(null)

        assertEquals(listOf<Int?>(20), seen)
    }
}
