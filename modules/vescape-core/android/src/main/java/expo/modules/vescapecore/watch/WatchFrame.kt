package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/**
 * Number of Float32 lanes in a Watch Frame, in this fixed order:
 *   0 speed, 1 duty, 2 battery, 3 motorTemp, 4 ctrlTemp, 5 navBearing, 6 navDistance,
 *   7 riderEast, 8 riderNorth, 9 course, 10 routeSpan, 11 remoteTilt, 12 tiltControl.
 *
 * Lanes 11-12 are Remote Tilt: the commanded value (0..255, 128 neutral) and who may drive it
 * ([WatchTiltControl.wire]). The wrist's Tilt page starts every stick drag from this value, so a tilt
 * set or cleared on the phone pad is where the next wrist drag picks up.
 *
 * Lanes 7-9 place the rider against the route pushed on [WATCH_ROUTE_PATH]: metres east/north of
 * that route's origin (see `offsetMeters`) plus the current course, degrees clockwise from north.
 * They are per-fix data, which is why they ride the frame and the polyline itself does not.
 *
 * The wrist-side decoder ([app.vescape.wear] `WatchFrameDecoder`) carries the same constant and lane
 * order by convention (ADR-0018). Adding or reordering a lane means editing both sides in the same
 * order, or the decode silently misreads. Keep the two lists adjacent in review.
 */
internal const val WATCH_FRAME_FIELD_COUNT = 13

/** Header (1 byte field-count + 1 byte flags) + Float32 lanes, little-endian. */
internal const val WATCH_FRAME_BYTES = 2 + WATCH_FRAME_FIELD_COUNT * 4

/**
 * Flags-byte bits. The wrist-side decoder carries the same values by convention (ADR-0018). Bit 2
 * ("waiting") is legacy: the tick is service-scoped now and always has a frame worth drawing, so
 * this side never sets it. The wrist still decodes it for older phone builds.
 */
internal const val WATCH_FRAME_FLAG_STALE = 1

/**
 * Who may drive Remote Tilt right now, as the wrist needs it: whether a stick drag would be accepted,
 * and what to call the value when it would not. Derived phone-side from the same arbiter and link
 * trust the phone pad obeys, so the wrist duplicates no policy.
 *
 * Wire values ride a Float32 lane — append, never renumber.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchFrame.kt `WatchTiltControl`
 * @parity /modules/vescape-core/ios/watch/WatchFrame.swift `WatchTiltControl`
 */
internal enum class WatchTiltControl(val wire: Int) {
    /** Nothing commanded; a drag starts one. */
    FREE(0),

    /** A rider tilt (pad or wrist) is streaming; a drag adjusts it. */
    MANUAL(1),

    /** A ground-clearance Accessory is bound; manual tilt is refused. */
    SENSOR(2),

    /** Board Move holds the slot; manual tilt is refused. */
    MOVE(3),

    /** The link is not trusted for firmware commands; manual tilt is refused. */
    BLOCKED(4),
}

/** The decoded Watch Frame model. Nullable numeric lanes ride as `NaN` over the wire (ADR-0018). */
internal data class WatchFrame(
    val speed: Double?,
    val duty: Double?,
    val battery: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val stale: Boolean,
    /**
     * Where the path goes next: absolute degrees clockwise from north, from Route Progress. The
     * wrist rotates its north-up world by [courseDeg], so this is never pre-rotated on the phone.
     * Null whenever there is no Navigation, which is how the wrist hides its nav overlay.
     */
    val navBearing: Double? = null,
    /** Metres left to the Direction Point measured **along** the path. Null with [navBearing]. */
    val navDistanceM: Double? = null,
    /** Rider position, metres east of the pushed route's origin. Null when there is no route. */
    val riderEastM: Double? = null,
    /** Rider position, metres north of the pushed route's origin. Null when there is no route. */
    val riderNorthM: Double? = null,
    /** Travel course, degrees clockwise from north. Null when the fix carries no usable heading. */
    val courseDeg: Double? = null,
    /** Horizontal metres visible on the phone map; wrist route uses the same world span. */
    val routeSpanM: Double? = null,
    /** Commanded Remote Tilt, 0..255 with 128 neutral. Null without a board. */
    val remoteTilt: Int? = null,
    val tiltControl: WatchTiltControl = WatchTiltControl.FREE,
)

/** The latest cold-path values the watch tick reads to build a frame. `stale` is decided at tick time. */
internal data class WatchSnapshot(
    val speed: Double?,
    val dutyCycle: Double?,
    val dutyExcluded: Boolean,
    val batterySoc: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    /** Route Progress bearing (absolute degrees) and remaining distance along the path (metres). */
    val navBearing: Double? = null,
    val navDistanceM: Double? = null,
    /** Rider offset from the pushed route origin (metres) and course (degrees), derived natively. */
    val riderEastM: Double? = null,
    val riderNorthM: Double? = null,
    val courseDeg: Double? = null,
    val routeSpanM: Double? = null,
    val remoteTilt: Int? = null,
    val tiltControl: WatchTiltControl = WatchTiltControl.FREE,
)

/**
 * Pure cold-path-snapshot -> Watch Frame builder + compact byte encoder (ADR-0019). Mirrors
 * `LIVE_SERIES_METRICS`: speed/duty are abs (duty also ×100), and duty drops to null when the
 * sample is excluded from `max_duty`, so the wrist shows the same numbers the phone does.
 */
internal object WatchFrameBuilder {
    fun build(snapshot: WatchSnapshot, stale: Boolean): WatchFrame = WatchFrame(
        speed = snapshot.speed?.let(::abs),
        duty = if (snapshot.dutyExcluded) null else snapshot.dutyCycle?.let { abs(it) * 100 },
        battery = snapshot.batterySoc,
        motorTemp = snapshot.motorTemp,
        ctrlTemp = snapshot.ctrlTemp,
        stale = stale,
        navBearing = snapshot.navBearing,
        navDistanceM = snapshot.navDistanceM,
        riderEastM = snapshot.riderEastM,
        riderNorthM = snapshot.riderNorthM,
        courseDeg = snapshot.courseDeg,
        routeSpanM = snapshot.routeSpanM,
        remoteTilt = snapshot.remoteTilt,
        tiltControl = snapshot.tiltControl,
    )

    fun encode(frame: WatchFrame): ByteArray =
        ByteBuffer.allocate(WATCH_FRAME_BYTES).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(WATCH_FRAME_FIELD_COUNT.toByte())
            var flags = 0
            if (frame.stale) flags = flags or WATCH_FRAME_FLAG_STALE
            put(flags.toByte())
            putFloat(frame.speed.toLaneFloat())
            putFloat(frame.duty.toLaneFloat())
            putFloat(frame.battery.toLaneFloat())
            putFloat(frame.motorTemp.toLaneFloat())
            putFloat(frame.ctrlTemp.toLaneFloat())
            // Nav lanes ride as NaN when there is no Navigation, which is how the wrist hides the overlay.
            putFloat(frame.navBearing.toLaneFloat())
            putFloat(frame.navDistanceM.toLaneFloat())
            // Rider placement against the pushed route; NaN whenever there is no route to place on.
            putFloat(frame.riderEastM.toLaneFloat())
            putFloat(frame.riderNorthM.toLaneFloat())
            putFloat(frame.courseDeg.toLaneFloat())
            putFloat(frame.routeSpanM.toLaneFloat())
            putFloat(frame.remoteTilt?.toDouble().toLaneFloat())
            putFloat(frame.tiltControl.wire.toFloat())
        }.array()

    private fun Double?.toLaneFloat(): Float = this?.toFloat() ?: Float.NaN
}
