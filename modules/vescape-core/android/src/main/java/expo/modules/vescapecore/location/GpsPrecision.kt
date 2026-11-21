package expo.modules.vescapecore.location

import android.location.LocationManager

/**
 * @platform-diff The `GPS_PROVIDER` requirement is Android-only and iOS has no provider concept.
 * It is confined to live classification and no longer reaches durable data.
 */
internal fun isPreciseGpsFix(provider: String?, accuracyM: Double?): Boolean =
    provider == LocationManager.GPS_PROVIDER &&
        accuracyM != null &&
        accuracyM <= MAX_RECORDING_ACCURACY_M

/**
 * @parity /modules/vescape-core/ios/location/GpsPrecision.swift `GPS_STALE_FIX_TIMEOUT_S`
 */
internal const val GPS_STALE_FIX_TIMEOUT_MS = 30_000L

// @parity /modules/vescape-core/ios/location/GpsPrecision.swift `LAST_GPS_PERSIST_INTERVAL_MS`
internal const val LAST_GPS_PERSIST_INTERVAL_MS = 30_000L
