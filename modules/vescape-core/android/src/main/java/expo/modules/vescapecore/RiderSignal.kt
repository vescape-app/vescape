package expo.modules.vescapecore

import org.json.JSONObject

/**
 * The fixed **Rider Signal** kinds, by their relay wire name.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 * @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KINDS`
 */
internal enum class RiderSignalKind(val wire: String, val label: String) {
    // Labels title Ride Notices.
    // @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KIND_INFO`
    BOARD("board", "Board problem"),
    BATTERY("battery", "Out of battery"),
    DOWN("down", "Rider down"),
    WAIT("wait", "Wait for me"),
    HELP("help", "Need help");

    /** A call for help rather than a heads-up; it wins when several signals cue at once. */
    val critical: Boolean get() = this == DOWN || this == HELP

    companion object {
        fun fromWire(wire: String?): RiderSignalKind? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * A Rider's active signal as the relay stamps it. Times are relay epoch ms: compare them against
 * the roster's relay `now`, never the phone clock.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignal`
 * @parity /modules/vescape-core/src/index.ts `GroupRideSignal`
 */
internal data class RiderSignal(
    val kind: RiderSignalKind,
    val lat: Double,
    val lng: Double,
    val startedAt: Long,
    val expiresAt: Long,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "kind" to kind.wire,
        "lat" to lat,
        "lng" to lng,
        "startedAt" to startedAt,
        "expiresAt" to expiresAt,
    )

    companion object {
        /** Null when absent, of an unknown kind, or missing a coordinate or time. */
        fun parse(obj: JSONObject?): RiderSignal? {
            obj ?: return null
            val kind = RiderSignalKind.fromWire(obj.optString("kind")) ?: return null
            val lat = obj.optDouble("lat").takeIf { it.isFinite() } ?: return null
            val lng = obj.optDouble("lng").takeIf { it.isFinite() } ?: return null
            if (!obj.has("startedAt") || !obj.has("expiresAt")) return null
            return RiderSignal(kind, lat, lng, obj.optLong("startedAt"), obj.optLong("expiresAt"))
        }
    }
}

/**
 * What the device knows when the Rider asks to send a signal. [fix] is the latest GPS fix no older
 * than [RiderSignals.FIX_MAX_AGE_MS]; [insidePrivacyZone] is also true while zones have not loaded.
 * A send ignores [insidePrivacyZone]: it is an explicit opt-in to share that spot (ADR-0020). The
 * flag only drives the picker's location warning.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalContext`
 */
internal data class RiderSignalContext(
    val fix: Pair<Double, Double>?,
    val insidePrivacyZone: Boolean,
)

/** @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalIntent` */
internal sealed interface RiderSignalIntent {
    fun frame(): JSONObject

    data class Send(val kind: RiderSignalKind, val lat: Double, val lng: Double) : RiderSignalIntent {
        override fun frame(): JSONObject = JSONObject()
            .put("type", "signal")
            .put("kind", kind.wire)
            .put("lat", lat)
            .put("lng", lng)
    }

    data object Clear : RiderSignalIntent {
        override fun frame(): JSONObject = JSONObject().put("type", "signal-clear")
    }
}

/** @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignals` */
internal object RiderSignals {
    /** The relay feature advertised in `snapshot` when it accepts `signal`/`signal-clear`. */
    const val RELAY_FEATURE = "rider-signals"

    /** A send needs a GPS fix at most this old. */
    const val FIX_MAX_AGE_MS = 30_000L

    /**
     * The intent for a send request, or null without a recent fix. Goes out inside a Privacy Zone
     * and while zones are loading; presence keeps its own gates.
     */
    fun sendIntent(kind: RiderSignalKind, context: RiderSignalContext): RiderSignalIntent.Send? {
        val fix = context.fix ?: return null
        return RiderSignalIntent.Send(kind, fix.first, fix.second)
    }
}
