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
     * Where the rider is, for callers that need a position rather than a *good* position —
     * Navigation being the one that matters. Freshness beats accuracy here: a weak indoor fix from
     * a second ago is the right place to start a path from, while the last precise fix can be
     * yesterday's and kilometres away. Precise only stands in when nothing newer exists at all.
     *
     * @parity /modules/vescape-core/ios/location/LocationTracker.swift `riderPosition`
     */
    val riderPosition: LocationSnapshot?
        get() = latestLocation ?: latestPreciseLocation

    /**
     * Ingest one platform fix and return the [LocationSnapshot] it produced, so a caller acts on the
     * fix it handed in rather than re-reading mutable tracker state.
     *
     * @parity /modules/vescape-core/ios/location/LocationTracker.swift `onLocationUpdated`
     */
    fun onLocationUpdated(location: Location): LocationSnapshot {
        val accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null
        val speedMps = if (location.hasSpeed()) location.speed.toDouble() else null
        val bearingDeg = if (location.hasBearing()) location.bearing.toDouble() else null
        val precise = isPreciseGpsFix(location.provider, accuracyM)
        // Approximate fixes never feed the course: they are metres of noise apart and would spin a
        // derived bearing, and they are not what the map's GPS heading mode follows either.
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
        // Every fix moves Route Progress, approximate ones included: the same rule as
        // [riderPosition], where freshness beats accuracy. The bearing comes off the path rather
        // than off the fix, so a noisy position cannot spin it.
        // @parity /modules/vescape-core/ios/location/LocationTracker.swift `onLocationUpdated`
        NavigationController.get(applicationContext)
            .onFix(snapshot.latitude, snapshot.longitude, snapshot.speedMps)
        if (!snapshot.precise) {
            emitEvent("onLocation", snapshot.toMap())
            return snapshot
        }
        latestPreciseLocation = snapshot
        persistLastGpsLocation(snapshot)
        recentLocations.addLast(snapshot.toMap())
        pruneRecentLocations(snapshot.timestamp)
        emitEvent("onLocation", snapshot.toMap())
        recordingCoordinator.recordLocation(snapshot)
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
