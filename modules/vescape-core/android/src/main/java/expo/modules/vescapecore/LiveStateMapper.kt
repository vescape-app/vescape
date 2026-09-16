package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.service.SessionConfig

import expo.modules.vescapecore.location.GpsPhase
import expo.modules.vescapecore.location.GpsPowerMode
import expo.modules.vescapecore.protocol.LocationSnapshot

import expo.modules.vescapecore.telemetry.AppSettings
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.recording.RecordingStorageFailureKind
import expo.modules.vescapecore.recording.recordingFailureState

internal data class VescLiveStateSnapshot(
    val boardPhase: BoardPhase,
    val boardConfig: SessionConfig?,
    val boardError: String?,
    val connectionSeq: Long,
    val lastTelemetryAt: Long?,
    val recentTelemetry: List<Map<String, Any?>>,
    val gpsPhase: GpsPhase,
    val gpsMode: GpsPowerMode,
    val latestLocation: LocationSnapshot?,
    val latestPreciseLocation: LocationSnapshot?,
    val recentLocations: List<Map<String, Any?>>,
    val gpsError: String?,
    val recordingEnabled: Boolean,
    val recordingPaused: Boolean,
    val remoteTiltValue: Int,
    val remoteTiltPhase: RemoteTiltPhase,
    val remoteTiltDecay: RemoteTiltDecayProgress?,
    val remoteTiltOwner: RemoteInputOwner,
    val linkIntegrity: LinkIntegrity,
    val settings: AppSettings,
)

/**
 * Exact native remote-tilt command. Raw values avoid asymmetric percent rounding.
 */
internal fun remoteTiltWire(
    value: Int,
    phase: RemoteTiltPhase,
    decay: RemoteTiltDecayProgress?,
    owner: RemoteInputOwner,
): Map<String, Any?>? {
    if (phase == RemoteTiltPhase.Idle) return null
    return buildMap {
        put("value", value)
        put("phase", phase.wireValue)
        // Who asked for this tilt. The pad renders the same stream either way, but "the board is
        // holding a tilt you did not command" and "the board is holding yours" are not the same
        // sentence to read while standing on it.
        put("owner", owner.wire)
        if (decay != null) {
            put("decay", mapOf("elapsedMs" to decay.elapsedMs, "totalMs" to decay.totalMs))
        }
    }
}

internal fun buildLiveState(snapshot: VescLiveStateSnapshot): Map<String, Any?> =
    mapOf(
        "board" to mapOf(
            "phase" to snapshot.boardPhase.wireValue,
            "selectedBoardId" to snapshot.settings.selectedBoardId,
            "connectedBoardId" to snapshot.boardConfig?.appBoardId,
            "bleId" to snapshot.boardConfig?.deviceId,
            "name" to snapshot.boardConfig?.deviceName,
            "connectionSeq" to snapshot.connectionSeq,
            "lastTelemetryAt" to snapshot.lastTelemetryAt,
            "recentTelemetry" to snapshot.recentTelemetry,
            "error" to snapshot.boardError,
            "autoConnect" to snapshot.settings.autoConnect,
            "linkIntegrity" to snapshot.linkIntegrity.wireValue,
            "remoteTilt" to remoteTiltWire(
                snapshot.remoteTiltValue,
                snapshot.remoteTiltPhase,
                snapshot.remoteTiltDecay,
                snapshot.remoteTiltOwner,
            ),
        ),
        "gps" to mapOf(
            "phase" to snapshot.gpsPhase.wireValue,
            "mode" to snapshot.gpsMode.slug,
            "latestFix" to snapshot.latestPreciseLocation?.toMap(),
            "latestApproximateFix" to snapshot.latestLocation?.toMap(),
            "latestPreciseFix" to snapshot.latestPreciseLocation?.toMap(),
            "recentLocations" to snapshot.recentLocations,
            "error" to snapshot.gpsError,
        ),
        "scan" to mapOf(
            "phase" to "idle",
            "devices" to emptyList<Map<String, Any?>>(),
            "error" to null,
        ),
        "recording" to mapOf(
            "enabled" to snapshot.recordingEnabled,
            "paused" to snapshot.recordingPaused,
            "activeBoardId" to if (snapshot.recordingEnabled) snapshot.boardConfig?.appBoardId else null,
            "startedAt" to null,
            "failure" to RecordingStorageFailure.value()?.let(::recordingFailureState),
        ),
    )

internal fun liveStateWithStorageFailure(
    state: Map<String, Any?>,
    kind: RecordingStorageFailureKind,
): Map<String, Any?> {
    val recording = (state["recording"] as? Map<*, *>)?.entries
        ?.associate { it.key.toString() to it.value }.orEmpty()
    return state + ("recording" to (recording + ("failure" to recordingFailureState(kind))))
}
