package expo.modules.vescapecore.recording

import expo.modules.vescapecore.protocol.LocationSnapshot
import android.content.Context
import expo.modules.vescapecore.service.SessionConfig
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.AppSettings
import expo.modules.vescapecore.telemetry.RIDE_RECORDING_END_BOARD_CHANGE
import expo.modules.vescapecore.telemetry.RIDE_RECORDING_END_DISCONNECTED
import expo.modules.vescapecore.telemetry.RIDE_RECORDING_END_STOPPED
import expo.modules.vescapecore.telemetry.TelemetryCapture
import expo.modules.vescapecore.telemetry.TelemetryLocationCapture
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
        // A recording belongs to exactly one Board. An explicit connection attempt to another one
        // ends the previous recording here, before the attempt can succeed or fail — a failed
        // connection must not reopen it either (ADR 0038).
        endOpenRideRecording(RIDE_RECORDING_END_BOARD_CHANGE)
        recorder = if (config.recordingEnabled) {
            SessionRecorder(context, config).also { it.start() }
        } else {
            null
        }
        telemetryStore = if (config.telemetryRecordingEnabled || requestedTelemetryRecordingEnabled) {
            configuredTelemetryStore(config)
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
            telemetryStore = configuredTelemetryStore(config)
        }
        recordMarker("connected", config)
    }

    fun finishBoardSession(status: String, markerType: String, config: SessionConfig?) {
        finishRecording(status)
        recordMarker(markerType, config)
        endOpenRideRecording(RIDE_RECORDING_END_DISCONNECTED)
        flushTelemetryBlocking()
        telemetryStore = null
        connectionLostMarkerAt = null
    }

    fun failSession(status: String = "error") {
        finishRecording(status)
        endOpenRideRecording(RIDE_RECORDING_END_DISCONNECTED)
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

    /**
     * Offer one GPS Fix to the Ride Track. Independent of telemetry arrival: while a Ride Recording
     * is open and unpaused, fixes keep landing straight through a board dropout (ADR 0038).
     */
    fun recordGpsFix(location: TelemetryLocationCapture) {
        telemetryStore?.recordGpsFix(location)
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
            telemetryStore = configuredTelemetryStore(config)
            recordMarker("connected", config)
        }
    }

    fun disableTelemetryRecording(config: SessionConfig?) {
        recordMarker("app_stop", config, "Recording stopped")
        endOpenRideRecording(RIDE_RECORDING_END_STOPPED)
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

    /** Closing an already-closed recording is a no-op; the store owns that check. */
    private fun endOpenRideRecording(reason: String) {
        TelemetryRepository.get(context).endRideRecording(reason)
    }

    private fun configuredTelemetryStore(config: SessionConfig?): TelemetryRepository {
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
        // Enabling recording is what opens a Ride Recording: durable identity and an explicit start
        // boundary, minted before the first sample or fix can be admitted.
        store.beginRideRecording(config?.appBoardId)
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
