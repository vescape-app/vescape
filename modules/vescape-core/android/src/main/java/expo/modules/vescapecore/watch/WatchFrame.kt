package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/**
 * Number of Float32 lanes in a Watch Frame, in this fixed order:
 *   0 speed, 1 duty, 2 battery, 3 motorTemp, 4 ctrlTemp, 5 navBearing, 6 navDistance.
 *
 * The wrist-side decoder ([app.vescape.wear] `WatchFrameDecoder`) carries the same constant and lane
 * order by convention (ADR-0018). Adding or reordering a lane means editing both sides in the same
 * order, or the decode silently misreads. Keep the two lists adjacent in review.
 */
internal const val WATCH_FRAME_FIELD_COUNT = 7

/** Header (1 byte field-count + 1 byte flags) + Float32 lanes, little-endian. */
internal const val WATCH_FRAME_BYTES = 2 + WATCH_FRAME_FIELD_COUNT * 4

/** Flags-byte bits. The wrist-side decoder carries the same values by convention (ADR-0018). */
internal const val WATCH_FRAME_FLAG_STALE = 1
internal const val WATCH_FRAME_FLAG_WAITING = 2

/** The decoded Watch Frame model. Nullable numeric lanes ride as `NaN` over the wire (ADR-0018). */
internal data class WatchFrame(
    val speed: Double,
    val duty: Double?,
    val battery: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val stale: Boolean,
    val waiting: Boolean = false,
    /**
     * Bearing to the navigation target relative to travel direction, degrees clockwise from ahead.
     * TODO(nav): always null — nothing feeds these lanes yet. The wrist already renders the nav
     * overlay when both are present and hides it when either is null. The remaining work is native:
     * the session holds the active destination coordinate (JS sends it once per route change, as an
     * intent, and clears it when the route ends) and derives bearing + distance per watch tick from
     * `LocationTracker.riderPosition` and the current course. Deriving them in JS instead would put
     * a per-fix computation on the bridge for data native already has.
     */
    val navBearing: Double? = null,
    /** Straight-line distance to the navigation target, metres. TODO(nav): see [navBearing]. */
    val navDistanceM: Double? = null,
)

/** The latest cold-path values the watch tick reads to build a frame. `stale` is decided at tick time. */
internal data class WatchSnapshot(
    val speed: Double,
    val dutyCycle: Double,
    val dutyExcluded: Boolean,
    val batterySoc: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    /** Nav target relative bearing (degrees) and distance (metres), derived natively. TODO(nav): see [WatchFrame.navBearing]. */
    val navBearing: Double? = null,
    val navDistanceM: Double? = null,
)

/**
 * Pure cold-path-snapshot -> Watch Frame builder + compact byte encoder (ADR-0019). Mirrors
 * `LIVE_SERIES_METRICS`: speed/duty are abs (duty also ×100), and duty drops to null when the
 * sample is excluded from `max_duty`, so the wrist shows the same numbers the phone does.
 */
internal object WatchFrameBuilder {
    fun build(snapshot: WatchSnapshot, stale: Boolean): WatchFrame = WatchFrame(
        speed = abs(snapshot.speed),
        duty = if (snapshot.dutyExcluded) null else abs(snapshot.dutyCycle) * 100,
        battery = snapshot.batterySoc,
        motorTemp = snapshot.motorTemp,
        ctrlTemp = snapshot.ctrlTemp,
        stale = stale,
        navBearing = snapshot.navBearing,
        navDistanceM = snapshot.navDistanceM,
    )

    /**
     * "Session live, no board telemetry yet" frame: the connect phase before the first sample (or
     * after a telemetry reset). Also flagged stale so an older wrist decoder degrades to a dimmed
     * zero instead of rendering it as live data.
     */
    fun waitingFrame(): WatchFrame = WatchFrame(
        speed = 0.0,
        duty = null,
        battery = null,
        motorTemp = null,
        ctrlTemp = null,
        stale = true,
        waiting = true,
    )

    fun encode(frame: WatchFrame): ByteArray =
        ByteBuffer.allocate(WATCH_FRAME_BYTES).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(WATCH_FRAME_FIELD_COUNT.toByte())
            var flags = 0
            if (frame.stale) flags = flags or WATCH_FRAME_FLAG_STALE
            if (frame.waiting) flags = flags or WATCH_FRAME_FLAG_WAITING
            put(flags.toByte())
            putFloat(frame.speed.toFloat())
            putFloat(frame.duty.toLaneFloat())
            putFloat(frame.battery.toLaneFloat())
            putFloat(frame.motorTemp.toLaneFloat())
            putFloat(frame.ctrlTemp.toLaneFloat())
            // Nav lanes ride as NaN until a route feeds them, which is how the wrist hides the overlay.
            putFloat(frame.navBearing.toLaneFloat())
            putFloat(frame.navDistanceM.toLaneFloat())
        }.array()

    private fun Double?.toLaneFloat(): Float = this?.toFloat() ?: Float.NaN
}
