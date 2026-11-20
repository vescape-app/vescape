package expo.modules.vescapecore.replay

import expo.modules.vescapecore.config.RefloatConfigProtocol
import expo.modules.vescapecore.config.RefloatConfigProtocolResult
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.COMM_BMS_GET_VALUES
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_FW_VERSION
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_GET_MCCONF
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_LIGHTS_CONTROL
import expo.modules.vescapecore.protocol.REFLOAT_LIGHTS_CONTROL_LEGACY
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.protocol.parseFwVersion

import org.json.JSONObject

/** One payload at its recorded offset. */
internal class TimedPayload(val t: Long, val payload: ByteArray)

/**
 * What plays on a [SimulatedBoard]'s timeline, by recorded offset.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayRecording.swift `ReplayEvent`
 */
internal sealed class ReplayEvent(val t: Long) {
    /** A board frame nothing asked for, or one the app polls for: telemetry, BMS, anything unknown. */
    class Frame(t: Long, val payload: ByteArray) : ReplayEvent(t)

    class Fix(val fix: ReplayLocation) : ReplayEvent(fix.t)

    /** A config write the app made during the recorded ride; the board holds it from here on. */
    class ConfigWrite(t: Long, val payload: ByteArray) : ReplayEvent(t)
}

/**
 * The hardware a recording was made on. A replay presents it as the Board's link, so Link Integrity
 * judges the recorded board on its own answers (ADR 0048).
 *
 * @parity /modules/vescape-core/ios/replay/ReplayRecording.swift `RecordedHardware`
 */
internal data class RecordedHardware(
    val deviceId: String?,
    val transport: BoardTransport,
    val firmware: String?,
    val refloatVersion: String?,
    val hasBms: Boolean,
    val pollIntervalMs: Long?,
)

/**
 * The replies a recording holds, indexed by what they answer rather than paired with the request
 * that produced them: replies describe themselves in their header, while the app asks at different
 * moments than the recorded session did.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayRecording.swift `ReplyBook`
 */
internal class ReplyBook(
    val firmware: ByteArray?,
    val refloatInfo: ByteArray?,
    val motorConfig: ByteArray?,
    /** The custom config XML, reassembled from every chunk the recording saw, keyed by `confInd`. */
    val configXml: Map<Int, ByteArray>,
    /** Recorded `COMM_GET_CUSTOM_CONFIG` replies per `confInd`, in time order. */
    val configSnapshots: Map<Int, List<TimedPayload>>,
)

/**
 * A Debug Recording decoded for a [SimulatedBoard]: the hardware it was made on, the timeline the
 * board plays on its own, and the replies it gives when asked.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayRecording.swift
 */
