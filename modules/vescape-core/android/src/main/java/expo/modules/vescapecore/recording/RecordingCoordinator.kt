package expo.modules.vescapecore.recording

import expo.modules.vescapecore.protocol.LocationSnapshot
import android.content.Context
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.sync.SyncCoordinator
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.AppSettings
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryRepository

// @parity /modules/vescape-core/ios/recording/RecordingCoordinator.swift
internal class RecordingCoordinator(
    private val context: Context,
    private val applyLiveSettings: (AppSettings) -> Unit,
) {
    private var recorder: SessionRecorder? = null
    private var telemetryStore: TelemetryRepository? = null
    private var connectionLostMarkerAt: Long? = null

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

    fun beginBoardSession(config: SessionConfig) {
        connectionLostMarkerAt = null
        recorder = if (config.recordingEnabled) {
            SessionRecorder(context, config).also { it.start() }
        } else {
            null
        }
        telemetryStore = if (config.telemetryRecordingEnabled || requestedTelemetryRecordingEnabled) {
            configuredTelemetryStore()
        } else {
            null
        }
    }

    fun markBoardReady(config: SessionConfig) {
        connectionLostMarkerAt = null
        val autoRecording = try {
            kotlinx.coroutines.runBlocking {
                AppDataRepository.get(context).getTypedSettings().autoRecording
            }
        } catch (_: Exception) {
            false
        }
        if (autoRecording && telemetryStore == null) {
            telemetryStore = configuredTelemetryStore()
        }
        recordMarker("connected", config)
    }

    fun finishBoardSession(status: String, markerType: String, config: SessionConfig?) {
        finishRecording(status)
        recordMarker(markerType, config)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
    }

    fun failSession(status: String = "error") {
        finishRecording(status)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
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

    /** Marks where a Ride Recording entered an Idle Pause so the resulting gap is explained (ADR-0021). */
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
        if (telemetryStore == null) {
            telemetryStore = configuredTelemetryStore()
            recordMarker("connected", config)
        }
    }

    fun disableTelemetryRecording(config: SessionConfig?) {
        recordMarker("app_stop", config, "Recording stopped")
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

    /**
     * The three ways recording stops — the session finishing, failing, or the Rider switching it
     * off. The flush has to land before the kick, or the uploader scans a ride missing its tail.
     *
     * @parity /modules/vescape-core/ios/recording/RecordingCoordinator.swift `flushTelemetryBlocking`
     */
    private fun flushTelemetryBlocking() {
        telemetryStore?.flushBlocking()
        SyncCoordinator.get(context).notifyRecordingStopped()
    }

    private fun configuredTelemetryStore(): TelemetryRepository {
        val store = TelemetryRepository.get(context)
        val settings = try {
            kotlinx.coroutines.runBlocking {
                AppDataRepository.get(context).getTypedSettings()
            }
        } catch (_: Exception) {
            null
        }
        val resolvedSettings = settings ?: AppSettings()
        applyLiveSettings(resolvedSettings)
        store.applySettings(resolvedSettings)
        val zones = try {
            kotlinx.coroutines.runBlocking {
                AppDataRepository.get(context).getEnabledPrivacyZoneEntities()
            }
        } catch (_: Exception) {
            emptyList()
        }
        store.reloadPrivacyZones(zones)
        return store
    }

    private fun recordMarker(type: String, config: SessionConfig?, message: String? = null) {
        telemetryStore?.recordMarker(
            type,
            config?.appBoardId,
            message,
        )
    }
}
