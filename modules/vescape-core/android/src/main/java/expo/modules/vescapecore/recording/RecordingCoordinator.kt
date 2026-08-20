package expo.modules.vescapecore.recording

import expo.modules.vescapecore.protocol.LocationSnapshot
import android.content.Context
import expo.modules.vescapecore.notification.RideSummaryNotifier
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.AppSettings
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryRepository
import kotlinx.coroutines.launch

// @parity /modules/vescape-core/ios/recording/RecordingCoordinator.swift
internal class RecordingCoordinator(
    private val context: Context,
    private val applyLiveSettings: (AppSettings) -> Unit,
) {
    private var recorder: SessionRecorder? = null
    private var telemetryStore: TelemetryRepository? = null
    private var connectionLostMarkerAt: Long? = null
    /** Last Board Session config seen, so a finalize with no config still knows whose ride it was. */
    private var lastConfig: SessionConfig? = null

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
        lastConfig = config
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
        lastConfig = config
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
        val recording = telemetryRecordingEnabled
        finishRecording(status)
        recordMarker(markerType, config)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
        if (recording) sendRideSummary(config)
    }

    fun failSession(status: String = "error") {
        val recording = telemetryRecordingEnabled
        finishRecording(status)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
        if (recording) sendRideSummary(null)
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
            deviceId = config.deviceId,
            deviceName = config.deviceName,
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
        val recording = telemetryRecordingEnabled
        recordMarker("app_stop", config, "Recording stopped")
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
        if (recording) sendRideSummary(config)
    }

    fun applySettings(settings: AppSettings) {
        telemetryStore?.applySettings(settings)
    }

    /**
     * Ride Recording finalized (#410). Fire-and-forget: [RideSummaryNotifier] owns eligibility, the
     * rider setting, notification permission, and the durable per-ride dedup claim, so calling this
     * more than once for the same ride is safe by construction.
     */
    private fun sendRideSummary(config: SessionConfig?) {
        val boardId = (config ?: lastConfig)?.appBoardId
        val now = System.currentTimeMillis()
        CoreForegroundService.appDataScope.launch {
            RideSummaryNotifier.onRecordingFinalized(context, boardId, now)
        }
    }

    private fun finishRecording(status: String) {
        recorder?.finish(status = status)
        recorder = null
    }

    private fun flushTelemetryBlocking() {
        telemetryStore?.flushBlocking()
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
            config?.deviceId,
            config?.deviceName,
            message,
        )
    }
}
