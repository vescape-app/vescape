package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.connection.isPollingCapable
import expo.modules.vescapecore.diagnostics.newOperationId
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.telemetry.AppDataRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal data class PendingConfigRead(
    val onSuccess: (Map<String, Any?>) -> Unit,
    val onError: (String, String) -> Unit,
)

internal data class PendingConfigWrite(
    val profileId: String,
    val onSuccess: (Map<String, Any?>) -> Unit,
    val onError: (String, String) -> Unit,
)

internal data class ConfigConnectionSnapshot(
    val config: SessionConfig?,
    val phase: BoardPhase,
    val transport: BoardTransport?,
    val fwVersion: String?,
    val linkIntegrity: LinkIntegrity,
)

internal interface ConfigRWControllerPort {
    fun connection(): ConfigConnectionSnapshot
    fun isPollingActive(): Boolean
    fun stopPolling()
    fun startPolling()
    fun sendPayload(payload: ByteArray): Boolean
    fun captureDiagnostic(name: String, properties: Map<String, Any?>)
    fun diagnosticProperties(config: SessionConfig?, category: String): Map<String, Any?>
    fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray)
    /**
     * Hand the freshly decoded Board Config Values to the session controller, which holds them as the
     * session's config truth, caches them, and runs warning evaluation.
     */
    fun onBoardConfigValues(values: BoardConfigValues)
}

