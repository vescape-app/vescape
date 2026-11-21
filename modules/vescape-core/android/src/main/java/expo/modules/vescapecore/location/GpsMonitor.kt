package expo.modules.vescapecore.location

import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.vescapecore.telemetry.AppDataRepository
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * @parity /modules/vescape-core/ios/location/GpsMonitor.swift
 */
internal class GpsMonitor(
    private val context: Context,
    private val looper: Looper,
    onLocation: (Location) -> Unit,
    /**
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `record`
     */
    private val record: (String, Map<String, Any?>) -> Unit = { _, _ -> },
) {
    private val locationListener = LocationListener { location ->
        noteFix()
        onLocation(location)
        resolveInitialLegalPolicy(location)
    }
    private var locationManager: LocationManager? = null
    private val legalPolicyResolutionStarted = AtomicBoolean(false)
    private val legalPolicyResolver = LegalPolicyResolver(context.applicationContext)
    private val resolutionScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val staleHandler = Handler(looper)
    private var armedAtMs: Long? = null
    private var lastFixAtMs: Long? = null
    private var firstFixReported = false
    private var staleReported = false
    private val staleWatchdog = object : Runnable {
        override fun run() {
            checkStaleFix()
            staleHandler.postDelayed(this, GPS_STALE_FIX_TIMEOUT_MS)
        }
    }

    /**
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `updatesStarted`
     */
    private var armed = false

    private var armedMode: GpsPowerMode? = null
    private var lastError: String? = null

    val active: Boolean
        get() = locationManager != null

    val updatesStarted: Boolean
        get() = armed

    /**
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `mode`
     */
    val mode: GpsPowerMode
        get() = armedMode ?: GpsPowerMode.Off

    val error: String?
        get() = lastError

    /**
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `phase`
     */
    val phase: GpsPhase
        get() = GpsPhase.resolve(retained = active, updatesStarted = armed, error = lastError)

    /**
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `apply`
     */
    fun apply(mode: GpsPowerMode): String? {
        if (mode == GpsPowerMode.Off) {
            stop(reason = "demand_released")
            return null
        }
        if (armed && armedMode == mode) return lastError

        val hasFine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!hasFine) {
            recordAuthorizationRefusal()
            lastError = "Location permission not granted"
            return lastError
        }

        val lm = (context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager) ?: return null
        val reconfiguring = armed
        if (reconfiguring) removeUpdates(lm)
        locationManager = lm
        val minDistanceM = if (mode == GpsPowerMode.Ride) 0f else GPS_MAP_MIN_DISTANCE_M
        try {
            lm.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                GPS_FIX_MIN_INTERVAL_MS,
                minDistanceM,
                locationListener,
                looper,
            )
            lm.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                GPS_NETWORK_FIX_MIN_INTERVAL_MS,
                minDistanceM,
                locationListener,
                looper,
            )
        } catch (e: Exception) {
            locationManager = null
            armed = false
            armedMode = null
            stopStaleWatchdog()
            val message = e.message ?: "Location updates failed"
            Log.w(VESC_SESSION_TAG, "Location updates failed: ${e.message}")
            recordGpsEvent("gps_provider_error", message)
            lastError = message
            return message
        }
        arm(mode, reconfiguring)
        return null
    }

    fun stop(reason: String = "stop_requested") {
        val lm = locationManager
        if (lm == null) {
            // @parity /modules/vescape-core/ios/location/GpsMonitor.swift `stop`
            lastError = null
            armedMode = null
            return
        }
        stopStaleWatchdog()
        recordGpsEvent(
            "gps_updates_stopped",
            "Location updates stopped",
            mapOf(
                "reason" to reason,
                "mode" to armedMode?.slug,
                "last_fix_age_ms" to lastFixAtMs?.let { nowMs() - it },
            ),
        )
        removeUpdates(lm)
        locationManager = null
        armed = false
        armedMode = null
        // @parity /modules/vescape-core/ios/location/GpsMonitor.swift `stop`
        lastError = null
        armedAtMs = null
        firstFixReported = false
        staleReported = false
    }

    private fun removeUpdates(lm: LocationManager) {
        try {
            lm.removeUpdates(locationListener)
        // intentional-suppression: location-listener teardown is best effort
        } catch (_: Exception) {
        }
    }

    private fun arm(mode: GpsPowerMode, reconfiguring: Boolean) {
        lastError = null
        val previous = armedMode
        armed = true
        armedMode = mode
        if (reconfiguring) {
            applyStaleWatchdog(mode)
            recordGpsEvent(
                "gps_mode_changed",
                "Location updates reconfigured",
                mapOf("mode" to mode.slug, "previous_mode" to previous?.slug),
            )
            return
        }
        armedAtMs = nowMs()
        firstFixReported = false
        staleReported = false
        recordGpsEvent("gps_updates_started", "Location updates started", mapOf("mode" to mode.slug))
        applyStaleWatchdog(mode)
    }

    /**
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `applyStaleWatchdog`
     */
    private fun applyStaleWatchdog(mode: GpsPowerMode) {
        if (mode != GpsPowerMode.Ride) {
            stopStaleWatchdog()
            staleReported = false
            return
        }
        startStaleWatchdog()
    }

    private fun noteFix() {
        lastFixAtMs = nowMs()
        firstFixReported = true
        if (staleReported) {
            staleReported = false
            recordGpsEvent("gps_fix_recovered", "GPS fixes resumed")
        }
    }

    private fun startStaleWatchdog() {
        stopStaleWatchdog()
        staleHandler.postDelayed(staleWatchdog, GPS_STALE_FIX_TIMEOUT_MS)
    }

    private fun stopStaleWatchdog() {
        staleHandler.removeCallbacks(staleWatchdog)
    }

    private fun checkStaleFix() {
        if (!armed || armedMode != GpsPowerMode.Ride || staleReported) return
        val since = lastFixAtMs ?: armedAtMs ?: return
        val age = nowMs() - since
        if (age < GPS_STALE_FIX_TIMEOUT_MS) return
        staleReported = true
        recordGpsEvent(
            "gps_fix_stale",
            if (firstFixReported) "No GPS fix since last update" else "No GPS fix since arming",
            mapOf("age_ms" to age, "had_fix" to firstFixReported),
        )
    }

    private fun recordGpsEvent(
        name: String,
        message: String,
        extra: Map<String, Any?> = emptyMap(),
    ) {
        record(name, mapOf("message" to message, "operation" to "gps") + extra)
    }

    private fun recordAuthorizationRefusal() {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        recordGpsEvent(
            "gps_start_denied",
            "Location permission not granted",
            mapOf(
                "background_permission" to (
                    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                        PackageManager.PERMISSION_GRANTED
                    ),
                "gps_provider_enabled" to (lm?.isProviderEnabled(LocationManager.GPS_PROVIDER) ?: false),
                "network_provider_enabled" to (lm?.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ?: false),
            ),
        )
    }

    private fun nowMs(): Long = System.currentTimeMillis()

    private fun resolveInitialLegalPolicy(location: Location) {
        if (!legalPolicyResolutionStarted.compareAndSet(false, true)) return
        resolutionScope.launch {
            val repository = AppDataRepository.get(context.applicationContext)
            if (repository.getTypedSettings().legalPolicy != null) return@launch
            val resolution = legalPolicyResolver.resolve(location.latitude, location.longitude)
            if (resolution is LegalPolicyResolution.Resolved && resolution.countryCode != null) {
                repository.updateLegalPolicy(resolution.countryCode)
            }
        }
    }
}
