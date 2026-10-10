package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.TestScheduler
import expo.modules.vescapecore.service.SessionConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shared read (#393): the post-trust background read serves every consumer that asks for config while
 * it is on the wire, instead of rejecting the second caller with `CONFIG_REQUEST_IN_FLIGHT`.
 *
 * @parity /modules/vescape-core/ios/config/ConfigRWControllerSharedReadTests.swift
 */
class ConfigRWControllerSharedReadTest {
    private val scheduler = TestScheduler()
    private val errors = mutableListOf<String>()

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
                linkIntegrity = LinkIntegrity.Trusted,
            )

            override fun isPollingActive() = false
            override fun stopPolling() = Unit
            override fun startPolling() = Unit
            override fun sendPayload(payload: ByteArray) = true
            override fun captureDiagnostic(name: String, properties: Map<String, Any?>) = Unit
            override fun diagnosticProperties(config: SessionConfig?, category: String) = emptyMap<String, Any?>()
            override fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray) = Unit
            override fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) = Unit
        },
    )

    @Test
    fun secondReaderJoinsTheInFlightRead() {
        val controller = controller()
        val pending = PendingConfigRead(onSuccess = {}, onError = { code, _ -> errors.add(code) })

        controller.consumeRead(pending)
        controller.consumeRead(pending)

        assertTrue(controller.isInFlight)
        assertEquals(emptyList<String>(), errors)
    }
}
