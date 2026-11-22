package expo.modules.vescapecore.config

import expo.modules.vescapecore.protocol.VescNumeric

/**
 * @parity /modules/vescape-core/ios/config/McconfDecoder.swift
 */
internal sealed interface McconfDecodeResult {
    data class Decoded(
        val signature: Long,
        val firmware: String,
        val values: Map<String, Double>,
    ) : McconfDecodeResult

    data class UnknownSignature(val signature: Long, val byteCount: Int) : McconfDecodeResult

    data class Malformed(val reason: String) : McconfDecodeResult
}

internal object McconfDecoder {
    fun decode(body: ByteArray): McconfDecodeResult {
        if (body.size < 4) {
            return McconfDecodeResult.Malformed("blob too short for a signature: ${body.size} bytes")
        }
        val signature = VescNumeric.uint32(body, 0)
        val layout = McconfLayouts.bySignature[signature]
            ?: return McconfDecodeResult.UnknownSignature(signature, body.size)

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
        McconfValueType.I16 -> VescNumeric.int16(bytes, field.offset).toDouble()
        McconfValueType.U32 -> VescNumeric.uint32(bytes, field.offset).toDouble()
        McconfValueType.I32 -> VescNumeric.int32(bytes, field.offset).toDouble()
        McconfValueType.F16 -> VescNumeric.int16(bytes, field.offset) / field.scale
        McconfValueType.F32Auto -> VescNumeric.float32Auto(bytes, field.offset)
    }
}
