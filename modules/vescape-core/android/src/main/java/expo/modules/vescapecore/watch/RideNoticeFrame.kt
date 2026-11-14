package expo.modules.vescapecore.watch

import java.nio.BufferUnderflowException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Ride Notice Frame wire contract: the phone's full visible Ride Notice list, retained on the wrist
 * across disconnects and rewritten on every phone start, so a stale list never outlives the phone
 * process that posted it.
 *
 * This file is the codec for **both** ends on Android: the phone compiles it here and
 * `plugins/wearSharedSources.ts` copies it into the Wear OS Mirror, so encoder and decoder cannot
 * drift. It must stay pure Kotlin — no Android or Play-services imports.
 *
 * Layout, little-endian:
 * ```
 * u8  version            WATCH_RIDE_NOTICES_VERSION
 * i64 sentAtMs           phone wall clock at encode; the wrist ignores a frame older than its last
 * u8  noticeCount
 * per notice:
 *   u16 recordBytes      length of the rest of this record
 *   u8  id               1-255, the notice's address for a wrist command
 *   u8  rev              1-255, bumped by every new revision
 *   u8  severity         RideNoticeFrameSeverity.wire: 0 critical, 1 warning, 2 info
 *   i64 expiresAtMs      phone wall clock; 0 = never
 *   u8  titleBytes, utf8 title
 *   u16 detailsBytes, utf8 details
 *   ...                  later fields are appended here; a decoder skips what it does not know
 * ```
 *
 * Versioning as the Group Ride Frame: a new field is appended to the notice record and read only
 * when `recordBytes` covers it. [WATCH_RIDE_NOTICES_VERSION] moves only for a change an older wrist
 * must not read, which it then ignores whole.
 *
 * @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrameCodec`
 */
internal const val WATCH_RIDE_NOTICES_PATH = "/ride-notices"

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `WATCH_RIDE_NOTICES_VERSION` */
internal const val WATCH_RIDE_NOTICES_VERSION = 1

/**
 * Most notices one frame carries; the list is ordered most urgent first, so the cut drops the least.
 *
 * @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RIDE_NOTICE_FRAME_MAX_NOTICES`
 */
internal const val RIDE_NOTICE_FRAME_MAX_NOTICES = 16

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrameSeverity` */
internal enum class RideNoticeFrameSeverity(val wire: Int) {
    CRITICAL(0),
    WARNING(1),
    INFO(2);

    companion object {
        /** A severity a newer phone added reads as a warning: loud enough, never mistaken for critical. */
        fun fromWire(value: Int): RideNoticeFrameSeverity = entries.firstOrNull { it.wire == value } ?: WARNING
    }
}

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrameItem` */
internal data class RideNoticeFrameItem(
    val id: Int,
    val rev: Int,
    val severity: RideNoticeFrameSeverity,
    val title: String,
    val details: String,
    /** Phone wall clock epoch ms; null = until the phone clears it. */
    val expiresAtMs: Long?,
)

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrame` */
internal data class RideNoticeFrame(
    val sentAtMs: Long,
    /** Visible notices, most urgent first. */
    val notices: List<RideNoticeFrameItem>,
)

private const val MAX_TITLE_BYTES = 96
private const val MAX_DETAILS_BYTES = 512

/** Fixed part of a notice record outside the two strings: id, rev, severity, expiry, length prefixes. */
private const val NOTICE_FIXED_BYTES = 1 + 1 + 1 + 8 + 1 + 2

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrameCodec` */
internal object RideNoticeFrameCodec {
    fun encode(frame: RideNoticeFrame): ByteArray {
        val notices = frame.notices.take(RIDE_NOTICE_FRAME_MAX_NOTICES).map { notice ->
            Triple(notice, utf8Prefix(notice.title, MAX_TITLE_BYTES), utf8Prefix(notice.details, MAX_DETAILS_BYTES))
        }
        val size = 1 + 8 + 1 + notices.sumOf { (_, title, details) -> 2 + NOTICE_FIXED_BYTES + title.size + details.size }
        return ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(WATCH_RIDE_NOTICES_VERSION.toByte())
            putLong(frame.sentAtMs)
            put(notices.size.toByte())
            for ((notice, title, details) in notices) {
                putShort((NOTICE_FIXED_BYTES + title.size + details.size).toShort())
                put(notice.id.toByte())
                put(notice.rev.toByte())
                put(notice.severity.wire.toByte())
                putLong(notice.expiresAtMs ?: 0L)
                put(title.size.toByte())
                put(title)
                putShort(details.size.toShort())
                put(details)
            }
        }.array()
    }

    /** Null for another wire version or a malformed payload: the wrist then keeps what it holds. */
    fun decode(bytes: ByteArray): RideNoticeFrame? {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        return try {
            if (buffer.get().toInt() and 0xFF != WATCH_RIDE_NOTICES_VERSION) return null
            val sentAtMs = buffer.long
            val count = buffer.get().toInt() and 0xFF
            val notices = List(count) {
                val recordBytes = buffer.short.toInt() and 0xFFFF
                val end = buffer.position() + recordBytes
                if (end > buffer.limit()) return null
                val id = buffer.get().toInt() and 0xFF
                val rev = buffer.get().toInt() and 0xFF
                val severity = buffer.get().toInt() and 0xFF
                val expiresAtMs = buffer.long
                val title = readString(buffer, buffer.get().toInt() and 0xFF)
                val details = readString(buffer, buffer.short.toInt() and 0xFFFF)
                if (buffer.position() > end) return null
                // Fields a newer phone appended: not ours to read.
                buffer.position(end)
                RideNoticeFrameItem(
                    id, rev, RideNoticeFrameSeverity.fromWire(severity), title, details,
                    expiresAtMs = expiresAtMs.takeIf { it != 0L },
                )
            }
            RideNoticeFrame(sentAtMs, notices)
        } catch (_: BufferUnderflowException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun readString(buffer: ByteBuffer, length: Int): String {
        val bytes = ByteArray(length)
        buffer.get(bytes)
        return String(bytes, Charsets.UTF_8)
    }
}
