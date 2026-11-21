package expo.modules.vescapecore.replay

import expo.modules.vescapecore.protocol.BmsTelemetry
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.protocol.parseBmsValues

import org.json.JSONObject
import java.util.Base64

internal data class ReplayChunk(val t: Long, val bytes: ByteArray)

/**
 * @parity /modules/vescape-core/ios/replay/ReplayChunkDecoder.swift `ReplayLocation`
 */
internal data class ReplayLocation(
    val t: Long,
    val latitude: Double,
    val longitude: Double,
    val speedMps: Float?,
    val bearingDeg: Float?,
    val accuracyM: Float?,
    val altitudeM: Double?,
)

/**
 * @parity /modules/vescape-core/ios/replay/ReplayChunkDecoder.swift
 */
internal object ReplayChunkDecoder {
    fun rxChunks(jsonl: String): List<ReplayChunk> = chunks(jsonl, "rx")

    fun txChunks(jsonl: String): List<ReplayChunk> = chunks(jsonl, "tx")

    private fun chunks(jsonl: String, direction: String): List<ReplayChunk> =
        jsonl.lineSequence().mapNotNull { line ->
            if (line.isBlank()) return@mapNotNull null
            try {
                val json = JSONObject(line)
                if (json.optString("kind") != "ble-chunk") return@mapNotNull null
                if (json.optString("direction") != direction) return@mapNotNull null
                ReplayChunk(
                    t = json.getLong("t"),
                    bytes = Base64.getDecoder().decode(json.getString("base64")),
                )
            } catch (e: Exception) {
                null
            }
        }.toList()

    fun locations(jsonl: String): List<ReplayLocation> =
        jsonl.lineSequence().mapNotNull { line ->
            if (line.isBlank()) return@mapNotNull null
            try {
                val json = JSONObject(line)
                if (json.optString("kind") != "location") return@mapNotNull null
                ReplayLocation(
                    t = json.getLong("t"),
                    latitude = json.getDouble("latitude"),
                    longitude = json.getDouble("longitude"),
                    speedMps = json.optDoubleOrNull("speedMps")?.toFloat(),
                    bearingDeg = json.optDoubleOrNull("bearingDeg")?.toFloat(),
                    accuracyM = json.optDoubleOrNull("accuracyM")?.toFloat(),
                    altitudeM = json.optDoubleOrNull("altitudeM"),
                )
            } catch (e: Exception) {
                null
            }
        }.toList()

    private fun JSONObject.optDoubleOrNull(key: String): Double? =
        if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

    fun bmsFrames(jsonl: String): List<BmsTelemetry> {
        val reassembler = VescPacketReassembler()
        return rxChunks(jsonl).flatMap { chunk ->
            reassembler.feed(chunk.bytes).mapNotNull { packet -> parseBmsValues(packet, chunk.t) }
        }
    }
}
