package expo.modules.vescapecore.location

/**
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift
 * @parity /modules/vescape-core/src/index.ts `GpsPowerMode`
 */
internal enum class GpsPowerMode(val slug: String) {
    Off("off"),

    Map("map"),

    Ride("ride"),
}

/**
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `GPS_MAP_MIN_DISTANCE_M`
 */
internal const val GPS_MAP_MIN_DISTANCE_M = 5f

/**
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `RIDE_DROPOUT_GRACE_MS`
 */
internal const val RIDE_DROPOUT_GRACE_MS = 120_000L

internal const val GPS_FIX_MIN_INTERVAL_MS = 1_000L

internal const val GPS_NETWORK_FIX_MIN_INTERVAL_MS = 2_000L

/**
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `GpsDemand`
 */
internal object GpsDemand {
    fun resolve(
        appVisible: Boolean,
        riding: Boolean,
        watchNavigating: Boolean,
        replayOwnsPosition: Boolean,
        manualPublicRide: Boolean,
    ): GpsPowerMode {
        if (replayOwnsPosition) return GpsPowerMode.Off
        if (riding || watchNavigating || manualPublicRide) return GpsPowerMode.Ride
        if (appVisible) return GpsPowerMode.Map
        return GpsPowerMode.Off
    }

    /**
     * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `ridingThroughDropout`
     */
    fun ridingThroughDropout(linkLostAtMs: Long?, nowMs: Long): Boolean {
        if (linkLostAtMs == null) return true
        return nowMs - linkLostAtMs < RIDE_DROPOUT_GRACE_MS
    }
}
