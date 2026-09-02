package expo.modules.vescapecore.location

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The monitor itself needs a `Context` and a `Looper`, so the JVM suite covers the phase decision
 * the monitor delegates to. iOS drives the same transitions through the monitor.
 *
 * @parity /modules/vescape-core/ios/location/GpsMonitorPhaseTests.swift
 */
class GpsPhaseTest {
    @Test
    fun `reports idle before a monitor is retained`() {
        assertEquals(
            GpsPhase.Idle,
            GpsPhase.resolve(retained = false, updatesStarted = false, error = null),
        )
    }

    @Test
    fun `not determined then granted goes starting then active`() {
        assertEquals(
            GpsPhase.Starting,
            GpsPhase.resolve(retained = true, updatesStarted = false, error = null),
        )
        assertEquals(
            GpsPhase.Active,
            GpsPhase.resolve(retained = true, updatesStarted = true, error = null),
        )
    }

    @Test
    fun `not determined then denied goes starting then error`() {
        assertEquals(
            GpsPhase.Starting,
            GpsPhase.resolve(retained = true, updatesStarted = false, error = null),
        )
        assertEquals(
            GpsPhase.Error,
            GpsPhase.resolve(
                retained = false,
                updatesStarted = false,
                error = "Location permission not granted",
            ),
        )
    }

    @Test
    fun `a standing error outranks a running monitor`() {
        assertEquals(
            GpsPhase.Error,
            GpsPhase.resolve(retained = true, updatesStarted = true, error = "Location updates failed"),
        )
    }

    @Test
    fun `wire values match the Live State contract`() {
        assertEquals(
            listOf("idle", "starting", "active", "error"),
            GpsPhase.entries.map { it.wireValue },
        )
    }
}
