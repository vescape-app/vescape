import Foundation

/// Threshold (meters) at or below which a horizontal accuracy is treated as a precise GPS fix
/// good enough for Ride Recording. Matches Android `MAX_RECORDING_ACCURACY_M`.
internal let MAX_RECORDING_ACCURACY_M = 20.0

/// Classify a GPS fix as precise (recording-grade) vs approximate. Android also requires the
/// fix to come from the `GPS_PROVIDER`; iOS has no provider concept, so `CLLocation`'s
/// `horizontalAccuracy` (already surfaced as `accuracyM`) is the sole signal — a coarse or
/// reduced-authorization fix reports a large accuracy and falls through as approximate.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/GpsPrecision.kt
/// @platform-diff iOS keys off `horizontalAccuracy` alone (no provider), which also covers the
/// iOS 14 "approximate location" authorization since reduced fixes report low accuracy.
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
