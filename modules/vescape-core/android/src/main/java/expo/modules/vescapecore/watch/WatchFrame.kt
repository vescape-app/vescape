package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

internal const val WATCH_FRAME_FIELD_COUNT = 13

internal const val WATCH_FRAME_BYTES = 2 + WATCH_FRAME_FIELD_COUNT * 4

internal const val WATCH_FRAME_FLAG_STALE = 1

/**
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchFrame.kt `WatchTiltControl`
 * @parity /modules/vescape-core/ios/watch/WatchFrame.swift `WatchTiltControl`
 */
internal enum class WatchTiltControl(val wire: Int) {
    FREE(0),

    MANUAL(1),

    SENSOR(2),

    MOVE(3),

    BLOCKED(4),
}

internal data class WatchFrame(
    val speed: Double?,
    val duty: Double?,
    val battery: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val stale: Boolean,
    val navBearingDeg: Double? = null,
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

internal data class WatchSnapshot(
    val speed: Double?,
    val dutyCycle: Double?,
    val dutyExcluded: Boolean,
    val batterySoc: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val navBearingDeg: Double? = null,
    val navDistanceM: Double? = null,
    val riderEastM: Double? = null,
    val riderNorthM: Double? = null,
    val courseDeg: Double? = null,
    val routeSpanM: Double? = null,
    val remoteTilt: Int? = null,
    val tiltControl: WatchTiltControl = WatchTiltControl.FREE,
    val trail: List<WatchTrailPoint> = emptyList(),
    val mapPosition: WatchMapPosition? = null,
    val riderSpeedMps: Double? = null,
)

internal object WatchFrameBuilder {
    fun build(snapshot: WatchSnapshot, stale: Boolean): WatchFrame = WatchFrame(
        speed = snapshot.speed?.let(::abs),
        duty = if (snapshot.dutyExcluded) null else snapshot.dutyCycle?.let { abs(it) * 100 },
        battery = snapshot.batterySoc,
        motorTemp = snapshot.motorTemp,
        ctrlTemp = snapshot.ctrlTemp,
        stale = stale,
        navBearingDeg = snapshot.navBearingDeg,
        navDistanceM = snapshot.navDistanceM,
        riderEastM = snapshot.riderEastM,
        riderNorthM = snapshot.riderNorthM,
        courseDeg = snapshot.courseDeg,
        routeSpanM = snapshot.routeSpanM,
        remoteTilt = snapshot.remoteTilt,
        tiltControl = snapshot.tiltControl,
        trail = snapshot.trail,
        mapPosition = snapshot.mapPosition,
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
            putFloat(frame.navBearingDeg.toLaneFloat())
            putFloat(frame.navDistanceM.toLaneFloat())
            putFloat(frame.riderEastM.toLaneFloat())
            putFloat(frame.riderNorthM.toLaneFloat())
            putFloat(frame.courseDeg.toLaneFloat())
            putFloat(frame.routeSpanM.toLaneFloat())
            putFloat(frame.remoteTilt?.toDouble().toLaneFloat())
            putFloat(frame.tiltControl.wire.toFloat())
        }.array() + WatchTrailCodec.encode(frame.trail, frame.mapPosition)

    private fun Double?.toLaneFloat(): Float = this?.toFloat() ?: Float.NaN
}
