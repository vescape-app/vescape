package expo.modules.vescapecore.recording

import expo.modules.vescapecore.protocol.LocationSnapshot
import android.content.Context
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.AppSettings
import expo.modules.vescapecore.telemetry.RECORDING_STOP_MARKER
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryLocationCapture
import expo.modules.vescapecore.telemetry.TelemetryRepository

// @parity /modules/vescape-core/ios/recording/RecordingCoordinator.swift
internal class RecordingCoordinator(
    private val context: Context,
    private val applyLiveSettings: (AppSettings) -> Unit,
    private val onRecordingFailure: () -> Unit,
) {
    private var recorder: SessionRecorder? = null
    private var telemetryStore: TelemetryRepository? = null
    private var connectionLostMarkerAt: Long? = null

    /** Board the armed store records; GPS Fixes carry it because a fix has no Board of its own. */
    private var recordingBoardId: String? = null

    /**
     * The rider stopped recording during this Board Session. Survives reconnects so a re-ready board
     * cannot auto-restart what they explicitly stopped; cleared when a new Board Session begins.
     */
    private var explicitlyStopped = false

    /**
     * Auto-recording is a *connect* rule, not a re-ready rule: it fires at the first board-ready of
     * a Board Session and stays quiet for every reconnect's board-ready after it.
     */
    private var boardReadySeen = false

    val telemetryRecordingEnabled: Boolean
        get() = telemetryStore != null

    companion object {
        @Volatile
        private var requestedTelemetryRecordingEnabled = false

        fun requestTelemetryRecording(enabled: Boolean) {
            requestedTelemetryRecordingEnabled = enabled
        }
    }

    fun currentRecorder(): SessionRecorder? = recorder

    /**
     * Begin a Board Session's recording side. Ride boundaries are derived from the recorded data
     * (ADR 0041), so a connect never opens or closes a ride: it only decides whether capture is
     * armed.
     */
    fun beginBoardSession(config: SessionConfig) {
        connectionLostMarkerAt = null
        // Tapping Connect to the same Board during a reconnect loop keeps capture armed, so no fix is
        // dropped between this connect and the board-ready that would otherwise enable it (#450).
        val wasRecording = telemetryStore != null && recordingBoardId == config.appBoardId
        // A new Board Session spends the rider's previous stop: the gate exists to stop a *reconnect*
        // from restarting what they stopped, not to keep the next ride from recording.
        explicitlyStopped = false
        boardReadySeen = false
        recorder = if (config.recordingEnabled) try {
            SessionRecorder(context, config).also { it.start() }
        } catch (error: Exception) {
            expo.modules.vescapecore.diagnostics.UnexpectedNativeError.report(
                "debug_recording_open", "file_open_failed", error,
            )
            null
        } else null
        telemetryStore = if (
            RecordingStorageFailure.value() == null &&
            (config.telemetryRecordingEnabled || requestedTelemetryRecordingEnabled || wasRecording)
        ) {
            configuredTelemetryStore(config)
        } else {
            null
        }
    }

    /**
     * Board-ready for the current Board Session — the first one after a connect, and again after
     * every reconnect that gets telemetry flowing.
     *
     * Auto-recording only fires on the first: a reconnect that re-readied the board must not start a
     * recording the rider stopped (#450). The `connected` marker still lands on every ready, as
     * disconnect evidence inside a continuing ride.
     */
    fun markBoardReady(config: SessionConfig) {
        connectionLostMarkerAt = null
        val firstReady = !boardReadySeen
        val autoRecording = try {
            kotlinx.coroutines.runBlocking {
                AppDataRepository.get(context).getTypedSettings().autoRecording
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            RecordingStorageFailure.reportRead("auto_recording_settings_read", e)
            return
        }
        boardReadySeen = true
        if (autoRecording && telemetryStore == null && firstReady && !explicitlyStopped && RecordingStorageFailure.value() == null) {
            telemetryStore = configuredTelemetryStore(config)
        }
        recordMarker("connected", config)
    }

    fun finishBoardSession(status: String, markerType: String, config: SessionConfig?) {
        finishRecording(status)
        recordMarker(markerType, config)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
        boardReadySeen = false
    }

    fun failSession(status: String = "error") {
        finishRecording(status)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
        boardReadySeen = false
    }

    fun finishDebugRecording(status: String) {
        finishRecording(status)
    }

    fun recordState(status: String, extra: Map<String, Any?> = emptyMap()) {
        recorder?.recordState(status, extra)
    }

    fun recordChunk(direction: String, bytes: ByteArray) {
        recorder?.recordChunk(direction, bytes)
    }

    fun recordLocation(snapshot: LocationSnapshot) {
        recorder?.recordLocation(snapshot)
    }

    fun recordTelemetry(capture: TelemetryCapture) {
        telemetryStore?.recordTelemetry(capture)
    }

    /**
     * Offer one GPS Fix to the Ride Track. Independent of telemetry arrival: while recording is
     * armed and unpaused, fixes keep landing straight through a board dropout (ADR 0038).
     */
    fun recordGpsFix(location: TelemetryLocationCapture) {
        telemetryStore?.recordGpsFix(location, recordingBoardId)
    }

    /** Marks where recording entered an Idle Pause so the resulting gap is explained (ADR-0021). */
    fun recordIdlePauseMarker(config: SessionConfig?) {
        recordMarker("auto_pause", config, "Recording paused — idle")
    }

    fun recordError(config: SessionConfig?, message: String) {
        recordState("error", mapOf("message" to message))
        recordMarker("error", config, message)
    }

    fun recordConnectionLost(config: SessionConfig, markerAt: Long, reason: String) {
        val store = telemetryStore ?: return
        if (markerAt <= 0L) return
        if (connectionLostMarkerAt == markerAt) return
        connectionLostMarkerAt = markerAt
        store.recordMarker(
            type = "connection_lost",
            boardId = config.appBoardId,
            message = reason,
            occurredAtMs = markerAt,
        )
    }

    fun enableTelemetryRecording(config: SessionConfig) {
        if (RecordingStorageFailure.value() != null) return
        explicitlyStopped = false
        if (telemetryStore == null) {
            telemetryStore = configuredTelemetryStore(config)
            recordMarker("connected", config)
        }
    }

    fun disableTelemetryRecording(config: SessionConfig?) {
        // Explicit Stop Recording: the only marker that splits a ride (ADR 0041).
        explicitlyStopped = true
        recordMarker(RECORDING_STOP_MARKER, config, "Recording stopped")
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
    }

    fun applySettings(settings: AppSettings) {
        telemetryStore?.applySettings(settings)
    }

    private fun finishRecording(status: String) {
        recorder?.finish(status = status)
        recorder = null
    }

    private fun flushTelemetryBlocking() {
        telemetryStore?.flushBlocking()
    }

    private fun configuredTelemetryStore(config: SessionConfig?): TelemetryRepository? {
        val store = TelemetryRepository.get(context)
        store.observeRecordingFailure {
            onRecordingFailure()
        }
        val settings = try {
            kotlinx.coroutines.runBlocking {
                AppDataRepository.get(context).getTypedSettings()
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            RecordingStorageFailure.reportRead("recording_settings_read", e)
            return null
        }
        applyLiveSettings(settings)
        store.applySettings(settings)
        val zones = try {
            kotlinx.coroutines.runBlocking {
                AppDataRepository.get(context).getEnabledPrivacyZoneEntities()
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            RecordingStorageFailure.reportRead("recording_privacy_zones_read", e)
            return null
        }
        store.reloadPrivacyZones(zones)
        recordingBoardId = config?.appBoardId
        return store
    }

    /** Runs on Board Session owner scheduler after repository IO reports a failed transaction. */
    fun handleStorageFailure() {
        telemetryStore = null
        requestedTelemetryRecordingEnabled = false
        connectionLostMarkerAt = null
    }

    private fun recordMarker(type: String, config: SessionConfig?, message: String? = null) {
        telemetryStore?.recordMarker(
            type,
            config?.appBoardId,
            message,
        )
    }
}
