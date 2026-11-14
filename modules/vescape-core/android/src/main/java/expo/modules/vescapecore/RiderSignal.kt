package expo.modules.vescapecore

import expo.modules.vescapecore.notices.RideNoticeSeverity
import org.json.JSONObject

/**
 * The two pinned slots a Rider holds in a Group Ride, independently: one Rider Signal and one Ride
 * Hazard. [wire] is the relay's send message type (`<wire>-clear` clears) and roster field.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `PinSlot`
 */
internal enum class PinSlot(val wire: String, val relayFeature: String) {
    SIGNAL("signal", "rider-signals"),
    HAZARD("hazard", "ride-hazards"),
}

/** A fixed kind of pin, by its relay wire name. */
internal sealed interface PinKind {
    val wire: String
    /** Titles Ride Notices. */
    val label: String
    val slot: PinSlot
}

/**
 * The fixed **Rider Signal** kinds, by their relay wire name. [rank] orders them when several cue at
 * once: a serious injury over a minor injury or a board problem, those over a heads-up (a rider down after a
 * small crash, a wait, a break).
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 * @parity /modules/vescape-core/src/index.ts `RIDER_SIGNAL_KINDS`
 */
internal enum class RiderSignalKind(override val wire: String, override val label: String, val rank: Int) : PinKind {
    // Labels title Ride Notices; ranks drive their severity.
    // @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KIND_INFO`
    DOWN("down", "Rider down", 0),
    MINOR("minor", "Minor injury", 1),
    SERIOUS("serious", "Serious injury", 2),
    BATTERY("battery", "Battery dead", 1),
    TIRE("tire", "Flat tire", 1),
    OVERHEAT("overheat", "Overheating", 1),
    BOARD("board", "Board fault", 1),
    WAIT("wait", "Wait for me", 0),
    BREAK("break", "Break", 0);

    override val slot get() = PinSlot.SIGNAL

    /**
     * A serious injury is critical, a minor injury or a problem a warning, a rider down, a wait, or a break information.
     * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `severity`
     */
    val severity: RideNoticeSeverity
        get() = when {
            rank == 2 -> RideNoticeSeverity.CRITICAL
            rank == 1 -> RideNoticeSeverity.WARNING
            else -> RideNoticeSeverity.INFO
        }

    companion object {
        fun fromWire(wire: String?): RiderSignalKind? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * The fixed **Ride Hazard** kinds, by their relay wire name.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RideHazardKind`
 * @parity /modules/vescape-core/src/index.ts `RIDE_HAZARD_KINDS`
 */
internal enum class RideHazardKind(override val wire: String, override val label: String) : PinKind {
    // @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDE_HAZARD_KIND_INFO`
    WATER("water", "Water's edge"),
    TERRAIN("terrain", "Rough terrain"),
    OBSTACLE("obstacle", "Obstacle"),
    POLICE("police", "Police");

    override val slot get() = PinSlot.HAZARD

    companion object {
        fun fromWire(wire: String?): RideHazardKind? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * A Rider's active pin as the relay stamps it. Times are relay epoch ms: compare them against the
 * roster's relay `now`, never the phone clock.
 *
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderPin`
 * @parity /modules/vescape-core/src/index.ts `GroupRidePin`
 */
internal data class RiderPin<K : PinKind>(
    val kind: K,
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
        fun <K : PinKind> parse(obj: JSONObject?, kindOf: (String?) -> K?): RiderPin<K>? {
            obj ?: return null
            val kind = kindOf(obj.optString("kind")) ?: return null
            val lat = obj.optDouble("lat").takeIf { it.isFinite() } ?: return null
            val lng = obj.optDouble("lng").takeIf { it.isFinite() } ?: return null
            if (!obj.has("startedAt") || !obj.has("expiresAt")) return null
            return RiderPin(kind, lat, lng, obj.optLong("startedAt"), obj.optLong("expiresAt"))
        }
    }
}

internal typealias RiderSignal = RiderPin<RiderSignalKind>
internal typealias RideHazard = RiderPin<RideHazardKind>

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

/** @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderPinIntent` */
internal sealed interface RiderPinIntent {
    val slot: PinSlot

    fun frame(): JSONObject

    data class Send(val kind: PinKind, val lat: Double, val lng: Double) : RiderPinIntent {
        override val slot get() = kind.slot

        override fun frame(): JSONObject = JSONObject()
            .put("type", slot.wire)
            .put("kind", kind.wire)
            .put("lat", lat)
            .put("lng", lng)
    }

    data class Clear(override val slot: PinSlot) : RiderPinIntent {
        override fun frame(): JSONObject = JSONObject().put("type", "${slot.wire}-clear")
    }
}

/** @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignals` */
internal object RiderSignals {
    /** A send needs a GPS fix at most this old. */
    const val FIX_MAX_AGE_MS = 30_000L

    /**
     * The intent for a send request, or null without a recent fix. Goes out inside a Privacy Zone
     * and while zones are loading; presence keeps its own gates.
     */
    fun sendIntent(kind: PinKind, context: RiderSignalContext): RiderPinIntent.Send? {
        val fix = context.fix ?: return null
        return RiderPinIntent.Send(kind, fix.first, fix.second)
    }
}
