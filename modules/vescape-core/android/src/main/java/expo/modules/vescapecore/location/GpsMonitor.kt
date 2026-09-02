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

// @parity /modules/vescape-core/ios/location/GpsMonitor.swift
internal class GpsMonitor(
    private val context: Context,
    private val looper: Looper,
    onLocation: (Location) -> Unit,
    /**
     * Local Diagnostic Event sink (ADR 0007). GPS arming outlives any Board Session — the map arms
     * it at app start — so these breadcrumbs are recorded here rather than by the session
     * controller, which can only report `gps_session_summary` once a session ends.
     *
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

    /**
     * Per-armed-span fix bookkeeping, so `gps_fix_stale` fires at most once per silent stretch
     * instead of once per watchdog tick.
     */
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
     * True once location updates are actually requested, so the reported phase can tell a retained
     * manager apart from flowing fixes.
     *
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `updatesStarted`
     */
    private var armed = false
    private var lastError: String? = null

    val active: Boolean
        get() = locationManager != null

    val updatesStarted: Boolean
        get() = armed

    val error: String?
        get() = lastError

    /**
     * Live State phase. `active` means updates are running, not merely that a manager is retained.
     *
     * @parity /modules/vescape-core/ios/location/GpsMonitor.swift `phase`
     */
    val phase: GpsPhase
        get() = GpsPhase.resolve(retained = active, updatesStarted = armed, error = lastError)

    fun start(): String? {
        val hasFine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!hasFine) {
            recordAuthorizationRefusal()
            lastError = "Location permission not granted"
            return lastError
        }

        val lm = (context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager) ?: return null
        locationManager = lm
        try {
            lm.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                1000L,
                0f,
                locationListener,
                looper,
            )
            lm.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                2000L,
                0f,
                locationListener,
                looper,
            )
        } catch (e: Exception) {
            locationManager = null
            val message = e.message ?: "Location updates failed"
            Log.w(VESC_SESSION_TAG, "Location updates failed: ${e.message}")
            recordGpsEvent("gps_provider_error", message)
            lastError = message
            return message
        }
        arm()
        return null
    }

    fun stop(reason: String = "stop_requested") {
        val lm = locationManager ?: return
        stopStaleWatchdog()
        // Reported before teardown so the provider-enabled flags describe the monitor that was
        // actually running, not the nulled-out one.
        recordGpsEvent(
            "gps_updates_stopped",
            "Location updates stopped",
            mapOf("reason" to reason, "last_fix_age_ms" to lastFixAtMs?.let { nowMs() - it }),
        )
        try {
            lm.removeUpdates(locationListener)
        } catch (_: Exception) {
        }
        locationManager = null
        armed = false
        // A stopped monitor is idle, not failed.
        // @parity /modules/vescape-core/ios/location/GpsMonitor.swift `stop`
        lastError = null
        armedAtMs = null
        firstFixReported = false
        staleReported = false
    }

    private fun arm() {
        lastError = null
        armed = true
        armedAtMs = nowMs()
        firstFixReported = false
        staleReported = false
        recordGpsEvent("gps_updates_started", "Location updates started")
        startStaleWatchdog()
    }

    // MARK: - Diagnostics

    /**
     * Tracks the first fix of an armed span — `gps_session_summary` already reports
     * time-to-first-fix, so this only feeds the staleness watchdog — and clears a standing
     * staleness report, so a monitor that recovers leaves both the loss and the recovery in the log.
     */
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

    /**
     * Armed but silent is the failure mode a rider actually notices — the map holds its last
     * position and nothing in the log says why. Reported once per silent stretch.
     */
    private fun checkStaleFix() {
        if (!armed || staleReported) return
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

    /**
     * Deliberately lean: `gps_session_summary` already carries the permission and fix-count picture
     * per Board Session, so these breadcrumbs only add what an end-of-session aggregate cannot
     * express — when the monitor stopped, why, and when it went silent mid-span.
     */
    private fun recordGpsEvent(
        name: String,
        message: String,
        extra: Map<String, Any?> = emptyMap(),
    ) {
        record(name, mapOf("message" to message, "operation" to "gps") + extra)
    }

    /**
     * The one event that must stand alone: a refusal means no session will ever start, so no
     * `gps_session_summary` will report the permission state that caused it.
     */
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
            val countryCode = legalPolicyResolver.resolve(location.latitude, location.longitude)
            if (countryCode != null) repository.updateLegalPolicy(countryCode)
        }
    }
}
