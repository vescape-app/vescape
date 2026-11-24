package expo.modules.vescapecore.config

import androidx.annotation.MainThread
import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.connection.isPollingCapable
import expo.modules.vescapecore.diagnostics.DiagnosticReporter
import expo.modules.vescapecore.diagnostics.newOperationId
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.service.SessionConfig
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
        val source: BoardConfigRevisionSource = BoardConfigRevisionSource.APP,
        val expectedSchemaHash: String? = null,
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
    fun sendPayload(payload: ByteArray, tag: String?): Boolean = sendPayload(payload)
    fun cancelQueuedPayloads(tag: String) {}
    fun captureDiagnostic(name: String, properties: Map<String, Any?>)
    fun diagnosticProperties(config: SessionConfig?, category: String): Map<String, Any?>
    fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray)
    fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin)
    fun onBoardConfigValues(
        values: BoardConfigValues,
        origin: BoardConfigOperationOrigin,
        onPersisted: () -> Unit,
    ) {
        onBoardConfigValues(values, origin)
        onPersisted()
    }
    fun demoteWriteBase()
}

// @parity /modules/vescape-core/ios/config/ConfigRWController.swift
internal class ConfigRWController(
    private val scheduler: Scheduler,
    private val appDataScope: CoroutineScope,
    private val loadProfile: suspend (String) -> Map<String, Any?>?,
    private val port: ConfigRWControllerPort,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private var state: ConfigRWState = ConfigRWState.Idle
    private val readCallbacks = mutableListOf<PendingConfigRead>()
    private var writeCallbacks: PendingConfigWrite? = null
    private var activeSetFrameTag: String? = null
    private var timeoutHandle: Cancellable? = null

    val isInFlight: Boolean get() = state !is ConfigRWState.Idle

    val isWriteInFlight: Boolean
        get() = state is ConfigRWState.WriteCollectingXml ||
            state is ConfigRWState.WriteAwaitingConfig ||
            state is ConfigRWState.WriteAwaitingIdle ||
            state is ConfigRWState.WriteAwaitingSetAck ||
            state is ConfigRWState.WriteVerifying

    private val isReadInFlight: Boolean
        get() = state is ConfigRWState.ReadCollectingXml || state is ConfigRWState.ReadAwaitingConfig

    @MainThread
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

    @MainThread
    fun consumeWrite(pending: PendingConfigWrite) {
        if (isInFlight) return pending.inFlight()
        val initial = port.connection()
        if (!initial.connected()) return pending.notConnected()
        if (!initial.trusted()) return pending.linkNotTrusted()
        val initialTransport = initial.transport ?: return pending.noCanId("push")
        val initialStartedAtMs = nowMs()
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
                    intent = ConfigWriteIntent.Changeset(pending.changes, pending.source, pending.expectedSchemaHash),
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
                val startedAtMs = nowMs()
                idleBlockReason(connection, startedAtMs)?.let { return@post pending.notIdle(it) }
                startWriteOperation(
                    pending = pending,
                    connection = connection,
                    transport = transport,
                    intent = ConfigWriteIntent.Profile(pending.profileId, storedFields),
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

    @MainThread
    fun onPayload(payload: ByteArray, capturedAtMs: Long = nowMs()): Boolean {
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

    @MainThread
    fun onRideState(rideState: BoardRideState) {
        if (state is ConfigRWState.WriteAwaitingIdle) {
            dispatch(ConfigRWEvent.RideStateReceived(rideState, nowMs()))
        }
    }

    @MainThread
    fun onSessionTerminated(message: String) {
        cancelQueuedSetFrames()
        if (isInFlight) dispatch(ConfigRWEvent.SessionTerminated(message))
    }

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
                    val connection = port.connection()
                    if (!connection.connected()) {
                        dispatch(
                            ConfigRWEvent.SetConfigBlocked(
                                "Board must be connected before pushing config",
                                RefloatConfigErrorCode.BOARD_NOT_CONNECTED,
                            ),
                        )
                        return false
                    }
                    if (!connection.trusted()) {
                        dispatch(
                            ConfigRWEvent.SetConfigBlocked(
                                "Trusted board link required before pushing config",
                                RefloatConfigErrorCode.LINK_NOT_TRUSTED,
                            ),
                        )
                        return false
                    }
                    idleBlockReason(connection, nowMs(), effect.minRideStateAtMs)?.let {
                        dispatch(ConfigRWEvent.SetConfigBlocked(it, RefloatConfigErrorCode.BOARD_NOT_IDLE))
                        return false
                    }
                }
                if (effect.frameTag != null) activeSetFrameTag = effect.frameTag
                if (!port.sendPayload(effect.payload, effect.frameTag)) {
                    dispatch(ConfigRWEvent.GattWriteFailed("Board GATT is not writable"))
                    return false
                }
            }
            is ConfigRWEffect.ScheduleTimeout -> {
                timeoutHandle?.cancel()
                timeoutHandle = scheduler.postDelayed(effect.timeoutMs) { timeoutHandle = null; dispatch(ConfigRWEvent.Timeout(effect.code)) }
            }
            ConfigRWEffect.CancelTimeout -> { timeoutHandle?.cancel(); timeoutHandle = null }
            is ConfigRWEffect.EmitBoardConfigValues -> port.onBoardConfigValues(effect.boardConfigValues, effect.origin)
            is ConfigRWEffect.EmitReadComplete -> completeRead(effect)
            is ConfigRWEffect.EmitReadFailure -> failRead(effect)
            is ConfigRWEffect.EmitWriteComplete -> completeWrite(effect)
            is ConfigRWEffect.EmitWriteFailure -> failWrite(effect)
            is ConfigRWEffect.DumpDebugBytes -> port.dumpDebugBytes(effect.xmlBytes, effect.configBytes)
            ConfigRWEffect.DemoteWriteBase -> port.demoteWriteBase()
        }
        return true
    }

    private fun cancelQueuedSetFrames() {
        val tag = activeSetFrameTag ?: return
        activeSetFrameTag = null
        port.cancelQueuedPayloads(tag)
    }

    private fun resumePolling(resume: Boolean) {
        val connection = port.connection()
        if (resume && connection.config != null && isPollingCapable(connection.transport)) port.startPolling()
    }

    private fun completeRead(effect: ConfigRWEffect.EmitReadComplete) {
        val callbacks = readCallbacks.toList().also { readCallbacks.clear() }
        resumePolling(effect.resumePolling)
        port.onBoardConfigValues(effect.boardConfigValues, BoardConfigOperationOrigin.FreshRead)
        val map = effect.boardConfigValues.toBridgeMap()
        for (pending in callbacks) pending.onSuccess(map)
    }

    private fun failRead(effect: ConfigRWEffect.EmitReadFailure) {
        val callbacks = readCallbacks.toList().also { readCallbacks.clear() }; resumePolling(effect.resumePolling)
        val name = if (effect.code == RefloatConfigErrorCode.CONFIG_DECODE_FAILED || effect.code == RefloatConfigErrorCode.UNSUPPORTED_SCHEMA) "config_decode_failed" else "config_read_failed"
        port.captureDiagnostic(name, port.diagnosticProperties(port.connection().config, "config_read") + mapOf("operation_id" to effect.opId, "message" to effect.message, "error_code" to effect.code.name, "firmware" to port.connection().fwVersion) + DiagnosticReporter.configBlobProperties(effect.rawConfig))
        for (pending in callbacks) pending.onError(effect.code.name, effect.message)
    }

    private fun completeWrite(effect: ConfigRWEffect.EmitWriteComplete) {
        cancelQueuedSetFrames()
        val callbacks = writeCallbacks.also { writeCallbacks = null }; resumePolling(effect.resumePolling)
        val map = effect.boardConfigValues.toBridgeMap()
        if (effect.emitBoardConfigValues && effect.origin is BoardConfigOperationOrigin.VescapeWrite) {
            port.onBoardConfigValues(effect.boardConfigValues, effect.origin) {
                callbacks?.onSuccess?.invoke(map)
            }
            return
        }
        if (effect.emitBoardConfigValues) {
            port.onBoardConfigValues(effect.boardConfigValues, effect.origin)
        }
        callbacks?.onSuccess?.invoke(map)
    }

    private fun failWrite(effect: ConfigRWEffect.EmitWriteFailure) {
        cancelQueuedSetFrames()
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

    private fun idleBlockReason(
        connection: ConfigConnectionSnapshot,
        referenceMs: Long,
        minRideStateAtMs: Long? = null,
    ): String? {
        val freshSinceMs = maxOf(minRideStateAtMs ?: Long.MIN_VALUE, BoardIdleGate.freshSinceMs(referenceMs))
        return BoardIdleGate.blockReason(connection.rideState, freshSinceMs)
    }

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

/**
 * @parity /modules/vescape-core/ios/config/ConfigRWController.swift `BoardConfigOperationOrigin`
 */
internal sealed class BoardConfigOperationOrigin {
    data object FreshRead : BoardConfigOperationOrigin()

    data class VescapeWrite(
        val source: BoardConfigRevisionSource = BoardConfigRevisionSource.APP,
        val tuneProfileId: String? = null,
    ) : BoardConfigOperationOrigin()
}
