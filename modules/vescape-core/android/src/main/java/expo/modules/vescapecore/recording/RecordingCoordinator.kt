package expo.modules.vescapecore.recording

import expo.modules.vescapecore.riderprofiles.RiderStatsSender
import expo.modules.vescapecore.protocol.LocationSnapshot
import android.content.Context
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.database.RECORDING_STOP_MARKER
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

    private var recordingBoardId: String? = null
    private var recordingStartedAtMs: Long? = null

    private var explicitlyStopped = false

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

    fun beginBoardSession(config: SessionConfig) {
        connectionLostMarkerAt = null
        val wasRecording = telemetryStore != null && recordingBoardId == config.appBoardId
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

    fun recordGpsFix(location: TelemetryLocationCapture) {
        telemetryStore?.recordGpsFix(location, recordingBoardId)
    }

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
        if (telemetryStore != null) {
            val boardId = recordingBoardId
            val sinceMs = recordingStartedAtMs
            if (boardId != null && sinceMs != null) RiderStatsSender.get(context).recordingEnded(boardId, sinceMs)
        }
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
        recordingStartedAtMs = System.currentTimeMillis()
        return store
    }

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
