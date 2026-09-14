package expo.modules.vescapecore.accessory

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * Why framing ended the protocol session. Both are terminal: the transport disconnects and clears
 * its buffers rather than trying to resynchronise mid-stream.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryNdjsonFramer.swift `AccessoryFramingError`
 * @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
 */
enum class AccessoryFramingError(val wire: String) {
    OVERSIZED("oversized"),
    INVALID_UTF8("invalid-utf8"),
}

/** Lines completed by one chunk, plus the failure that ended the stream if one did. */
data class AccessoryFramingResult(
    val lines: List<String>,
    val failure: AccessoryFramingError?,
)

/**
 * Newline-delimited JSON reassembly for the Accessory link. BLE packet boundaries are not message
 * boundaries: one notification can carry half a line, several lines, or a byte that finishes a
 * multi-byte character started in the previous one.
 *
 * Bounded by construction. The buffer can never hold more than [maxLineBytes]: the byte that would
 * take it past the limit fails the stream instead of being appended, so a peer that never sends an
 * LF costs a fixed 4 KB rather than growing until the process dies. A failure is terminal — the
 * buffer is dropped and every later chunk is refused, because a stream that lost its framing has no
 * trustworthy next boundary.
 *
 * UTF-8 is validated per complete line, after reassembly, never per chunk.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryNdjsonFramer.swift
 */
class AccessoryNdjsonFramer(
    private val maxLineBytes: Int = AccessoryProtocol.MAX_LINE_BYTES,
) {
    private companion object {
        const val LF = '\n'.code.toByte()
    }

    private var buffer = ByteArray(minOf(INITIAL_CAPACITY, maxLineBytes))
    private var length = 0
    private var failure: AccessoryFramingError? = null

    /** Bytes currently held for the line being assembled. Never exceeds `maxLineBytes`. */
    val bufferedBytes: Int get() = length

    val failed: Boolean get() = failure != null

    fun feed(chunk: ByteArray): AccessoryFramingResult {
        failure?.let { return AccessoryFramingResult(emptyList(), it) }

        val lines = mutableListOf<String>()
        for (byte in chunk) {
            if (byte == LF) {
                // An empty line is framing, not a message: the protocol sends one object per line,
                // so a stray LF carries nothing to decode.
                if (length > 0) {
                    val decoded = decode(buffer, length)
                    length = 0
                    if (decoded == null) return fail(lines, AccessoryFramingError.INVALID_UTF8)
                    lines.add(decoded)
                }
                continue
            }
            if (length == maxLineBytes) return fail(lines, AccessoryFramingError.OVERSIZED)
            if (length == buffer.size) buffer = buffer.copyOf(minOf(buffer.size * 2, maxLineBytes))
            buffer[length++] = byte
        }
        return AccessoryFramingResult(lines, null)
    }

    /** Drops everything held. Called on disconnect so a new session starts with no old bytes. */
    fun reset() {
        length = 0
        failure = null
        buffer = ByteArray(minOf(INITIAL_CAPACITY, maxLineBytes))
    }

    private fun fail(
        lines: List<String>,
        error: AccessoryFramingError,
    ): AccessoryFramingResult {
        failure = error
        length = 0
        buffer = ByteArray(0)
        return AccessoryFramingResult(lines, error)
    }

    /** Strict UTF-8: a malformed sequence is an error, never a replacement character. */
    private fun decode(bytes: ByteArray, count: Int): String? {
        val decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return try {
            decoder.decode(ByteBuffer.wrap(bytes, 0, count)).toString()
        } catch (e: Exception) {
            null
        }
    }
}

/** A line's worth of buffer is rare; most messages are a few hundred bytes. */
private const val INITIAL_CAPACITY = 256
