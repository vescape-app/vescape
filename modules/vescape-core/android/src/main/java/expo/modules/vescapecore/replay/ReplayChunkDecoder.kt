package expo.modules.vescapecore.replay

import expo.modules.vescapecore.protocol.BmsTelemetry
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.protocol.parseBmsValues

import org.json.JSONObject
import java.util.Base64

/** One recorded incoming BLE chunk: milliseconds since recording start plus the raw bytes. */
internal data class ReplayChunk(val t: Long, val bytes: ByteArray)

/**
 * One recorded GPS fix, replayed in place of the phone's own. A replay reproduces the ride that was
 * recorded, and position is the centre of that ride — so the recording owns it outright.
 *
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
 * One recorded compass reading, replayed in place of the phone's own magnetometer. The phone that
 * plays a recording back is usually lying still on a desk, so without these the heading cone and
 * Compass follow have nothing real to read.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayChunkDecoder.swift `ReplayHeading`
 */
internal data class ReplayHeading(val t: Long, val headingDeg: Double)

/**
 * Pure decode core for Debug Recording replay (ADR 0024): turns a `.jsonl` Debug Recording into the
 * byte stream and decoded frames the session stack originally saw. Shared by the unit replay
 * harness (test source) and the dev-mode ReplayTransport. `ble-chunk` lines with
 * `direction == "rx"` carry the board stream and `location` lines carry the ride's GPS track;
 * every other kind (meta, session-state, tx traffic) and any malformed line — real recordings can
 * end mid-write — is skipped, never fatal.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayChunkDecoder.swift
 */
internal object ReplayChunkDecoder {
    /** Recorded `rx` chunks in file order with their recorded time offsets. */
    fun rxChunks(jsonl: String): List<ReplayChunk> =
        jsonl.lineSequence().mapNotNull { line ->
            if (line.isBlank()) return@mapNotNull null
            try {
                val json = JSONObject(line)
                if (json.optString("kind") != "ble-chunk") return@mapNotNull null
                if (json.optString("direction") != "rx") return@mapNotNull null
                ReplayChunk(
                    t = json.getLong("t"),
                    bytes = Base64.getDecoder().decode(json.getString("base64")),
                )
            } catch (e: Exception) {
                null
            }
        }.toList()

    /** Recorded GPS fixes in file order with their recorded time offsets. */
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

    /** Recorded compass readings in file order with their recorded time offsets. */
    fun headings(jsonl: String): List<ReplayHeading> =
        jsonl.lineSequence().mapNotNull { line ->
            if (line.isBlank()) return@mapNotNull null
            try {
                val json = JSONObject(line)
                if (json.optString("kind") != "phone-heading") return@mapNotNull null
                ReplayHeading(t = json.getLong("t"), headingDeg = json.getDouble("headingDeg"))
            } catch (e: Exception) {
                null
            }
        }.toList()

    private fun JSONObject.optDoubleOrNull(key: String): Double? =
        if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

    /**
     * Decoded smart-BMS frames with the recorded chunk time as `capturedAt`, produced by running the
     * recorded `rx` bytes through the real packet reassembler and BMS parser.
     */
    fun bmsFrames(jsonl: String): List<BmsTelemetry> {
        val reassembler = VescPacketReassembler()
        return rxChunks(jsonl).flatMap { chunk ->
            reassembler.feed(chunk.bytes).mapNotNull { packet -> parseBmsValues(packet, chunk.t) }
        }
    }
}
