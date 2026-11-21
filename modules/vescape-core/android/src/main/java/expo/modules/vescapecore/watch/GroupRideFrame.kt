package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryLevel
import java.nio.BufferUnderflowException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.hypot

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrameCodec`
 */
internal const val WATCH_GROUP_RIDE_PATH = "/group-ride"

/** @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `WATCH_GROUP_RIDE_VERSION` */
internal const val WATCH_GROUP_RIDE_VERSION = 1

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrameRider`
 */
internal data class GroupRideFrameRider(
    val id: String,
    val name: String,
    val colorArgb: Int,
    val eastM: Double,
    val northM: Double,
    val stale: Boolean,
    val batteryPercent: Int? = null,
    val batteryLevel: TelemetryLevel = TelemetryLevel.NORMAL,
    val heatLevel: TelemetryLevel = TelemetryLevel.NORMAL,
) {
    val distanceM: Double get() = hypot(eastM, northM)
}

/** @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrame` */
internal data class GroupRideFrame(
    val courseDeg: Double?,
    val spanM: Double,
    val riders: List<GroupRideFrameRider>,
)

private const val MAX_ID_BYTES = 64
private const val MAX_NAME_BYTES = 32
private const val FLAG_STALE = 1
private const val NO_BATTERY = 0xFF

private const val RIDER_FIXED_BYTES = 4 + 4 + 4 + 1 + 1 + 1 + 1

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GROUP_RIDE_FRAME_MAX_RIDERS`
 */
internal const val GROUP_RIDE_FRAME_MAX_RIDERS = 32

/** @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrameCodec` */
internal object GroupRideFrameCodec {
    fun encode(frame: GroupRideFrame): ByteArray {
        val riders = frame.riders.take(GROUP_RIDE_FRAME_MAX_RIDERS).map { rider ->
            Triple(rider, utf8Prefix(rider.id, MAX_ID_BYTES), utf8Prefix(rider.name, MAX_NAME_BYTES))
        }
        val size = 1 + 4 + 4 + 1 + riders.sumOf { (_, id, name) -> 1 + 1 + id.size + 1 + name.size + RIDER_FIXED_BYTES }
        return ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(WATCH_GROUP_RIDE_VERSION.toByte())
            putFloat(frame.courseDeg?.toFloat() ?: Float.NaN)
            putFloat(frame.spanM.toFloat())
            put(riders.size.toByte())
            for ((rider, id, name) in riders) {
                put((1 + id.size + 1 + name.size + RIDER_FIXED_BYTES).toByte())
                put(id.size.toByte())
                put(id)
                put(name.size.toByte())
                put(name)
                putInt(rider.colorArgb)
                putFloat(rider.eastM.toFloat())
                putFloat(rider.northM.toFloat())
                put((if (rider.stale) FLAG_STALE else 0).toByte())
                put((rider.batteryPercent?.coerceIn(0, 100) ?: NO_BATTERY).toByte())
                put(rider.batteryLevel.wire.toByte())
                put(rider.heatLevel.wire.toByte())
            }
        }.array()
    }

    fun decode(bytes: ByteArray): GroupRideFrame? {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        return try {
            if (buffer.get().toInt() and 0xFF != WATCH_GROUP_RIDE_VERSION) return null
            val course = buffer.float.takeUnless { it.isNaN() }?.toDouble()
            val span = buffer.float.toDouble()
            if (!span.isFinite() || span <= 0.0) return null
            val count = buffer.get().toInt() and 0xFF
            val riders = List(count) {
                val recordBytes = buffer.get().toInt() and 0xFF
                val end = buffer.position() + recordBytes
                if (end > buffer.limit()) return null
                val id = readString(buffer)
                val name = readString(buffer)
                val color = buffer.int
                val east = buffer.float.toDouble()
                val north = buffer.float.toDouble()
                val flags = buffer.get().toInt()
                if (buffer.position() > end || !east.isFinite() || !north.isFinite()) return null
                val battery = if (buffer.position() < end) buffer.get().toInt() and 0xFF else NO_BATTERY
                val batteryLevel = if (buffer.position() < end) buffer.get().toInt() and 0xFF else 0
                val heatLevel = if (buffer.position() < end) buffer.get().toInt() and 0xFF else 0
                buffer.position(end)
                GroupRideFrameRider(
                    id,
                    name,
                    color,
                    east,
                    north,
                    stale = flags and FLAG_STALE != 0,
                    batteryPercent = battery.takeIf { it <= 100 },
                    batteryLevel = TelemetryLevel.fromWire(batteryLevel),
                    heatLevel = TelemetryLevel.fromWire(heatLevel),
                )
            }
            GroupRideFrame(course, span, riders)
        } catch (_: BufferUnderflowException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun readString(buffer: ByteBuffer): String {
        val length = buffer.get().toInt() and 0xFF
        val bytes = ByteArray(length)
        buffer.get(bytes)
        return String(bytes, Charsets.UTF_8)
    }
}

internal fun utf8Prefix(value: String, maxBytes: Int): ByteArray {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size <= maxBytes) return bytes
    var end = maxBytes
    while (end > 0 && bytes[end].toInt() and 0xC0 == 0x80) end--
    return bytes.copyOf(end)
}
