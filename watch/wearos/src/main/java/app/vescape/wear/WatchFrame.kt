package app.vescape.wear

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Float32 lane count + order of a Watch Frame:
 *   0 speed, 1 duty, 2 battery, 3 motorTemp, 4 ctrlTemp, 5 navBearing, 6 navDistance,
 *   7 riderEast, 8 riderNorth, 9 course.
 *
 * Lanes 7-9 place the rider on the route pushed over [ROUTE_PATH]: metres east/north of that route's
 * origin plus the course, degrees clockwise from north.
 *
 * Mirrors the phone-side builder (`expo.modules.vescapecore.WatchFrameBuilder`, `WATCH_FRAME_FIELD_COUNT`)
 * by convention (ADR-0018). Adding or reordering a lane means editing both sides in the same order,
 * or the decode silently misreads. Keep the two lists adjacent in review.
 *
 * The decode reads whatever lanes the phone sent and leaves the rest null, so a phone and a watch on
 * different app versions still talk: an older phone's shorter frame keeps rendering, it just carries
 * no nav. Only the first [WATCH_FRAME_MIN_FIELD_COUNT] lanes are required.
 */
private const val WATCH_FRAME_FIELD_COUNT = 10
private const val WATCH_FRAME_MIN_FIELD_COUNT = 5
private const val WATCH_FRAME_HEADER_BYTES = 2

/** Flags-byte bits, mirroring the phone-side `WATCH_FRAME_FLAG_*` constants (ADR-0018). */
private const val FLAG_STALE = 1
private const val FLAG_WAITING = 2

/**
 * The decoded Watch Frame. Nullable lanes arrive as `NaN` over the wire (ADR-0018). [waiting] marks
 * a "session live, no board telemetry yet" frame — the lanes carry no data and must not be rendered.
 */
data class WatchFrame(
    val speed: Double,
    val duty: Double?,
    val battery: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val stale: Boolean,
    val waiting: Boolean = false,
    /** Bearing to the navigation target relative to travel direction, degrees clockwise from ahead. */
    val navBearing: Double? = null,
    /** Straight-line distance to the navigation target, metres. */
    val navDistanceM: Double? = null,
    /** Rider position, metres east of the pushed route's origin. Null when there is no route. */
    val riderEastM: Double? = null,
    /** Rider position, metres north of the pushed route's origin. Null when there is no route. */
    val riderNorthM: Double? = null,
    /** Travel course, degrees clockwise from north. */
    val courseDeg: Double? = null,
)

/** Pure bytes -> [WatchFrame] decoder. Returns null on a short buffer or too few lanes. */
object WatchFrameDecoder {
    fun decode(bytes: ByteArray): WatchFrame? {
        if (bytes.size < WATCH_FRAME_HEADER_BYTES) return null
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val laneCount = buf.get().toInt()
        if (laneCount < WATCH_FRAME_MIN_FIELD_COUNT) return null
        if (bytes.size < WATCH_FRAME_HEADER_BYTES + laneCount * 4) return null
        val flags = buf.get().toInt()
        val lanes = DoubleArray(WATCH_FRAME_FIELD_COUNT) { Double.NaN }
        for (index in 0 until laneCount) {
            val value = buf.float
            if (index < lanes.size) lanes[index] = value.toDouble()
        }
        return WatchFrame(
            speed = lanes[0],
            duty = lanes[1].orNull(),
            battery = lanes[2].orNull(),
            motorTemp = lanes[3].orNull(),
            ctrlTemp = lanes[4].orNull(),
            stale = flags and FLAG_STALE != 0,
            waiting = flags and FLAG_WAITING != 0,
            navBearing = lanes[5].orNull(),
            navDistanceM = lanes[6].orNull(),
            riderEastM = lanes[7].orNull(),
            riderNorthM = lanes[8].orNull(),
            courseDeg = lanes[9].orNull(),
        )
    }

    private fun Double.orNull(): Double? = if (isNaN()) null else this
}
