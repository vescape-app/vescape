package expo.modules.vescapecore.location

/**
 * How hard the phone's GPS is being driven, and therefore what it costs.
 *
 * GPS is app-level, not a Board Session's property (`docs/connectionState.md`), but "app-level"
 * never meant "always on": the monitor is armed for a *reason*, and when no reason is left it goes
 * off. Modes exist so the two live reasons can be paid for differently — a rider watching the map
 * has the screen on anyway and only needs foreground fixes, while a ride needs background delivery
 * at full rate and cannot afford a missed metre of Ride Track.
 *
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift
 * @parity /modules/vescape-core/src/index.ts `GpsPowerMode`
 */
internal enum class GpsPowerMode(val slug: String) {
    /** Nothing wants a fix. The location listener is removed, not merely idled. */
    Off("off"),

    /**
     * The rider is looking at the app. Foreground-only delivery, gated by a small minimum distance
     * so standing still costs nothing.
     */
    Map("map"),

    /** The rider is riding (or sharing position in a Group Ride). Background delivery at full rate. */
    Ride("ride"),
}

/**
 * Distance (metres) a rider must move before `Map` mode delivers another fix. Small enough that the
 * marker still tracks a walk across a car park, large enough that a phone sitting on a desk with the
 * app open stops waking the GNSS chip.
 *
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `GPS_MAP_MIN_DISTANCE_M`
 */
internal const val GPS_MAP_MIN_DISTANCE_M = 5f

/**
 * How long a Board Session with a lost link still counts as a ride.
 *
 * A mid-ride dropout must not punch a hole in the Ride Track — keeping the route alive across one is
 * the whole point of recording GPS on its own clock (ADR 0038) — so the reconnect states keep `Ride`
 * demand. But a Board Session survives its link indefinitely, and the ordinary way a rider ends a
 * ride is to power the board off: past this window the reconnect loop is chasing a board that is not
 * coming back, and paying for background GPS on its behalf is the drain this window exists to stop.
 *
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `RIDE_DROPOUT_GRACE_MS`
 */
internal const val RIDE_DROPOUT_GRACE_MS = 120_000L

/** Fix spacing asked of `GPS_PROVIDER`. Unchanged from the always-on monitor this replaced. */
internal const val GPS_FIX_MIN_INTERVAL_MS = 1_000L

/** Fix spacing asked of `NETWORK_PROVIDER`, which backs up GNSS indoors and on a cold start. */
internal const val GPS_NETWORK_FIX_MIN_INTERVAL_MS = 2_000L

/**
 * The one place the app decides whether the phone's GPS should be running, and how hard.
 *
 * Deliberately pure and total: every caller passes the same four facts and gets the same answer on
 * both platforms, so "why is GPS on?" is answerable without reading the controller.
 *
 * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `GpsDemand`
 */
internal object GpsDemand {
    /**
     * @param appVisible the app is in front of the rider, so the live map has someone watching it.
     * @param riding a Board Session is delivering telemetry and Idle Pause is not holding it. A
     *   paused ride is deliberately *not* riding: Idle Pause already stops recording fixes
     *   (ADR 0021), so keeping the chip warm through a 30s+ stop buys nothing but drain.
     * @param groupRideParticipating the rider's position is being broadcast to a Group Ride, which
     *   must keep working with the phone in a pocket and no Board connected.
     * @param replayOwnsPosition a replay is feeding recorded fixes through the live path; a real fix
     *   slipping in would fight them (`docs/connectionState.md`).
     */
    fun resolve(
        appVisible: Boolean,
        riding: Boolean,
        groupRideParticipating: Boolean,
        replayOwnsPosition: Boolean,
    ): GpsPowerMode {
        if (replayOwnsPosition) return GpsPowerMode.Off
        if (riding || groupRideParticipating) return GpsPowerMode.Ride
        if (appVisible) return GpsPowerMode.Map
        return GpsPowerMode.Off
    }

    /**
     * Whether a Board Session whose link is currently down still counts as a ride.
     * [linkLostAtMs] is `null` while the link is up.
     *
     * @parity /modules/vescape-core/ios/location/GpsPowerMode.swift `ridingThroughDropout`
     */
    fun ridingThroughDropout(linkLostAtMs: Long?, nowMs: Long): Boolean {
        if (linkLostAtMs == null) return true
        return nowMs - linkLostAtMs < RIDE_DROPOUT_GRACE_MS
    }
}
