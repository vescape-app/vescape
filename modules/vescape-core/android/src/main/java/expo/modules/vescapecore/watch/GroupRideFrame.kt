package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.TelemetryLevel
import java.nio.BufferUnderflowException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.hypot

/**
 * Group Ride Frame wire contract (ADR-0039): the joined Group Ride as the wrist draws it, pushed
 * about once a second on its own [MessageClient][com.google.android.gms.wearable.MessageClient]
 * path, independent of the Watch Frame.
 *
 * This file is the codec for **both** ends on Android: the phone compiles it here and
 * `plugins/withWearMirror.ts` copies it into the Wear OS Mirror, so encoder and decoder cannot
 * drift. It must stay pure Kotlin — no Android or Play-services imports.
 *
 * Layout, little-endian:
 * ```
 * u8  version            WATCH_GROUP_RIDE_VERSION
 * f32 courseDeg          the Rider's own course, degrees clockwise from north; NaN = none yet
 * f32 spanM              horizontal metres the phone map shows
 * u8  riderCount
 * per rider:
 *   u8  recordBytes      length of the rest of this record
 *   u8  idBytes, utf8 id
 *   u8  nameBytes, utf8 name
 *   u32 colorArgb
 *   f32 eastM, f32 northM   offset from the Rider's latest GPS Fix
 *   u8  flags            bit 0 = stale
 *   u8  batteryPercent   0-100 Battery SoC Estimate; 0xFF = none (no Board Session, or unknown)
 *   u8  batteryLevel     TelemetryLevel.wire: 0 normal, 1 warning, 2 critical
 *   u8  heatLevel        TelemetryLevel.wire, the worse of motor and controller temperature
 *   ...                  later fields are appended here; a decoder skips what it does not know
 * ```
 *
 * Versioning: a new field is appended to the rider record and read only when `recordBytes` covers
 * it, so older wrists keep decoding. [WATCH_GROUP_RIDE_VERSION] moves only for a change an older
 * decoder must not read, which it then ignores whole. An older phone never sends this path.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrameCodec`
 */
internal const val WATCH_GROUP_RIDE_PATH = "/group-ride"

/** @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `WATCH_GROUP_RIDE_VERSION` */
internal const val WATCH_GROUP_RIDE_VERSION = 1

/**
 * One other Rider, placed relative to the Rider wearing the watch.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrameRider`
 */
internal data class GroupRideFrameRider(
    val id: String,
    val name: String,
    /** Opaque ARGB, already resolved phone-side (chosen colour or roster fallback). */
    val colorArgb: Int,
    /** Metres east of the Rider's latest GPS Fix. */
    val eastM: Double,
    /** Metres north of the Rider's latest GPS Fix. */
    val northM: Double,
    /** No presence from this Rider for a while; still in the Group Ride. */
    val stale: Boolean,
    /** Battery SoC Estimate, 0-100. Null: no Board Session, or a phone too old to send it. */
    val batteryPercent: Int? = null,
    /** Level of the Battery SoC Estimate, from the phone's telemetry thresholds. */
    val batteryLevel: TelemetryLevel = TelemetryLevel.NORMAL,
    /** The worse of the Rider's motor and controller temperature levels. */
    val heatLevel: TelemetryLevel = TelemetryLevel.NORMAL,
) {
    /** Straight-line metres from the Rider. */
    val distanceM: Double get() = hypot(eastM, northM)
}

/** @parity /modules/vescape-core/ios/watch/GroupRideFrame.swift `GroupRideFrame` */
internal data class GroupRideFrame(
    /** The Rider's own course, degrees clockwise from north. Null until a fix carries one. */
    val courseDeg: Double?,
    /** Horizontal metres the phone map shows; the wrist uses the same world span. */
    val spanM: Double,
    /** Every other Rider with a position. Never the Rider themself. */
    val riders: List<GroupRideFrameRider>,
)

/** Longest id and name kept on the wire, in UTF-8 bytes. */
private const val MAX_ID_BYTES = 64
private const val MAX_NAME_BYTES = 32
private const val FLAG_STALE = 1
private const val NO_BATTERY = 0xFF

/** Fixed part of a rider record after the two strings: colour, east, north, flags, battery, levels. */
private const val RIDER_FIXED_BYTES = 4 + 4 + 4 + 1 + 1 + 1 + 1

/**
 * Most Riders one frame carries; the builder keeps the nearest.
 *
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

    /** Null for another wire version or a malformed payload: the wrist then draws no group. */
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
                // Appended after the first release: an older phone's record ends before them.
                val battery = if (buffer.position() < end) buffer.get().toInt() and 0xFF else NO_BATTERY
                val batteryLevel = if (buffer.position() < end) buffer.get().toInt() and 0xFF else 0
                val heatLevel = if (buffer.position() < end) buffer.get().toInt() and 0xFF else 0
                // Fields a newer phone appended: not ours to read.
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

    /** The longest prefix of [value] that fits [maxBytes] of UTF-8 without splitting a character. */
    private fun utf8Prefix(value: String, maxBytes: Int): ByteArray {
        val bytes = value.toByteArray(Charsets.UTF_8)
        if (bytes.size <= maxBytes) return bytes
        var end = maxBytes
        // Back off continuation bytes (10xxxxxx) so the cut lands on a character boundary.
        while (end > 0 && bytes[end].toInt() and 0xC0 == 0x80) end--
        return bytes.copyOf(end)
    }
}
