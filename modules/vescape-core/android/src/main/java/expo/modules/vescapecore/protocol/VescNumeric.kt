package expo.modules.vescapecore.protocol

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Big-endian readers for VESC's wire encodings, shared by every config and telemetry decoder.
 *
 * @parity /modules/vescape-core/ios/protocol/VescNumeric.swift
 */
internal object VescNumeric {
    fun uint16(bytes: ByteArray, offset: Int): Int =
        ByteBuffer.wrap(bytes, offset, 2).order(ByteOrder.BIG_ENDIAN).short.toInt() and 0xffff

    fun int16(bytes: ByteArray, offset: Int): Int =
        ByteBuffer.wrap(bytes, offset, 2).order(ByteOrder.BIG_ENDIAN).short.toInt()

    fun int32(bytes: ByteArray, offset: Int): Int =
        ByteBuffer.wrap(bytes, offset, 4).order(ByteOrder.BIG_ENDIAN).int

    fun uint32(bytes: ByteArray, offset: Int): Long = int32(bytes, offset).toLong() and 0xffffffffL

    /**
     * VESC's `buffer_get_float32_auto`: a packed sign/exponent/mantissa form that is deliberately
     * not IEEE-754. Ported from upstream `util/buffer.c`.
     */
    fun float32Auto(bytes: ByteArray, offset: Int): Double {
        val raw = int32(bytes, offset)
        val eRaw = (raw ushr 23) and 0xff
        val sigI = raw and 0x7fffff
        val neg = (raw ushr 31) != 0
        if (eRaw == 0 && sigI == 0) return 0.0
        val sig = sigI / (8388608.0 * 2.0) + 0.5
        val result = sig * Math.pow(2.0, (eRaw - 126).toDouble())
        return if (neg) -result else result
    }
}
