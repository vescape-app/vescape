package expo.modules.vescapecore.connection

import expo.modules.vescapecore.service.SessionConfig

import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/connection/PollingLoopTests.swift */
class PollingLoopTest {
    private val scheduler = TestScheduler()
    private val session = BoardSession(1)

    private fun loop() = PollingLoop(
        scheduler = scheduler,
        isCurrentSession = { true },
        sendPayloadWithRetry = { _, _ -> true },
        nowMs = { scheduler.currentTimeMs },
    )

    private fun config(hz: Int) = SessionConfig(
        appBoardId = null,
        deviceId = null,
        deviceName = "test",
        transport = BoardTransport.Direct,
        pollIntervalMs = pollIntervalMsForHz(hz),
        recordingEnabled = false,
        telemetryRecordingEnabled = false,
    )

    /** One response-paced round-trip: response lands after [roundTripMs], next poll fires on the floor. */
    private fun cycle(loop: PollingLoop, roundTripMs: Long, floorMs: Long) {
        scheduler.advance(roundTripMs)
        loop.onResponse()
        scheduler.advance(floorMs - roundTripMs)
    }

    @Test
    fun rateUnknownUntilSecondPoll() {
        val loop = loop()
        assertNull(loop.measuredRateHz())

        loop.start(config(20), session, BoardTransport.Direct)
        // Only the first poll has been sent; no interval to measure yet.
        assertNull(loop.measuredRateHz())
    }

    @Test
    fun rateTracksResponsePacedCadence() {
        val loop = loop()
        loop.start(config(20), session, BoardTransport.Direct)

        repeat(10) { cycle(loop, roundTripMs = 20, floorMs = 50) }

        // Steady 50ms spacing → 20 Hz.
        assertEquals(20.0, loop.measuredRateHz()!!, 0.001)
    }

    @Test
    fun restartResetsRate() {
        val loop = loop()
        loop.start(config(20), session, BoardTransport.Direct)
        repeat(5) { cycle(loop, roundTripMs = 20, floorMs = 50) }
        assertEquals(20.0, loop.measuredRateHz()!!, 0.001)

        loop.start(config(10), BoardSession(2), BoardTransport.Direct)
        // Fresh session: prior cadence is discarded until a new interval is measured.
        assertNull(loop.measuredRateHz())
    }
}
