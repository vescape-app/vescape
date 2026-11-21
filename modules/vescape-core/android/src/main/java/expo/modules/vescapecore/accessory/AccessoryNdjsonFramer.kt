package expo.modules.vescapecore.accessory

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * @parity /modules/vescape-core/ios/accessory/AccessoryNdjsonFramer.swift `AccessoryFramingError`
 * @parity /modules/vescape-core/src/index.ts `AccessoryInspectionError`
 */
enum class AccessoryFramingError(val wire: String) {
    OVERSIZED("oversized"),
    INVALID_UTF8("invalid-utf8"),
}

data class AccessoryFramingResult(
    val lines: List<String>,
    val failure: AccessoryFramingError?,
)

/**
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

    val bufferedBytes: Int get() = length

    val failed: Boolean get() = failure != null

    fun feed(chunk: ByteArray): AccessoryFramingResult {
        failure?.let { return AccessoryFramingResult(emptyList(), it) }

        val lines = mutableListOf<String>()
        for (byte in chunk) {
            if (byte == LF) {
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

private const val INITIAL_CAPACITY = 256