// @parity /modules/vescape-core/ios/config/ConfigRWController.swift
internal class ConfigRWController(
    private val scheduler: Scheduler,
    private val appDataScope: CoroutineScope,
    private val repository: () -> AppDataRepository,
    private val port: ConfigRWControllerPort,
) {
    private var state: ConfigRWState = ConfigRWState.Idle
    /**
     * Every consumer waiting on the current read. A read started in the background (post-trust config
     * acquisition) is joined by a later caller instead of rejecting it with `CONFIG_REQUEST_IN_FLIGHT`
     * — one board read serves them all.
     */
    private val readCallbacks = mutableListOf<PendingConfigRead>()
    private var writeCallbacks: PendingConfigWrite? = null
    private var timeoutHandle: Cancellable? = null

    val isInFlight: Boolean get() = state !is ConfigRWState.Idle

    /** Whether the in-flight operation is a read (joinable) rather than a write (not). */
    private val isReadInFlight: Boolean
        get() = state is ConfigRWState.ReadCollectingXml || state is ConfigRWState.ReadAwaitingConfig

    fun consumeRead(pending: PendingConfigRead) {
        if (isInFlight) {
            // Join the read already on the wire; it completes for every waiter at once. A write is
            // still exclusive.
            if (!isReadInFlight) return pending.inFlight()
            readCallbacks += pending
            return
        }
        val connection = port.connection()
        if (!connection.connected()) return pending.notConnected()
        if (!connection.trusted()) return pending.linkNotTrusted()
        val transport = connection.transport ?: return pending.noCanId("read")
        val wasPolling = port.isPollingActive()
        port.stopPolling()
        readCallbacks.clear()
        readCallbacks += pending
        dispatch(
            ConfigRWEvent.StartRead(
                newOperationId(),
                connection.canIdOrNull(),
                transport,
                wasPolling,
                connection.config?.appBoardId,
                connection.fwVersion,
                connection.config?.refloatBaseVersion,
            ),
        )
    }

    fun consumeWrite(pending: PendingConfigWrite) {
        if (isInFlight) return pending.inFlight()
        val initial = port.connection()
        if (!initial.connected()) return pending.notConnected()
        if (!initial.trusted()) return pending.linkNotTrusted()
        if (initial.transport == null) return pending.noCanId("push")
        appDataScope.launch {
            val profile = try { repository().getTuneProfile(pending.profileId) } catch (_: Exception) { null }
            if (profile == null) {
                scheduler.post {
                    pending.onError(RefloatConfigErrorCode.PROFILE_NOT_FOUND.name, "Tune profile not found: ${pending.profileId}")
                }
                return@launch
            }
            @Suppress("UNCHECKED_CAST") val fields = (profile["fields"] as? Map<String, Any>) ?: emptyMap()
            scheduler.post {
                if (isInFlight) return@post pending.inFlight()
                val connection = port.connection()
                if (!connection.connected()) return@post pending.notConnected()
                if (!connection.trusted()) return@post pending.linkNotTrusted()
                val transport = connection.transport ?: return@post pending.noCanId("push")
                val profileBoardId = profile["boardId"] as? String
                val profileRefloatBaseVersion = profile["refloatBaseVersion"] as? String
                val connectedBoardId = connection.config?.appBoardId
                if (profileBoardId.isNullOrBlank() || connectedBoardId.isNullOrBlank() || profileBoardId != connectedBoardId) {
                    return@post pending.onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.name, "Tune profile does not belong to the connected board")
                }
                val connectedRefloatBaseVersion = connection.config?.refloatBaseVersion
                if (profileRefloatBaseVersion.isNullOrBlank() || connectedRefloatBaseVersion.isNullOrBlank() || profileRefloatBaseVersion != connectedRefloatBaseVersion) {
                    return@post pending.onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.name, "Tune profile does not match the connected board Refloat Tune Compatibility")
                }
                val wasPolling = port.isPollingActive()
                port.stopPolling()
                writeCallbacks = pending
                dispatch(
                    ConfigRWEvent.StartWrite(
                        newOperationId(),
                        connection.canIdOrNull(),
                        transport,
                        wasPolling,
                        fields,
                        connectedBoardId,
                        connection.fwVersion,
                        connectedRefloatBaseVersion,
                    ),
                )
            }
        }
    }

    fun onPayload(event: ConfigRWEvent) = dispatch(event)
    fun onSessionTerminated(message: String) { if (isInFlight) dispatch(ConfigRWEvent.SessionTerminated(message)) }

    private fun dispatch(event: ConfigRWEvent) {
        val (next, effects) = ConfigRWFsm.apply(state, event)
        state = next
        effects.forEach(::interpret)
    }

    private fun interpret(effect: ConfigRWEffect) {
        when (effect) {
        is ConfigRWEffect.SendFrame -> {
            if (!port.sendPayload(effect.payload)) dispatch(ConfigRWEvent.GattWriteFailed("Board GATT is not writable"))
        }
        is ConfigRWEffect.ScheduleTimeout -> {
            timeoutHandle?.cancel()
            timeoutHandle = scheduler.postDelayed(effect.timeoutMs) { timeoutHandle = null; dispatch(ConfigRWEvent.Timeout(effect.code)) }
        }
        ConfigRWEffect.CancelTimeout -> { timeoutHandle?.cancel(); timeoutHandle = null }
        is ConfigRWEffect.EmitReadComplete -> completeRead(effect)
        is ConfigRWEffect.EmitReadFailure -> failRead(effect)
        is ConfigRWEffect.EmitWriteComplete -> completeWrite(effect)
        is ConfigRWEffect.EmitWriteFailure -> failWrite(effect)
        is ConfigRWEffect.DumpDebugBytes -> port.dumpDebugBytes(effect.xmlBytes, effect.configBytes)
        }
    }

    private fun resumePolling(resume: Boolean) {
        val connection = port.connection()
        if (resume && connection.config != null && isPollingCapable(connection.transport)) port.startPolling()
    }

    private fun completeRead(effect: ConfigRWEffect.EmitReadComplete) {
        val callbacks = readCallbacks.toList().also { readCallbacks.clear() }
        resumePolling(effect.resumePolling)
        effect.boardConfigValues?.let(port::onBoardConfigValues)
        val map = effect.snapshot.toMap()
        for (pending in callbacks) pending.onSuccess(map)
    }
    private fun failRead(effect: ConfigRWEffect.EmitReadFailure) {
        val callbacks = readCallbacks.toList().also { readCallbacks.clear() }; resumePolling(effect.resumePolling)
        val name = if (effect.code == RefloatConfigErrorCode.CONFIG_DECODE_FAILED || effect.code == RefloatConfigErrorCode.UNSUPPORTED_SCHEMA) "config_decode_failed" else "config_read_failed"
        port.captureDiagnostic(name, port.diagnosticProperties(port.connection().config, "config_read") + mapOf("operation_id" to effect.opId, "message" to effect.message, "error_code" to effect.code.name, "firmware" to port.connection().fwVersion) + DiagnosticReporter.configBlobProperties(effect.rawConfig))
        for (pending in callbacks) pending.onError(effect.code.name, effect.message)
    }
    private fun completeWrite(effect: ConfigRWEffect.EmitWriteComplete) {
        val callbacks = writeCallbacks.also { writeCallbacks = null }; resumePolling(effect.resumePolling)
        effect.boardConfigValues?.let(port::onBoardConfigValues)
        callbacks?.onSuccess?.invoke(effect.snapshot.toMap())
    }
    private fun failWrite(effect: ConfigRWEffect.EmitWriteFailure) {
        val callbacks = writeCallbacks.also { writeCallbacks = null }; resumePolling(effect.resumePolling)
        port.captureDiagnostic("profile_push_failed", port.diagnosticProperties(port.connection().config, "profile_push") + mapOf("operation_id" to effect.opId, "message" to effect.message, "error_code" to effect.code.name, "phase" to effect.phase.name, "firmware" to port.connection().fwVersion) + DiagnosticReporter.configBlobProperties(effect.rawConfig))
        callbacks?.onError?.invoke(effect.code.name, effect.message)
    }
    private fun ConfigConnectionSnapshot.canIdOrNull() = (transport as? BoardTransport.Can)?.canId

    private fun ConfigConnectionSnapshot.connected() = config != null && phase == BoardPhase.Connected
    private fun ConfigConnectionSnapshot.trusted() = linkIntegrity == LinkIntegrity.Trusted
    private fun PendingConfigRead.inFlight() = onError(RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.name, "Config operation already in flight")
    private fun PendingConfigWrite.inFlight() = onError(RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.name, "Config operation already in flight")
    private fun PendingConfigRead.notConnected() = onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name, "Board must be connected before reading Refloat config")
    private fun PendingConfigWrite.notConnected() = onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name, "Board must be connected before pushing config")
    private fun PendingConfigRead.linkNotTrusted() = onError(RefloatConfigErrorCode.LINK_NOT_TRUSTED.name, "Trusted board link required before reading Refloat config")
    private fun PendingConfigWrite.linkNotTrusted() = onError(RefloatConfigErrorCode.LINK_NOT_TRUSTED.name, "Trusted board link required before pushing config")
    private fun PendingConfigRead.noCanId(operation: String) = onError(RefloatConfigErrorCode.CAN_ID_UNAVAILABLE.name, "Cannot $operation Refloat config before CAN id discovery")
    private fun PendingConfigWrite.noCanId(operation: String) = onError(RefloatConfigErrorCode.CAN_ID_UNAVAILABLE.name, "Cannot $operation config before CAN id discovery")
}
