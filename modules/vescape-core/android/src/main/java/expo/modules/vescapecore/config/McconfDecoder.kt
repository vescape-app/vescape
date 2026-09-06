package expo.modules.vescapecore.config

import expo.modules.vescapecore.protocol.VescNumeric

/**
 * Decodes a `COMM_GET_MCCONF` blob against the layout its signature identifies.
 *
 * The board serves no schema for motor config, so offsets come from tables generated from firmware's
 * own serializer (`McconfLayouts`). An unrecognized signature decodes nothing rather than guessing:
 * a plausible-looking wrong value is worse than an absent one (ADR 0036).
 *
 * @parity /modules/vescape-core/ios/config/McconfDecoder.swift
 */
internal sealed interface McconfDecodeResult {
    /** Signature resolved to a known layout and every field was read. */
    data class Decoded(
        val signature: Long,
        val firmware: String,
        val values: Map<String, Double>,
    ) : McconfDecodeResult

    /** Well-formed blob, but no layout carries this signature. Report it so a table can be added. */
    data class UnknownSignature(val signature: Long, val byteCount: Int) : McconfDecodeResult

    /** Blob too short to hold even a signature, or shorter than the layout it claims. */
    data class Malformed(val reason: String) : McconfDecodeResult
}

internal object McconfDecoder {
    /** @param body the response payload with its leading command byte already stripped. */
    fun decode(body: ByteArray): McconfDecodeResult {
        if (body.size < 4) {
            return McconfDecodeResult.Malformed("blob too short for a signature: ${body.size} bytes")
        }
        val signature = VescNumeric.uint32(body, 0)
        val layout = McconfLayouts.bySignature[signature]
            ?: return McconfDecodeResult.UnknownSignature(signature, body.size)

        // Exact, not "at least": a signature identifies one layout of one length. A longer blob means
        // the framing or the table is wrong, and decoding its prefix would return plausible garbage.
        if (body.size != layout.totalBytes) {
            return McconfDecodeResult.Malformed(
                "blob is ${body.size} bytes, layout ${layout.firmware} needs ${layout.totalBytes}",
            )
        }

        val values = HashMap<String, Double>(layout.fields.size)
        for (field in layout.fields) {
            values[field.id] = readValue(body, field)
        }
        return McconfDecodeResult.Decoded(signature, layout.firmware, values)
    }

    private fun readValue(bytes: ByteArray, field: McconfField): Double = when (field.type) {
        McconfValueType.U8 -> (bytes[field.offset].toInt() and 0xff).toDouble()
        McconfValueType.U16 -> VescNumeric.uint16(bytes, field.offset).toDouble()
        McconfValueType.U32 -> VescNumeric.uint32(bytes, field.offset).toDouble()
        McconfValueType.I32 -> VescNumeric.int32(bytes, field.offset).toDouble()
        McconfValueType.F16 -> VescNumeric.int16(bytes, field.offset) / field.scale
        McconfValueType.F32Auto -> VescNumeric.float32Auto(bytes, field.offset)
    }
}
