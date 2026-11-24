package expo.modules.vescapecore.config

import expo.modules.vescapecore.recording.RecordingStorageFailure

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.connection.isPollingCapable
import expo.modules.vescapecore.diagnostics.newOperationId
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.telemetry.tuneCompatibilityVersion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal data class PendingConfigRead(
    val onSuccess: (Map<String, Any?>) -> Unit,
    val onError: (String, String) -> Unit,
)

internal sealed class PendingConfigWrite {
    abstract val onSuccess: (Map<String, Any?>) -> Unit
    abstract val onError: (String, String) -> Unit

    data class Profile(
        val profileId: String,
        override val onSuccess: (Map<String, Any?>) -> Unit,
        override val onError: (String, String) -> Unit,
    ) : PendingConfigWrite()

    data class Changeset(
        val boardId: String,
        val changes: Map<String, Any?>,
        override val onSuccess: (Map<String, Any?>) -> Unit,
        override val onError: (String, String) -> Unit,
    ) : PendingConfigWrite()
}

internal data class ConfigConnectionSnapshot(
    val config: SessionConfig?,
    val phase: BoardPhase,
    val transport: BoardTransport?,
    val fwVersion: String?,
    val linkIntegrity: LinkIntegrity,
    val boardConfigValues: BoardConfigValues? = null,
    val rideState: BoardRideState? = null,
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
    fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin)
    fun demoteWriteBase()
}

