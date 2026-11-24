package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.TestScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ConfigRWControllerLinkIntegrityTest {
    private val scheduler = TestScheduler()
    private var linkIntegrity = LinkIntegrity.Trusted
    private var rideState: BoardRideState? = null
    private var stoppedPolling = false
    private var sentPayload = false
    private val errors = mutableListOf<Pair<String, String>>()

    private val config = SessionConfig(
        appBoardId = "board-1",
        deviceId = "ble-1",
        deviceName = "Board",
        transport = BoardTransport.Direct,
        pollIntervalMs = 1000,
        recordingEnabled = false,
        telemetryRecordingEnabled = false,
    )

    private fun controller() = ConfigRWController(
        scheduler = scheduler,
        appDataScope = CoroutineScope(Dispatchers.Unconfined),
        loadProfile = { error("loadProfile should not be used") },
        port = object : ConfigRWControllerPort {
            override fun connection() = ConfigConnectionSnapshot(
                config = config,
                phase = BoardPhase.Connected,
                transport = BoardTransport.Direct,
                fwVersion = "FW 6.05",
                linkIntegrity = linkIntegrity,
                rideState = rideState,
            )

            override fun isPollingActive() = true
            override fun stopPolling() { stoppedPolling = true }
            override fun startPolling() = Unit
            override fun sendPayload(payload: ByteArray): Boolean {
                sentPayload = true
                return true
            }
            override fun captureDiagnostic(name: String, properties: Map<String, Any?>) = Unit
            override fun diagnosticProperties(config: SessionConfig?, category: String) = emptyMap<String, Any?>()
            override fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray) = Unit
            override fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) = Unit
            override fun demoteWriteBase() = Unit
        },
    )

    @Test
    fun readFailsClosedWhenLinkIsChecking() {
        readFailsClosed(LinkIntegrity.Checking)
    }

    @Test
    fun readFailsClosedWhenLinkIsOutdated() {
        readFailsClosed(LinkIntegrity.Outdated)
    }

    private fun readFailsClosed(integrity: LinkIntegrity) {
        linkIntegrity = integrity
        controller().consumeRead(PendingConfigRead(
            onSuccess = { error("read should not succeed") },
            onError = { code, message -> errors.add(code to message) },
        ))

        assertEquals(listOf(RefloatConfigErrorCode.LINK_NOT_TRUSTED.name to "Trusted board link required before reading Refloat config"), errors)
        assertFalse(stoppedPolling)
        assertFalse(sentPayload)
    }

    @Test
    fun writeFailsClosedWhenLinkIsMismatched() {
        writeFailsClosed(LinkIntegrity.Mismatched)
    }

    @Test
    fun writeFailsClosedWhenLinkIsOutdated() {
        writeFailsClosed(LinkIntegrity.Outdated)
    }

    private fun writeFailsClosed(integrity: LinkIntegrity) {
        linkIntegrity = integrity
        controller().consumeWrite(PendingConfigWrite.Profile(
            profileId = "profile-1",
            onSuccess = { error("write should not succeed") },
            onError = { code, message -> errors.add(code to message) },
        ))

        assertEquals(listOf(RefloatConfigErrorCode.LINK_NOT_TRUSTED.name to "Trusted board link required before pushing config"), errors)
        assertFalse(stoppedPolling)
        assertFalse(sentPayload)
    }

    @Test
    fun writeFailsClosedWhenBoardIsNotIdle() {
        val now = System.currentTimeMillis()
        val blocked = listOf(
            BoardRideState(state = 1, switchState = 0, receivedAtMs = now),
            BoardRideState(state = 0, switchState = 0x08, receivedAtMs = now),
            BoardRideState(state = 0, switchState = 0, receivedAtMs = now - 5_000),
            null,
        )
        for (sample in blocked) {
            errors.clear()
            rideState = sample
            controller().consumeWrite(PendingConfigWrite.Profile(
                profileId = "profile-1",
                onSuccess = { error("write should not succeed") },
                onError = { code, message -> errors.add(code to message) },
            ))

            assertEquals("$sample", listOf(RefloatConfigErrorCode.BOARD_NOT_IDLE.name), errors.map { it.first })
            assertFalse(stoppedPolling)
            assertFalse(sentPayload)
        }
    }

    @Test
    fun changesetRejectsMismatchedBoardIdAndNotIdle() {
        val now = System.currentTimeMillis()
        rideState = BoardRideState(state = 0, switchState = 0, receivedAtMs = now)
        controller().consumeWrite(PendingConfigWrite.Changeset(
            boardId = "other-board",
            changes = mapOf("kp" to 20.0),
            onSuccess = { error("write should not succeed") },
            onError = { code, message -> errors.add(code to message) },
        ))
        assertEquals(listOf(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name), errors.map { it.first })
        assertFalse(stoppedPolling)
        assertFalse(sentPayload)

        errors.clear()
        rideState = BoardRideState(state = 1, switchState = 0, receivedAtMs = now)
        controller().consumeWrite(PendingConfigWrite.Changeset(
            boardId = "board-1",
            changes = mapOf("kp" to 20.0),
            onSuccess = { error("write should not succeed") },
            onError = { code, message -> errors.add(code to message) },
        ))
        assertEquals(listOf(RefloatConfigErrorCode.BOARD_NOT_IDLE.name), errors.map { it.first })
        assertFalse(stoppedPolling)
        assertFalse(sentPayload)
    }

    @Test
    fun preSetRecheckBlocksUntrustedLinkAndExpiresQueuedSetFramesOnTimeout() {
        var now = 10_000L
        var currentLink = LinkIntegrity.Trusted
        var currentRide: BoardRideState? = BoardRideState(state = 0, switchState = 0, receivedAtMs = now)
        val cancelledTags = mutableListOf<String>()
        val sentTags = mutableListOf<String?>()
        val schema = RefloatConfigSchema(
            hash = "test",
            fields = listOf(RefloatConfigSchemaField("tuned", RefloatConfigValueType.FLOAT32, "tuned", null, null, null, 0)),
        )
        val raw = byteArrayOf(0x3F, 0x80.toByte(), 0x00, 0x00)
        val freshValues = BoardConfigValues(
            boardId = "board-1",
            refloatBaseVersion = "3.0.7",
            capturedAtMs = now,
            freshness = BoardConfigFreshness.FRESH,
            values = mapOf("tuned" to 1.0),
            writeBase = BoardConfigWriteBase(schema, raw, 0xDEADBEEF),
        )
        var calls = 0
        val testScheduler = TestScheduler()
        val controller = ConfigRWController(
            scheduler = testScheduler,
            appDataScope = CoroutineScope(Dispatchers.Unconfined),
            loadProfile = { null },
            port = object : ConfigRWControllerPort {
                override fun connection(): ConfigConnectionSnapshot {
                    calls += 1
                    val integrity = if (calls >= 2) currentLink else LinkIntegrity.Trusted
                    return ConfigConnectionSnapshot(
                        config = config,
                        phase = BoardPhase.Connected,
                        transport = BoardTransport.Direct,
                        fwVersion = "FW 6.05",
                        linkIntegrity = integrity,
                        boardConfigValues = freshValues,
                        rideState = currentRide,
                    )
                }

                override fun isPollingActive() = false
                override fun stopPolling() = Unit
                override fun startPolling() = Unit
                override fun sendPayload(payload: ByteArray) = true
                override fun sendPayload(payload: ByteArray, tag: String?): Boolean {
                    sentTags.add(tag)
                    return true
                }
                override fun cancelQueuedPayloads(tag: String) {
                    cancelledTags.add(tag)
                }
                override fun captureDiagnostic(name: String, properties: Map<String, Any?>) = Unit
                override fun diagnosticProperties(config: SessionConfig?, category: String) = emptyMap<String, Any?>()
                override fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray) = Unit
                override fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) = Unit
                override fun demoteWriteBase() = Unit
            },
            nowMs = { now },
        )

        currentLink = LinkIntegrity.Mismatched
        errors.clear()
        controller.consumeWrite(
            PendingConfigWrite.Changeset(
                boardId = "board-1",
                changes = mapOf("tuned" to 7.0),
                onSuccess = { error("write should not succeed") },
                onError = { code, message -> errors.add(code to message) },
            ),
        )
        assertEquals(listOf(RefloatConfigErrorCode.LINK_NOT_TRUSTED.name), errors.map { it.first })
        assertEquals(emptyList<String?>(), sentTags)

        calls = 0
        currentLink = LinkIntegrity.Trusted
        errors.clear()
        controller.consumeWrite(
            PendingConfigWrite.Changeset(
                boardId = "board-1",
                changes = mapOf("tuned" to 7.0),
                onSuccess = { error("write should not succeed") },
                onError = { code, message -> errors.add(code to message) },
            ),
        )
        assertEquals(1, sentTags.size)
        val setTag = sentTags.single()!!
        testScheduler.advance(CONFIG_WRITE_TIMEOUT_MS)
        assertEquals(listOf(RefloatConfigErrorCode.CONFIG_WRITE_TIMEOUT.name), errors.map { it.first })
        assertEquals(listOf(setTag), cancelledTags)
    }
}
