package expo.modules.vescapecore

import expo.modules.vescapecore.notices.RideNoticeSeverity
import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `PinSlot`
 */
internal enum class PinSlot(val wire: String, val relayFeature: String) {
    SIGNAL("signal", "rider-signals"),
    HAZARD("hazard", "ride-hazards"),
}

internal sealed interface PinKind {
    val wire: String
    val label: String
    val slot: PinSlot
}

/**
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalKind`
 * @parity /modules/vescape-core/src/index.ts `RIDER_SIGNAL_KINDS`
 */
internal enum class RiderSignalKind(override val wire: String, override val label: String, val rank: Int) : PinKind {
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
 * @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignalContext`
 */
internal data class RiderSignalContext(
    val fix: Pair<Double, Double>?,
    val insidePrivacyZone: Boolean,
)

/** @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderPinIntent` */
internal sealed interface RiderPinIntent {
    val slot: PinSlot

    fun frame(prefix: String = ""): JSONObject

    data class Send(val kind: PinKind, val lat: Double, val lng: Double) : RiderPinIntent {
        override val slot get() = kind.slot

        override fun frame(prefix: String): JSONObject = JSONObject()
            .put("type", prefix + slot.wire)
            .put("kind", kind.wire)
            .put("lat", lat)
            .put("lng", lng)
    }

    data class Clear(override val slot: PinSlot) : RiderPinIntent {
        override fun frame(prefix: String): JSONObject = JSONObject().put("type", "$prefix${slot.wire}-clear")
    }
}

/** @parity /modules/vescape-core/ios/groupride/RiderSignal.swift `RiderSignals` */
internal object RiderSignals {
    const val FIX_MAX_AGE_MS = 30_000L

    fun sendIntent(kind: PinKind, context: RiderSignalContext): RiderPinIntent.Send? {
        val fix = context.fix ?: return null
        return RiderPinIntent.Send(kind, fix.first, fix.second)
    }
}
