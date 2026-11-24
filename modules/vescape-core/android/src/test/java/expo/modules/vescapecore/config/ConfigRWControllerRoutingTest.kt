package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_GET_ALLDATA
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_LIGHTS_CONTROL
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.protocol.parseLightsControlResponse
import expo.modules.vescapecore.protocol.parseRefloatGetAllData
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.TestScheduler
import expo.modules.vescapecore.service.SessionConfig
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/config/ConfigRWControllerRoutingTests.swift
 */
class ConfigRWControllerRoutingTest {
    private val schemaXml = """
        <CustomConfiguration>
          <params>
            <param name="kp" type="float" min="0" max="100" />
          </params>
        </CustomConfiguration>
    """.trimIndent().encodeToByteArray()

    private val configBytes: ByteArray = ByteBuffer.allocate(4)
        .order(ByteOrder.BIG_ENDIAN)
        .putFloat(12.5f)
        .array()

    private val lightsEchoPayload = byteArrayOf(
        COMM_CUSTOM_APP_DATA.toByte(),
        REFLOAT_MAGIC.toByte(),
        REFLOAT_LIGHTS_CONTROL.toByte(),
        3,
    )

    private val telemetryPayload = ByteArray(34).apply {
        this[0] = COMM_CUSTOM_APP_DATA.toByte()
        this[1] = REFLOAT_MAGIC.toByte()
        this[2] = REFLOAT_GET_ALLDATA.toByte()
        this[3] = 1
    }

    private val infoPayload = byteArrayOf(
        COMM_CUSTOM_APP_DATA.toByte(),
        REFLOAT_MAGIC.toByte(),
        REFLOAT_GET_INFO.toByte(),
        12,
        1,
        0,
    )

    @Test
    fun telemetryAndLightsCustomAppDataReachHandlersDuringReadAndWrite() {
        val scheduler = TestScheduler()
        val sent = mutableListOf<ByteArray>()
        val controller = controller(scheduler, BoardTransport.Direct, sent)

        var readDone = false
        controller.consumeRead(
            PendingConfigRead(
                onSuccess = { readDone = true },
                onError = { code, message -> error("read should not fail: $code $message") },
            ),
        )
        assertTrue(controller.isInFlight)
        assertFalse(controller.onPayload(telemetryPayload, 1L))
        assertNotNull(parseRefloatGetAllData(telemetryPayload, null, 1L, null))
        assertFalse(controller.onPayload(lightsEchoPayload, 2L))
        assertEquals(BoardLightsState(enabled = true, headlightsEnabled = true), parseLightsControlResponse(lightsEchoPayload))
        assertTrue(controller.onPayload(infoPayload, 3L))

        assertTrue(controller.onPayload(xmlChunkPayload(null, schemaXml.size, 0, schemaXml), 4L))
        assertTrue(controller.onPayload(configPayload(null, configBytes), 5L))
        assertTrue(readDone)

        var writeDone = false
        controller.consumeWrite(
            PendingConfigWrite.Profile(
                profileId = "profile-1",
                onSuccess = { writeDone = true },
                onError = { code, message -> error("write should not fail: $code $message") },
            ),
        )
        scheduler.advance(0L)
        assertTrue(controller.isInFlight)
        assertFalse(controller.onPayload(telemetryPayload, 6L))
        assertFalse(controller.onPayload(lightsEchoPayload, 7L))
        assertTrue(controller.onPayload(infoPayload, 8L))

        val patched = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putFloat(33.0f).array()
        assertTrue(controller.onPayload(xmlChunkPayload(null, schemaXml.size, 0, schemaXml), 9L))
        assertTrue(controller.onPayload(configPayload(null, configBytes), 10L))
        controller.onRideState(BoardRideState(state = 0, switchState = 0, receivedAtMs = System.currentTimeMillis()))
        assertTrue(controller.onPayload(byteArrayOf(COMM_SET_CUSTOM_CONFIG.toByte()), 11L))
        assertTrue(controller.onPayload(configPayload(null, patched), 12L))
        assertTrue(writeDone)
    }

    @Test
    fun wrappedReplyForDifferentCanIdIsNotConsumedAndUnwrappedRepliesOnCanWork() {
        val scheduler = TestScheduler()
        val sent = mutableListOf<ByteArray>()
        val controller = controller(scheduler, BoardTransport.Can(7), sent)

        var readDone = false
        controller.consumeRead(
            PendingConfigRead(
                onSuccess = { readDone = true },
                onError = { code, message -> error("read should not fail: $code $message") },
            ),
        )
        assertFalse(controller.onPayload(xmlChunkPayload(9, schemaXml.size, 0, schemaXml), 1L))
        assertFalse(controller.onPayload(configPayload(9, configBytes), 2L))
        assertFalse(controller.onPayload(byteArrayOf(COMM_FORWARD_CAN.toByte(), 9) + infoPayload, 3L))
        assertTrue(controller.isInFlight)

        assertTrue(controller.onPayload(xmlChunkPayload(null, schemaXml.size, 0, schemaXml), 4L))
        assertTrue(controller.onPayload(configPayload(null, configBytes), 5L))
        assertTrue(readDone)
    }

