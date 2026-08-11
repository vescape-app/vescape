package expo.modules.vescapecore.diagnostics
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.service.SessionConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsRecorderTest {

    private data class CapturedEvent(val name: String, val properties: Map<String, Any?>)

    private val session = SessionConfig(
        appBoardId = "board-1",
        deviceId = "AA:BB",
        deviceName = "Test Board",
        transport = BoardTransport.Can(10),
        pollIntervalMs = 100L,
        recordingEnabled = false,
        telemetryRecordingEnabled = false,
        autoReconnect = true,
    )

    private val staticContext = DiagnosticContext(
        phaseWire = "connected",
        connectionSeq = 3L,
        connectAttempt = 1,
        autoReconnectAttempt = 0,
        canId = 10,
        directConnection = false,
        lastSentCommand = 1,
        lastReceivedCommandByte = 2,
        lastTelemetryAt = 12345L,
    )

    private fun recorder(
        local: MutableList<CapturedEvent>,
        ctx: DiagnosticContext = staticContext,
    ) = DiagnosticsRecorder(
        local = { name, props -> local.add(CapturedEvent(name, props)) },
        context = { ctx },
    )

    @Test
    fun `captureDiagnostic writes to the local sink`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        r.captureDiagnostic("event", mapOf("k" to "v"))

        assertEquals(listOf(CapturedEvent("event", mapOf("k" to "v"))), local)
    }

    @Test
    fun `recordLocalDiagnostic decorates the event with session context`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        r.recordLocalDiagnostic("gatt_ready", session, "connect", mapOf("message" to "ok"))

        assertEquals(1, local.size)
        assertEquals("gatt_ready", local[0].name)
        assertEquals("connect", local[0].properties["operation"])
        assertEquals("AA:BB", local[0].properties["ble_id"])
        assertEquals("ok", local[0].properties["message"])
    }

    @Test
    fun `telemetry parse failure reports once across repeated calls`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)
        val payload = ByteArray(4) { it.toByte() }

        repeat(5) { r.captureTelemetryParseFailed(payload, session) }

        assertEquals(5, r.telemetryParseFailedCount())
        assertEquals(1, local.size)
        assertEquals(1, local.size)
        assertEquals("telemetry_parse_failed", local[0].name)
        assertEquals(1, local[0].properties["telemetry_parse_failed_count"])
        assertEquals("Invalid Refloat telemetry payload", local[0].properties["message"])
    }

    @Test
    fun `flush emits aggregate event with total count then resets`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        repeat(4) { r.captureTelemetryParseFailed(ByteArray(2), session) }
        r.flushTelemetryDiagnostics("reconnect", session)

        assertEquals(0, r.telemetryParseFailedCount())
        assertEquals(2, local.size)
        val flushEvent = local[1]
        assertEquals("telemetry_parse_failed", flushEvent.name)
        assertEquals(4, flushEvent.properties["telemetry_parse_failed_count"])
        assertEquals("reconnect", flushEvent.properties["reason"])
        assertEquals("Telemetry parse failures aggregated", flushEvent.properties["message"])
    }

    @Test
    fun `flush is noop when no failures recorded`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        r.flushTelemetryDiagnostics("stop", session)

        assertTrue(local.isEmpty())
        assertTrue(local.isEmpty())
    }

    @Test
    fun `parse failure reports again after flush`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        r.captureTelemetryParseFailed(ByteArray(2), session)
        r.flushTelemetryDiagnostics("reconnect", session)
        r.captureTelemetryParseFailed(ByteArray(2), session)

        assertEquals(3, local.size)
        assertEquals(1, r.telemetryParseFailedCount())
        assertEquals(1, local[2].properties["telemetry_parse_failed_count"])
    }

    @Test
    fun `reset clears count without emitting`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        r.captureTelemetryParseFailed(ByteArray(2), session)
        r.resetTelemetryParseFailedCounters()

        assertEquals(0, r.telemetryParseFailedCount())
        assertEquals(1, local.size)

        r.captureTelemetryParseFailed(ByteArray(2), session)
        assertEquals(2, local.size)
    }

    @Test
    fun `diagnosticProperties pulls from context provider`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        val props = r.diagnosticProperties(session, "telemetry")

        assertEquals("telemetry", props["operation"])
        assertEquals("connected", props["phase"])
        assertEquals(3L, props["connection_seq"])
        assertEquals(10, props["can_id"])
        assertEquals(false, props["direct_connection"])
        assertEquals(12345L, props["last_telemetry_timestamp"])
        assertEquals(true, props["auto_reconnect_enabled"])
    }

    @Test
    fun `diagnosticProperties omits last telemetry timestamp when never observed`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local, staticContext.copy(lastTelemetryAt = 0L))

        val props = r.diagnosticProperties(session, "connect")

        assertNull(props["last_telemetry_timestamp"])
    }

    @Test
    fun `diagnosticProperties tolerates null session`() {
        val local = mutableListOf<CapturedEvent>()
        val r = recorder(local)

        val props = r.diagnosticProperties(null, "connect")

        assertNull(props["board_id"])
        assertNull(props["ble_id"])
        assertNull(props["auto_reconnect_enabled"])
        assertEquals("connect", props["operation"])
    }
}
