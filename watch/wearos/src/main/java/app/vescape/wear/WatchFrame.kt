package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchTrailPoint
import expo.modules.vescapecore.watch.WatchTrailCodec
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val WATCH_FRAME_FIELD_COUNT = 13
private const val WATCH_FRAME_MIN_FIELD_COUNT = 5
private const val WATCH_FRAME_HEADER_BYTES = 2

private const val FLAG_STALE = 1
private const val FLAG_WAITING = 2

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchFrame.kt `WatchTiltControl`
 * @parity /modules/vescape-core/ios/watch/WatchFrame.swift `WatchTiltControl`
 */
enum class WatchTiltControl(val wire: Int) {
    FREE(0),
    MANUAL(1),
    SENSOR(2),
    MOVE(3),
    BLOCKED(4),
    ;

    val drivable: Boolean get() = this == FREE || this == MANUAL

    companion object {
        fun fromWire(wire: Double?): WatchTiltControl =
            if (wire == null) FREE else entries.firstOrNull { it.wire.toDouble() == wire } ?: BLOCKED
    }
}

data class WatchFrame(
    val speed: Double?,
    val duty: Double?,
    val battery: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val stale: Boolean,
    val waiting: Boolean = false,
    val navBearing: Double? = null,
    val navDistanceM: Double? = null,
    val riderEastM: Double? = null,
    val riderNorthM: Double? = null,
    val courseDeg: Double? = null,
    val routeSpanM: Double? = null,
    val remoteTilt: Int? = null,
    val tiltControl: WatchTiltControl = WatchTiltControl.FREE,
    val trail: List<WatchTrailPoint> = emptyList(),
    val mapPosition: WatchMapPosition? = null,
)

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
        val trail = WatchTrailCodec.decode(bytes, WATCH_FRAME_HEADER_BYTES + laneCount * 4)
        return WatchFrame(
            speed = lanes[0].orNull(),
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
            routeSpanM = lanes[10].orNull(),
            remoteTilt = lanes[11].orNull()?.toInt()?.coerceIn(0, 255),
            tiltControl = WatchTiltControl.fromWire(lanes[12].orNull()),
            trail = trail.points,
            mapPosition = trail.position,
        )
    }

    private fun Double.orNull(): Double? = if (isNaN()) null else this
}
