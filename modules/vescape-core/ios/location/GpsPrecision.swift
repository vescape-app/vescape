import Foundation

/// Threshold (meters) at or below which a horizontal accuracy is treated as a precise GPS fix.
/// One number for live classification and for Ride History's read-side rule, on both platforms.
internal let MAX_RECORDING_ACCURACY_M = 20.0

/// Classify a **live** GPS fix as precise (recording-grade) vs approximate — the GPS status pill,
/// the live map and the course deriver. Ride History does not go through here: a stored fix is
/// judged by `rideTrackFixIsPrecise`, which applies the same 20m limit to the accuracy the fix was
/// stored with and deliberately knows nothing about providers (ADR 0038).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt
/// @platform-diff Android additionally requires `GPS_PROVIDER` here, which iOS has no concept of.
/// The difference is confined to live classification and no longer reaches durable data: history
/// reads one shared, provider-independent rule on both platforms.
internal func isPreciseGpsFix(accuracyM: Double?) -> Bool {
  guard let accuracyM else { return false }
  return accuracyM <= MAX_RECORDING_ACCURACY_M
}

/// How long an armed monitor may go without a fix before `gps_fix_stale` is recorded. Long enough
/// that a normal cold start (or a tunnel) does not spam the log, short enough that a dead monitor
/// is visible within one stop at a light.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt `GPS_STALE_FIX_TIMEOUT_MS`
internal let GPS_STALE_FIX_TIMEOUT_S = 30.0

/// Minimum interval between durable last-position writes on both platforms.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt `LAST_GPS_PERSIST_INTERVAL_MS`
internal let LAST_GPS_PERSIST_INTERVAL_MS: Int64 = 30_000