// @parity /modules/vescape-core/ios/config/ConfigRWController.swift
internal class ConfigRWController(
    private val scheduler: Scheduler,
    private val appDataScope: CoroutineScope,
    private val loadProfile: suspend (String) -> Map<String, Any?>?,
    private val port: ConfigRWControllerPort,
) {
    private var state: ConfigRWState = ConfigRWState.Idle
    private val readCallbacks = mutableListOf<PendingConfigRead>()
    private var writeCallbacks: PendingConfigWrite? = null
    private var writeStartedAtMs = 0L
    private var timeoutHandle: Cancellable? = null

    val isInFlight: Boolean get() = state !is ConfigRWState.Idle

    private val isReadInFlight: Boolean
        get() = state is ConfigRWState.ReadCollectingXml || state is ConfigRWState.ReadAwaitingConfig

    fun consumeRead(pending: PendingConfigRead) {
        if (isInFlight) {
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
        val initialTransport = initial.transport ?: return pending.noCanId("push")
        val initialStartedAtMs = System.currentTimeMillis()
        idleBlockReason(initial, initialStartedAtMs)?.let { return pending.notIdle(it) }
        when (pending) {
            is PendingConfigWrite.Changeset -> {
                val connectedBoardId = initial.config?.appBoardId
                if (connectedBoardId.isNullOrBlank() || connectedBoardId != pending.boardId) {
                    return pending.onError(
                        RefloatConfigErrorCode.BOARD_NOT_CONNECTED.name,
                        "Requested board is not the connected board",
                    )
                }
                startWriteOperation(
                    pending = pending,
                    connection = initial,
                    transport = initialTransport,
                    intent = ConfigWriteIntent.Changeset(pending.changes),
                    connectedBoardId = connectedBoardId,
                    startedAtMs = initialStartedAtMs,
                )
            }
            is PendingConfigWrite.Profile -> consumeProfileWrite(pending)
        }
    }

    private fun consumeProfileWrite(pending: PendingConfigWrite.Profile) {
        appDataScope.launch {
            val profile = try { loadProfile(pending.profileId) } catch (error: Exception) {
                RecordingStorageFailure.reportRead("board_tune_profile_read", error)
                scheduler.post { pending.onError(RefloatConfigErrorCode.CONFIG_READ_FAILED.name, "Tune profile could not be loaded") }
                return@launch
            }
            if (profile == null) {
                scheduler.post {
                    pending.onError(RefloatConfigErrorCode.PROFILE_NOT_FOUND.name, "Tune profile not found: ${pending.profileId}")
                }
                return@launch
            }
            @Suppress("UNCHECKED_CAST") val storedFields = (profile["fields"] as? Map<String, Any?>) ?: emptyMap()
            scheduler.post {
                if (isInFlight) return@post pending.inFlight()
                val connection = port.connection()
                if (!connection.connected()) return@post pending.notConnected()
                if (!connection.trusted()) return@post pending.linkNotTrusted()
                val transport = connection.transport ?: return@post pending.noCanId("push")
                val profileBoardId = profile["boardId"] as? String
                val profileRefloatBaseVersion = tuneCompatibilityVersion(profile["refloatBaseVersion"] as? String)
                val connectedBoardId = connection.config?.appBoardId
                if (profileBoardId.isNullOrBlank() || connectedBoardId.isNullOrBlank() || profileBoardId != connectedBoardId) {
                    return@post pending.onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.name, "Tune profile does not belong to the connected board")
                }
                val connectedRefloatBaseVersion = connection.config?.refloatBaseVersion
                if (profileRefloatBaseVersion.isNullOrBlank() || connectedRefloatBaseVersion.isNullOrBlank() || profileRefloatBaseVersion != tuneCompatibilityVersion(connectedRefloatBaseVersion)) {
                    return@post pending.onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.name, "Tune profile does not match the connected board Refloat Tune Compatibility")
                }
                val startedAtMs = System.currentTimeMillis()
                idleBlockReason(connection, startedAtMs)?.let { return@post pending.notIdle(it) }
                startWriteOperation(
                    pending = pending,
                    connection = connection,
                    transport = transport,
                    intent = ConfigWriteIntent.Profile(storedFields),
                    connectedBoardId = connectedBoardId,
                    startedAtMs = startedAtMs,
                )
            }
        }
    }

    private fun startWriteOperation(
        pending: PendingConfigWrite,
        connection: ConfigConnectionSnapshot,
        transport: BoardTransport,
        intent: ConfigWriteIntent,
        connectedBoardId: String,
        startedAtMs: Long,
    ) {
        val wasPolling = port.isPollingActive()
        port.stopPolling()
        writeStartedAtMs = startedAtMs
        writeCallbacks = pending
        dispatch(
            ConfigRWEvent.StartWrite(
                opId = newOperationId(),
                canId = connection.canIdOrNull(),
                transport = transport,
                wasPolling = wasPolling,
                intent = intent,
                appBoardId = connectedBoardId,
                fwVersion = connection.fwVersion,
                refloatBaseVersion = connection.config?.refloatBaseVersion,
                refloatVersion = connection.config?.refloatVersion,
                writeBase = connection.boardConfigValues?.writeBase,
                startedAtMs = startedAtMs,
            ),
        )
    }

    fun onPayload(payload: ByteArray, capturedAtMs: Long = System.currentTimeMillis()): Boolean {
        val transport = ConfigRWFsm.transportOf(state) ?: return false
        if (!RefloatConfigProtocol.matchesTransport(payload, transport)) return false
        val cmd = payloadCommand(payload) ?: return false
        return when (cmd) {
            COMM_CUSTOM_APP_DATA -> {
                if (RefloatConfigProtocol.parseGetInfoResponse(payload, transport) is RefloatConfigProtocolResult.Success) {
                    dispatch(ConfigRWEvent.InfoPayloadReceived(payload))
                    true
                } else {
                    false
                }
            }
            COMM_GET_CUSTOM_CONFIG_XML -> {
                dispatch(ConfigRWEvent.XmlPayloadReceived(payload))
                true
            }
            COMM_GET_CUSTOM_CONFIG -> {
                dispatch(ConfigRWEvent.ConfigBytesPayloadReceived(payload, capturedAtMs))
                true
            }
            COMM_SET_CUSTOM_CONFIG -> {
                dispatch(ConfigRWEvent.SetConfigResponseReceived(payload))
                true
            }
            else -> false
        }
    }

    fun onSessionTerminated(message: String) { if (isInFlight) dispatch(ConfigRWEvent.SessionTerminated(message)) }

    private fun payloadCommand(payload: ByteArray): Int? {
        if (payload.isEmpty()) return null
        val first = payload[0].toInt() and 0xff
        if (first == COMM_FORWARD_CAN && payload.size >= 3) return payload[2].toInt() and 0xff
        return first
    }

    private fun dispatch(event: ConfigRWEvent) {
        val (next, effects) = ConfigRWFsm.apply(state, event)
        state = next
        for (effect in effects) if (!interpret(effect)) return
    }

    private fun interpret(effect: ConfigRWEffect): Boolean {
        when (effect) {
        is ConfigRWEffect.SendFrame -> {
            if (effect.requiresIdleBoard) {
                idleBlockReason(port.connection(), writeStartedAtMs)?.let {
                    dispatch(ConfigRWEvent.SetConfigBlocked(it))
                    return false
                }
            }
            if (!port.sendPayload(effect.payload)) {
                dispatch(ConfigRWEvent.GattWriteFailed("Board GATT is not writable"))
                return false
            }
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
        ConfigRWEffect.DemoteWriteBase -> port.demoteWriteBase()
        }
        return true
    }

    private fun resumePolling(resume: Boolean) {
        val connection = port.connection()
        if (resume && connection.config != null && isPollingCapable(connection.transport)) port.startPolling()
    }

    private fun completeRead(effect: ConfigRWEffect.EmitReadComplete) {
        val callbacks = readCallbacks.toList().also { readCallbacks.clear() }
        resumePolling(effect.resumePolling)
        effect.boardConfigValues?.let { port.onBoardConfigValues(it, BoardConfigOperationOrigin.FRESH_READ) }
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
        effect.boardConfigValues?.let { port.onBoardConfigValues(it, effect.origin) }
        callbacks?.onSuccess?.invoke(effect.snapshot.toMap())
    }
    private fun failWrite(effect: ConfigRWEffect.EmitWriteFailure) {
        val callbacks = writeCallbacks.also { writeCallbacks = null }; resumePolling(effect.resumePolling)
        val baseProperties = port.diagnosticProperties(port.connection().config, "profile_push") + mapOf(
            "operation_id" to effect.opId,
            "message" to effect.message,
            "error_code" to effect.code.name,
            "phase" to effect.phase.name,
            "firmware" to port.connection().fwVersion,
        )
        if (effect.demotedWriteBase) {
            port.captureDiagnostic("board_config_write_base_demoted", baseProperties)
        }
        port.captureDiagnostic("profile_push_failed", baseProperties + DiagnosticReporter.configBlobProperties(effect.rawConfig))
        callbacks?.onError?.invoke(effect.code.name, effect.message)
    }
    private fun idleBlockReason(connection: ConfigConnectionSnapshot, referenceMs: Long) =
        BoardIdleGate.blockReason(connection.rideState, BoardIdleGate.freshSinceMs(referenceMs))
    private fun PendingConfigWrite.notIdle(reason: String) = onError(RefloatConfigErrorCode.BOARD_NOT_IDLE.name, reason)
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

internal enum class BoardConfigOperationOrigin { FRESH_READ, VESCAPE_WRITE }
