package expo.modules.vescapecore.telemetry
import expo.modules.vescapecore.protocol.RefloatTelemetry
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TelemetryPipelineTest {

    private val sessionConfig = SessionConfig(
        appBoardId = "board-1",
        deviceId = "AA:BB",
        deviceName = "Test Board",
        transport = null,
        pollIntervalMs = 100L,
        recordingEnabled = false,
        telemetryRecordingEnabled = false,
        autoReconnect = true,
    )

    private fun buildPipeline(
        scheduler: TestScheduler = TestScheduler(),
        staleTimeoutMs: Long = 1_000L,
        onTelemetryStale: () -> Unit = {},
    ): TelemetryPipeline = TelemetryPipeline(
        scheduler = scheduler,
        onTelemetryStale = onTelemetryStale,
        captureBuilder = { parsed, cfg, canId -> testCapture(parsed, cfg, canId) },
        nowMs = { scheduler.currentTimeMs },
        staleTimeoutMs = staleTimeoutMs,
    )

    @Test
    fun `process appends sample and updates lastTelemetryAt`() {
        val scheduler = TestScheduler()
        val pipeline = buildPipeline(scheduler)
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)

        val processed = pipeline.process(telemetry(speed = 20.0, packetAt = 5_000L), session)

        assertNotNull(processed)
        assertEquals(5_000L, pipeline.lastTelemetryAt)
        assertEquals(1, pipeline.recentSnapshot().size)
        assertEquals(20.0, pipeline.recentSnapshot()[0]["speed"])
    }

    @Test
    fun `process rejects sample after session invalidated`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        session.invalidate()

        val processed = pipeline.process(telemetry(packetAt = 1_000L), session)

        assertNull(processed)
        assertEquals(0L, pipeline.lastTelemetryAt)
        assertTrue(pipeline.recentSnapshot().isEmpty())
    }

    @Test
    fun `process rejects sample from different session token`() {
        val pipeline = buildPipeline()
        val activeSession = BoardSession(id = 1)
        val staleToken = BoardSession(id = 2)
        pipeline.beginSession(activeSession, sessionConfig)

        val processed = pipeline.process(telemetry(packetAt = 1_000L), staleToken)

        assertNull(processed)
    }

    @Test
    fun `live history limit prunes old samples on append`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.setLiveHistoryLimitMinutes(1) // 60_000 ms window

        pipeline.process(telemetry(packetAt = 10_000L), session)
        pipeline.process(telemetry(packetAt = 20_000L), session)
        // 80s later — both prior samples are >60s old, pruned
        pipeline.process(telemetry(packetAt = 90_000L), session)

        assertEquals(1, pipeline.recentSnapshot().size)
        assertEquals(90_000L, pipeline.recentSnapshot()[0]["lastPacketAt"])
    }

    @Test
    fun `sanitizer marks low-speed sample as excluded from avg speed`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)

        // default movingSpeedThresholdCentiKmh = 300 (3 km/h)
        pipeline.process(telemetry(speed = 1.0, packetAt = 1_000L), session)
        pipeline.process(telemetry(speed = 10.0, packetAt = 2_000L), session)

        val recent = pipeline.recentSnapshot()
        val first = recent[0]["metricExclusions"] as Map<*, *>
        val second = recent[1]["metricExclusions"] as Map<*, *>
        assertEquals(true, first[METRIC_AVG_SPEED])
        assertTrue(second.isEmpty())
    }

    @Test
    fun `setLiveHistoryLimitMinutes prunes existing buffers`() {
        val scheduler = TestScheduler()
        val pipeline = buildPipeline(scheduler)
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.setLiveHistoryLimitMinutes(5)

        scheduler.advance(0)
        pipeline.process(telemetry(packetAt = 1_000L), session)
        scheduler.advance(60_000L)
        pipeline.process(telemetry(packetAt = 61_000L), session)

        assertEquals(2, pipeline.recentSnapshot().size)

        // Shrink to 1 minute at nowMs = 61_000 -> oldest = 1_000
        // The first sample's lastPacketAt = 1_000, equal to oldest, retained.
        scheduler.advance(30_000L) // now 91_000, oldest = 31_000
        pipeline.setLiveHistoryLimitMinutes(1)

        val remaining = pipeline.recentSnapshot()
        assertEquals(1, remaining.size)
        assertEquals(61_000L, remaining[0]["lastPacketAt"])
    }

    @Test
    fun `stale watchdog fires after configured delay`() {
        val scheduler = TestScheduler()
        var stale = 0
        val pipeline = buildPipeline(
            scheduler = scheduler,
            staleTimeoutMs = 4_000L,
            onTelemetryStale = { stale += 1 },
        )
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(packetAt = 0L), session)

        scheduler.advance(3_999L)
        assertEquals(0, stale)

        scheduler.advance(1L)
        assertEquals(1, stale)
    }

    @Test
    fun `stale watchdog fires when autoReconnect disabled`() {
        val scheduler = TestScheduler()
        var stale = 0
        val pipeline = buildPipeline(
            scheduler = scheduler,
            staleTimeoutMs = 1_000L,
            onTelemetryStale = { stale += 1 },
        )
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig.copy(autoReconnect = false))
        pipeline.process(telemetry(packetAt = 0L), session)

        scheduler.advance(1_000L)
        assertEquals(1, stale)
    }

    @Test
    fun `stale watchdog skipped when fresh telemetry arrives before timeout`() {
        val scheduler = TestScheduler()
        var stale = 0
        val pipeline = buildPipeline(
            scheduler = scheduler,
            staleTimeoutMs = 1_000L,
            onTelemetryStale = { stale += 1 },
        )
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(packetAt = 0L), session)

        scheduler.advance(500L)
        pipeline.process(telemetry(packetAt = 500L), session) // re-arms

        scheduler.advance(700L) // 500ms past second arm
        assertEquals(0, stale)

        scheduler.advance(500L)
        assertEquals(1, stale)
    }

    @Test
    fun `endSession clears buffers and cancels watchdog`() {
        val scheduler = TestScheduler()
        var stale = 0
        val pipeline = buildPipeline(
            scheduler = scheduler,
            staleTimeoutMs = 1_000L,
            onTelemetryStale = { stale += 1 },
        )
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(packetAt = 100L), session)

        pipeline.endSession()
        scheduler.advance(5_000L)

        assertEquals(0, stale)
        assertTrue(pipeline.recentSnapshot().isEmpty())
        assertEquals(0L, pipeline.lastTelemetryAt)
    }

    @Test
    fun `clearLiveTelemetry drops stale data while keeping Board Session active`() {
        val scheduler = TestScheduler()
        val pipeline = buildPipeline(scheduler)
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(speed = 20.0, packetAt = 100L), session)

        pipeline.clearLiveTelemetry()
        val next = pipeline.process(telemetry(speed = 5.0, packetAt = 200L), session)

        assertNotNull(next)
        assertEquals(200L, pipeline.lastTelemetryAt)
        assertEquals(listOf(5.0), pipeline.recentSnapshot().map { it["speed"] })
    }

    @Test
    fun `focusedSeries returns null for an unknown metric key`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(speed = 20.0, packetAt = 1_000L), session)

        assertNull(pipeline.focusedSeries("not-a-metric"))
    }

    @Test
    fun `focusedSeries serves a detail-only metric absent from the center set`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(speed = 20.0, packetAt = 1_000L), session)

        // pitch is focused-only (not streamed on the center `onLiveSeries` set).
        assertTrue(LIVE_SERIES_METRICS.none { it.key == "pitch" })
        assertTrue(ALL_SERIES_METRICS.any { it.key == "pitch" })
        val focused = pipeline.focusedSeries("pitch")
        assertNotNull(focused)
        assertTrue(focused!!.series.isNotEmpty())
    }

    @Test
    fun `focusedSeries reports the covered span and the measured packet rate`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)

        // Five samples 50ms apart: 200ms of coverage at 20Hz.
        for (i in 0 until 5) {
            pipeline.process(telemetry(speed = 20.0, packetAt = 1_000L + i * 50L), session)
        }

        val focused = pipeline.focusedSeries("speed")
        assertNotNull(focused)
        assertEquals(200L, focused!!.spanMs)
        assertEquals(20.0, focused.sampleRateHz, 0.001)
    }

    @Test
    fun `focusedSeries reports a zero rate until two samples exist`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)
        pipeline.process(telemetry(speed = 20.0, packetAt = 1_000L), session)

        val focused = pipeline.focusedSeries("speed")
        assertNotNull(focused)
        assertEquals(0L, focused!!.spanMs)
        assertEquals(0.0, focused.sampleRateHz, 0.001)
    }

    @Test
    fun `focusedSeries carries avg_speed excluded spans for a low-speed run`() {
        val pipeline = buildPipeline()
        val session = BoardSession(id = 1)
        pipeline.beginSession(session, sessionConfig)

        // speed 1 km/h < 3 km/h threshold -> excluded from avg speed; the fast sample is not.
        pipeline.process(telemetry(speed = 1.0, packetAt = 1_000L), session)
        pipeline.process(telemetry(speed = 1.0, packetAt = 2_000L), session)
        pipeline.process(telemetry(speed = 10.0, packetAt = 3_000L), session)

        val focused = pipeline.focusedSeries("speed")
        assertNotNull(focused)
        assertEquals(
            listOf(1_000.0, 2_000.0),
            focused!!.exclusions[METRIC_AVG_SPEED]?.toList(),
        )
        assertNull(focused.exclusions[METRIC_MAX_DUTY])
    }

    private fun telemetry(
        speed: Double = 0.0,
        packetAt: Long = 0L,
    ): RefloatTelemetry = RefloatTelemetry(
        pitch = 0.0,
        roll = 0.0,
        balancePitch = 0.0,
        balanceCurrent = 0.0,
        speed = speed,
        batteryVoltage = 70.0,
        motorCurrent = 0.0,
        batteryCurrent = 0.0,
        erpm = 0,
        dutyCycle = 0.0,
        state = 0,
        switchState = 0,
        adc1 = 0.0,
        adc2 = 0.0,
        odometer = null,
        tempMosfet = null,
        tempMotor = null,
        hasFault = false,
        faultCode = 0,
        avgLatency = null,
        pullRateHz = null,
        lastPacketAt = packetAt,
        location = null,
    )

    private fun testCapture(
        parsed: RefloatTelemetry,
        cfg: SessionConfig,
        canId: Int?,
    ): TelemetryCapture = TelemetryCapture(
        capturedAtMs = parsed.lastPacketAt,
        elapsedRealtimeMs = parsed.lastPacketAt,
        deviceId = cfg.deviceId,
        deviceName = cfg.deviceName,
        canId = canId,
        pitch = parsed.pitch,
        roll = parsed.roll,
        balancePitch = parsed.balancePitch,
        balanceCurrent = parsed.balanceCurrent,
        speed = parsed.speed,
        batteryVoltage = parsed.batteryVoltage,
        motorCurrent = parsed.motorCurrent,
        batteryCurrent = parsed.batteryCurrent,
        erpm = parsed.erpm,
        dutyCycle = parsed.dutyCycle,
        state = parsed.state,
        switchState = parsed.switchState,
        adc1 = parsed.adc1,
        adc2 = parsed.adc2,
        odometer = parsed.odometer,
        tempMosfet = parsed.tempMosfet,
        tempMotor = parsed.tempMotor,
        avgLatency = parsed.avgLatency,
        location = null,
    )
}
