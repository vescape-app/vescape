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
        repository = { error("repository should not be used") },
        port = object : ConfigRWControllerPort {
            override fun connection() = ConfigConnectionSnapshot(
                config = config,
                phase = BoardPhase.Connected,
                transport = BoardTransport.Direct,
                fwVersion = "FW 6.05",
                linkIntegrity = linkIntegrity,
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
            override fun onBoardConfigValues(values: BoardConfigValues) = Unit
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
        controller().consumeWrite(PendingConfigWrite(
            profileId = "profile-1",
            onSuccess = { error("write should not succeed") },
            onError = { code, message -> errors.add(code to message) },
        ))

        assertEquals(listOf(RefloatConfigErrorCode.LINK_NOT_TRUSTED.name to "Trusted board link required before pushing config"), errors)
        assertFalse(stoppedPolling)
        assertFalse(sentPayload)
    }
}
