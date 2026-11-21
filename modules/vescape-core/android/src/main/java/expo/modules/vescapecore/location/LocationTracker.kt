package expo.modules.vescapecore.location

import expo.modules.vescapecore.protocol.LocationSnapshot

import android.content.Context
import android.location.Location
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.recording.RecordingCoordinator
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.TelemetryPipeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// @parity /modules/vescape-core/ios/location/LocationTracker.swift
internal class LocationTracker(
    private val applicationContext: Context,
    private val appDataScope: CoroutineScope,
    private val emitEvent: (String, Map<String, Any?>) -> Unit,
    private val recordingCoordinator: RecordingCoordinator,
    private val telemetryPipeline: TelemetryPipeline,
) {
    private val recentLocations = ArrayDeque<Map<String, Any?>>()
    private val courseDeriver = GpsCourseDeriver()
    var latestLocation: LocationSnapshot? = null
        private set
    var latestPreciseLocation: LocationSnapshot? = null
        private set
    private var lastGpsPersistedAt = 0L

    /**
     * @parity /modules/vescape-core/ios/location/LocationTracker.swift `riderPosition`
     */
    val riderPosition: LocationSnapshot?
        get() = latestLocation ?: latestPreciseLocation

    /**
     * @parity /modules/vescape-core/ios/location/LocationTracker.swift `onLocationUpdated`
     */
    fun onLocationUpdated(location: Location): LocationSnapshot {
        val snapshot = track(location)
        // @parity /modules/vescape-core/ios/location/LocationTracker.swift `onLocationUpdated`
        NavigationController.get(applicationContext)
            .onFix(snapshot.latitude, snapshot.longitude, snapshot.speedMps)
        if (snapshot.precise) persistLastGpsLocation(snapshot)
        emitEvent("onLocation", snapshot.toMap())
        if (snapshot.precise) recordingCoordinator.recordLocation(snapshot)
        return snapshot
    }

    /**
     * @parity /modules/vescape-core/ios/location/LocationTracker.swift `prefill`
     */
    fun prefill(location: Location) {
        track(location)
    }

    private fun track(location: Location): LocationSnapshot {
        val accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        val speedMps = if (location.hasSpeed()) location.speed.toDouble() else null
        val bearingDeg = if (location.hasBearing()) location.bearing.toDouble() else null
        val precise = isPreciseGpsFix(location.provider, accuracyM)
        val course = if (precise) {
            courseDeriver.derive(
                latitude = location.latitude,
                longitude = location.longitude,
                speedMps = speedMps,
                bearingDeg = bearingDeg,
                timestamp = location.time,
            )
        } else {
            null
        }
        val snapshot = LocationSnapshot(
            latitude = location.latitude,
            longitude = location.longitude,
            speedMps = speedMps,
            bearingDeg = bearingDeg,
            accuracyM = accuracyM,
            altitudeM = if (location.hasAltitude()) location.altitude else null,
            timestamp = location.time,
            precise = precise,
            courseDeg = course?.bearingDeg,
            courseSourceTimestamp = course?.sourceTimestamp,
        )
        latestLocation = snapshot
        if (snapshot.precise) {
            latestPreciseLocation = snapshot
            recentLocations.addLast(snapshot.toMap())
            pruneRecentLocations(snapshot.timestamp)
        }
        return snapshot
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

    /**
     * @parity /modules/vescape-core/ios/location/LocationTracker.swift `resetTrail`
     */
    fun resetTrail() {
        latestLocation = null
        latestPreciseLocation = null
        courseDeriver.reset()
        recentLocations.clear()
    }

    // @parity /modules/vescape-core/ios/location/LastGpsLocationPersistence.swift `onLocationUpdated`
    private fun persistLastGpsLocation(location: LocationSnapshot) {
        val now = System.currentTimeMillis()
        if (now - lastGpsPersistedAt < LAST_GPS_PERSIST_INTERVAL_MS) return
        lastGpsPersistedAt = now
        appDataScope.launch {
            AppDataRepository.get(applicationContext).updateLastGpsLocation(location.latitude, location.longitude)
        }
    }
}