internal class ReplayRecording(
    val name: String,
    val hardware: RecordedHardware,
    val timeline: List<ReplayEvent>,
    val replies: ReplyBook,
) {
    val durationMs: Long get() = timeline.lastOrNull()?.t ?: 0L

    companion object {
        fun parse(name: String, jsonl: String): ReplayRecording {
            val meta = jsonl.lineSequence().firstOrNull()?.let(::metaOrNull)
            val frames = mutableListOf<ReplayEvent>()
            var firmware: ByteArray? = null
            var refloatInfo: ByteArray? = null
            var motorConfig: ByteArray? = null
            var hasBms = false
            val xml = mutableMapOf<Int, XmlAssembly>()
            val snapshots = mutableMapOf<Int, MutableList<TimedPayload>>()

            val rx = VescPacketReassembler()
            for (chunk in ReplayChunkDecoder.rxChunks(jsonl)) {
                for (packet in rx.feed(chunk.bytes)) {
                    val payload = unwrapCan(packet) ?: continue
                    when (payload[0].toInt() and 0xff) {
                        COMM_FW_VERSION -> firmware = firmware ?: payload
                        COMM_GET_MCCONF -> motorConfig = motorConfig ?: payload
                        COMM_GET_CUSTOM_CONFIG_XML -> addXmlChunk(xml, payload)
                        COMM_GET_CUSTOM_CONFIG -> payload.getOrNull(1)?.let { confInd ->
                            snapshots.getOrPut(confInd.toInt() and 0xff) { mutableListOf() }
                                .add(TimedPayload(chunk.t, payload))
                        }
                        // Acks and echoes are the board's answers to this session's own writes.
                        COMM_SET_CUSTOM_CONFIG -> Unit
                        COMM_CUSTOM_APP_DATA -> when (refloatCommand(payload)) {
                            REFLOAT_GET_INFO -> refloatInfo = refloatInfo ?: payload
                            REFLOAT_LIGHTS_CONTROL, REFLOAT_LIGHTS_CONTROL_LEGACY -> Unit
                            else -> frames += ReplayEvent.Frame(chunk.t, payload)
                        }
                        else -> {
                            if ((payload[0].toInt() and 0xff) == COMM_BMS_GET_VALUES) hasBms = true
                            frames += ReplayEvent.Frame(chunk.t, payload)
                        }
                    }
                }
            }

            var recordedCanId: Int? = null
            val tx = VescPacketReassembler()
            for (chunk in ReplayChunkDecoder.txChunks(jsonl)) {
                for (packet in tx.feed(chunk.bytes)) {
                    if (packet.size >= 2 && (packet[0].toInt() and 0xff) == COMM_FORWARD_CAN) {
                        recordedCanId = recordedCanId ?: (packet[1].toInt() and 0xff)
                    }
                    val payload = unwrapCan(packet) ?: continue
                    if ((payload[0].toInt() and 0xff) == COMM_SET_CUSTOM_CONFIG) {
                        frames += ReplayEvent.ConfigWrite(chunk.t, payload)
                    }
                }
            }

            val fixes = ReplayChunkDecoder.locations(jsonl).map { ReplayEvent.Fix(it) }
            val transport = BoardTransport.decode(meta?.optString("transport")?.takeIf { it.isNotBlank() })
                ?: recordedCanId?.let { BoardTransport.Can(it) }
                ?: BoardTransport.Direct
            val refloatVersion = refloatInfo?.let {
                when (val result = RefloatConfigProtocol.parseGetInfoResponse(it)) {
                    is RefloatConfigProtocolResult.Success -> result.value.version
                    is RefloatConfigProtocolResult.Failure -> null
                }
            }
            return ReplayRecording(
                name = name,
                hardware = RecordedHardware(
                    deviceId = meta?.optString("deviceId")?.takeIf { it.isNotBlank() },
                    transport = transport,
                    firmware = firmware?.let(::parseFwVersion),
                    refloatVersion = refloatVersion,
                    hasBms = hasBms,
                    pollIntervalMs = meta?.optLong("pollIntervalMs")?.takeIf { it > 0 },
                ),
                // Stable: a fix and a frame at the same offset keep file order.
                timeline = (frames + fixes).sortedBy(ReplayEvent::t),
                replies = ReplyBook(
                    firmware = firmware,
                    refloatInfo = refloatInfo,
                    motorConfig = motorConfig,
                    configXml = xml.mapValues { it.value.bytes },
                    configSnapshots = snapshots,
                ),
            )
        }

        private fun metaOrNull(line: String): JSONObject? = try {
            JSONObject(line).takeIf { it.optString("kind") == "meta" }
        } catch (e: Exception) {
            null
        }

        /** Strip a `COMM_FORWARD_CAN` envelope; CAN boards usually answer unwrapped anyway. */
        fun unwrapCan(packet: ByteArray): ByteArray? {
            if (packet.isEmpty()) return null
            if ((packet[0].toInt() and 0xff) != COMM_FORWARD_CAN) return packet
            return if (packet.size > 2) packet.copyOfRange(2, packet.size) else null
        }

        fun refloatCommand(payload: ByteArray): Int? =
            if (
                payload.size >= 3 &&
                (payload[0].toInt() and 0xff) == COMM_CUSTOM_APP_DATA &&
                (payload[1].toInt() and 0xff) == REFLOAT_MAGIC
            ) payload[2].toInt() and 0xff
            else null

        private class XmlAssembly(total: Int) {
            val bytes = ByteArray(total)
        }

        private fun addXmlChunk(xml: MutableMap<Int, XmlAssembly>, payload: ByteArray) {
            val chunk = when (val result = RefloatConfigProtocol.parseCustomConfigXmlResponse(
                payload,
                expectedConfInd = payload.getOrNull(1)?.toInt()?.and(0xff) ?: return,
            )) {
                is RefloatConfigProtocolResult.Success -> result.value
                is RefloatConfigProtocolResult.Failure -> return
            }
            val assembly = xml[chunk.confInd]?.takeIf { it.bytes.size == chunk.totalLength }
                ?: XmlAssembly(chunk.totalLength).also { xml[chunk.confInd] = it }
            chunk.chunk.copyInto(assembly.bytes, destinationOffset = chunk.offset)
        }
    }
}
