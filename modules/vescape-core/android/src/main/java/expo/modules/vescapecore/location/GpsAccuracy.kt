package expo.modules.vescapecore.location

/**
 * Threshold (meters) at or below which a horizontal accuracy is treated as a precise GPS fix. One
 * number for live classification and for Ride History's read-side rule, on both platforms.
 *
 * @parity /modules/vescape-core/ios/location/GpsPrecision.swift
 */
internal const val MAX_RECORDING_ACCURACY_M = 20.0
