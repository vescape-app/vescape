package expo.modules.vescapecore.watch

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Live route state, separate from telemetry so older watch builds keep decoding their frames.
 * Compiled by both the Android phone and wrist. Version, phase, uint32 route fingerprint (LE).
 * @parity /modules/vescape-core/ios/watch/WatchRouteStatus.swift
 */
const val WATCH_ROUTE_STATUS_PATH = "/route-status"

enum class WatchRoutePhase(val wire: Int) { IDLE(0), COMPUTING(1), READY(2), FAILED(3) }
enum class WatchRouteNotice { COMPUTING, RECEIVING, LOCATION, FAILED }

data class WatchRouteStatus(val phase: WatchRoutePhase, val routeId: Long = 0) {
    fun notice(receivedRouteId: Long?, hasPosition: Boolean): WatchRouteNotice? = when {
        phase == WatchRoutePhase.COMPUTING -> WatchRouteNotice.COMPUTING
        phase == WatchRoutePhase.FAILED -> WatchRouteNotice.FAILED
        phase != WatchRoutePhase.READY -> null
        routeId == 0L || receivedRouteId != routeId -> WatchRouteNotice.RECEIVING
        !hasPosition -> WatchRouteNotice.LOCATION
        else -> null
    }

    fun canDraw(receivedRouteId: Long?): Boolean =
        phase == WatchRoutePhase.READY && routeId != 0L && receivedRouteId == routeId
}

object WatchRouteStatusCodec {
    fun encode(status: WatchRouteStatus): ByteArray = ByteBuffer.allocate(6).order(ByteOrder.LITTLE_ENDIAN)
        .put(1).put(status.phase.wire.toByte()).putInt(status.routeId.toInt()).array()

    fun decode(bytes: ByteArray): WatchRouteStatus? {
        if (bytes.size != 6 || bytes[0].toInt() != 1) return null
        val phase = WatchRoutePhase.entries.firstOrNull { it.wire == bytes[1].toInt() } ?: return null
        return WatchRouteStatus(phase, ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).getInt(2).toLong() and 0xffffffffL)
    }

    /** FNV-1a of the exact transferred bytes. Zero is reserved for no route. */
    fun routeId(bytes: ByteArray): Long {
        var hash = 2166136261L
        for (byte in bytes) hash = ((hash xor (byte.toLong() and 255)) * 16777619L) and 0xffffffffL
        return hash.takeIf { it != 0L } ?: 1L
    }
}
