package expo.modules.vescapecore.watch

import java.nio.BufferUnderflowException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrameCodec`
 */
internal const val WATCH_RIDE_NOTICES_PATH = "/ride-notices"

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `WATCH_RIDE_NOTICES_VERSION` */
internal const val WATCH_RIDE_NOTICES_VERSION = 1

/**
 * @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RIDE_NOTICE_FRAME_MAX_NOTICES`
 */
internal const val RIDE_NOTICE_FRAME_MAX_NOTICES = 16

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrameSeverity` */
internal enum class RideNoticeFrameSeverity(val wire: Int) {
    CRITICAL(0),
    WARNING(1),
    INFO(2);

    companion object {
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
    val expiresAtMs: Long?,
)

/** @parity /modules/vescape-core/ios/watch/RideNoticeFrame.swift `RideNoticeFrame` */
internal data class RideNoticeFrame(
    val sentAtMs: Long,
    val notices: List<RideNoticeFrameItem>,
)

private const val MAX_TITLE_BYTES = 96
private const val MAX_DETAILS_BYTES = 512

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
