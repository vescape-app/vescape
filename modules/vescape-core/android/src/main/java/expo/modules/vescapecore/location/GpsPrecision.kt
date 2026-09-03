package expo.modules.vescapecore.location

import android.location.LocationManager

/**
 * Threshold (meters) at or below which a horizontal accuracy is treated as a precise GPS fix. One
 * number for live classification and for Ride History's read-side rule, on both platforms.
 *
 * @parity /modules/vescape-core/ios/location/GpsPrecision.swift
 */
internal const val MAX_RECORDING_ACCURACY_M = 20.0

/**
 * Classify a **live** GPS fix as precise vs approximate. Ride History does not go through here: a
 * stored fix is judged by [expo.modules.vescapecore.telemetry.isPrecise], which applies the same
 * 20m limit to the accuracy the fix was stored with and deliberately ignores the provider, so the
 * platforms no longer disagree about what history may draw (ADR 0038).
 *
 * @platform-diff The `GPS_PROVIDER` requirement is Android-only and iOS has no provider concept.
 * It is confined to live classification and no longer reaches durable data.
 */
internal fun isPreciseGpsFix(provider: String?, accuracyM: Double?): Boolean =
    provider == LocationManager.GPS_PROVIDER &&
        accuracyM != null &&
        accuracyM <= MAX_RECORDING_ACCURACY_M

/**
 * How long an armed monitor may go without a fix before `gps_fix_stale` is recorded. Long enough
 * that a normal cold start (or a tunnel) does not spam the log, short enough that a dead monitor
 * is visible within one stop at a light.
 *
 * @parity /modules/vescape-core/ios/location/GpsPrecision.swift `GPS_STALE_FIX_TIMEOUT_S`
 */
internal const val GPS_STALE_FIX_TIMEOUT_MS = 30_000L

// Minimum interval between durable last-position writes on both platforms.
// @parity /modules/vescape-core/ios/location/GpsPrecision.swift `LAST_GPS_PERSIST_INTERVAL_MS`
internal const val LAST_GPS_PERSIST_INTERVAL_MS = 30_000L