    @Test
    fun wrappedReplyOnDirectTransportIsNotConsumed() {
        val scheduler = TestScheduler()
        val sent = mutableListOf<ByteArray>()
        val controller = controller(scheduler, BoardTransport.Direct, sent)

        controller.consumeRead(
            PendingConfigRead(
                onSuccess = { error("read should not complete from wrapped reply") },
                onError = { code, message -> error("read should not fail: $code $message") },
            ),
        )
        assertFalse(controller.onPayload(xmlChunkPayload(7, schemaXml.size, 0, schemaXml), 1L))
        assertFalse(controller.onPayload(configPayload(7, configBytes), 2L))
        assertFalse(controller.onPayload(byteArrayOf(COMM_FORWARD_CAN.toByte(), 7) + infoPayload, 3L))
        assertTrue(controller.isInFlight)
    }

    @Test
    fun writeDetectsOutOfOrderAndDuplicateXmlChunksAndRetries() {
        val scheduler = TestScheduler()
        val sent = mutableListOf<ByteArray>()
        val controller = controller(scheduler, BoardTransport.Direct, sent)

        var writeDone = false
        controller.consumeWrite(
            PendingConfigWrite.Profile(
                profileId = "profile-1",
                onSuccess = { writeDone = true },
                onError = { code, message -> error("write should not fail: $code $message") },
            ),
        )
        scheduler.advance(0L)
        val firstChunk = xmlChunkPayload(null, schemaXml.size, 0, schemaXml.copyOfRange(0, 10))
        val outOfOrderChunk = xmlChunkPayload(null, schemaXml.size, 20, schemaXml.copyOfRange(20, schemaXml.size))
        val secondChunk = xmlChunkPayload(null, schemaXml.size, 10, schemaXml.copyOfRange(10, schemaXml.size))

        assertTrue(controller.onPayload(firstChunk, 1L))
        val sentAfterFirst = sent.size
        assertTrue(controller.onPayload(firstChunk, 2L))
        assertTrue(controller.onPayload(outOfOrderChunk, 3L))
        assertEquals(sentAfterFirst, sent.size)

        scheduler.advance(CONFIG_SCHEMA_TIMEOUT_MS)
        assertEquals(sentAfterFirst + 1, sent.size)
        assertTrue(controller.isInFlight)

        val patched = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putFloat(33.0f).array()
        assertTrue(controller.onPayload(secondChunk, 4L))
        assertTrue(controller.onPayload(configPayload(null, configBytes), 5L))
        controller.onRideState(BoardRideState(state = 0, switchState = 0, receivedAtMs = System.currentTimeMillis()))
        assertTrue(controller.onPayload(byteArrayOf(COMM_SET_CUSTOM_CONFIG.toByte()), 6L))
        assertTrue(controller.onPayload(configPayload(null, patched), 7L))
        assertTrue(writeDone)
    }

    private fun controller(
        scheduler: TestScheduler,
        transport: BoardTransport,
        sent: MutableList<ByteArray>,
    ): ConfigRWController {
        val config = SessionConfig(
            appBoardId = "board-1",
            deviceId = "ble-1",
            deviceName = "Board",
            transport = transport,
            pollIntervalMs = 1000,
            recordingEnabled = false,
            telemetryRecordingEnabled = false,
            refloatBaseVersion = "3.0.7",
            refloatVersion = "Refloat 3.0.7",
        )
        return ConfigRWController(
            scheduler = scheduler,
            appDataScope = CoroutineScope(Dispatchers.Unconfined),
            loadProfile = {
                mapOf(
                    "boardId" to "board-1",
                    "refloatBaseVersion" to "3.0.7",
                    "fields" to mapOf("kp" to 33.0),
                )
            },
            port = object : ConfigRWControllerPort {
                override fun connection() = ConfigConnectionSnapshot(
                    config = config,
                    phase = BoardPhase.Connected,
                    transport = transport,
                    fwVersion = "FW 6.05",
                    linkIntegrity = LinkIntegrity.Trusted,
                    rideState = BoardRideState(state = 0, switchState = 0, receivedAtMs = System.currentTimeMillis()),
                )

                override fun isPollingActive() = false
                override fun stopPolling() = Unit
                override fun startPolling() = Unit
                override fun sendPayload(payload: ByteArray): Boolean {
                    sent.add(payload)
                    return true
                }
                override fun captureDiagnostic(name: String, properties: Map<String, Any?>) = Unit
                override fun diagnosticProperties(config: SessionConfig?, category: String) = emptyMap<String, Any?>()
                override fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray) = Unit
                override fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) = Unit
                override fun demoteWriteBase() = Unit
            },
        )
    }

    private fun xmlChunkPayload(canId: Int?, totalLength: Int, offset: Int, chunk: ByteArray): ByteArray {
        val body = ByteBuffer.allocate(10 + chunk.size)
            .order(ByteOrder.BIG_ENDIAN)
            .put(COMM_GET_CUSTOM_CONFIG_XML.toByte())
            .put(0.toByte())
            .putInt(totalLength)
            .putInt(offset)
            .put(chunk)
            .array()
        return if (canId == null) body else byteArrayOf(COMM_FORWARD_CAN.toByte(), canId.toByte()) + body
    }

    private fun configPayload(canId: Int?, bytes: ByteArray): ByteArray {
        val body = ByteBuffer.allocate(6 + bytes.size)
            .order(ByteOrder.BIG_ENDIAN)
            .put(COMM_GET_CUSTOM_CONFIG.toByte())
            .put(0.toByte())
            .putInt(0x12345678)
            .put(bytes)
            .array()
        return if (canId == null) body else byteArrayOf(COMM_FORWARD_CAN.toByte(), canId.toByte()) + body
    }
}
