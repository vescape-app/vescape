package expo.modules.vescapecore.location

import expo.modules.vescapecore.protocol.LocationSnapshot

import android.content.Context
import android.location.Location
import expo.modules.vescapecore.recording.RecordingCoordinator
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.TelemetryPipeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal class LocationTracker(
    private val applicationContext: Context,
    private val appDataScope: CoroutineScope,
    private val emitEvent: (String, Map<String, Any?>) -> Unit,
    private val recordingCoordinator: RecordingCoordinator,
    private val telemetryPipeline: TelemetryPipeline,
) {
    private val recentLocations = ArrayDeque<Map<String, Any?>>()
    var latestLocation: LocationSnapshot? = null
        private set
    var latestPreciseLocation: LocationSnapshot? = null
        private set
    private var lastGpsPersistedAt = 0L

    /**
     * Where the rider is, for callers that need a position rather than a *good* position —
     * Navigation being the one that matters. Freshness beats accuracy here: a weak indoor fix from
     * a second ago is the right place to start a path from, while the last precise fix can be
     * yesterday's and kilometres away. Precise only stands in when nothing newer exists at all.
     *
     * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `riderPosition`
     */
    val riderPosition: LocationSnapshot?
        get() = latestLocation ?: latestPreciseLocation

    fun onLocationUpdated(location: Location) {
        val accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        val snapshot = LocationSnapshot(
            latitude = location.latitude,
            longitude = location.longitude,
            speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
            bearingDeg = if (location.hasBearing()) location.bearing.toDouble() else null,
            accuracyM = accuracyM,
            altitudeM = if (location.hasAltitude()) location.altitude else null,
            timestamp = location.time,
            precise = isPreciseGpsFix(location.provider, accuracyM),
        )
        latestLocation = snapshot
        if (!snapshot.precise) {
            emitEvent("onLocation", snapshot.toMap())
            return
        }
        latestPreciseLocation = snapshot
        persistLastGpsLocation(snapshot)
        recentLocations.addLast(snapshot.toMap())
        pruneRecentLocations(snapshot.timestamp)
        emitEvent("onLocation", snapshot.toMap())
        recordingCoordinator.recordLocation(snapshot)
    }

    fun recentLocations(): List<Map<String, Any?>> = recentLocations.toList()

    fun pruneRecentLocations(nowMs: Long) {
        val oldest = nowMs - telemetryPipeline.recentWindowMs()
        while (recentLocations.isNotEmpty()) {
            val timestamp = (recentLocations.first()["timestamp"] as? Number)?.toLong() ?: break
            if (timestamp >= oldest) break
            recentLocations.removeFirst()
        }
    }

    private fun persistLastGpsLocation(location: LocationSnapshot) {
        val now = System.currentTimeMillis()
        if (now - lastGpsPersistedAt < 30_000L) return
        lastGpsPersistedAt = now
        appDataScope.launch {
            AppDataRepository.get(applicationContext).updateLastGpsLocation(location.latitude, location.longitude)
        }
    }
}
