package expo.modules.vescapecore

import expo.modules.vescapecore.geo.GeoMath

/**
 * @parity /modules/vescape-core/ios/groupride/RideHazardCues.swift `RideHazardCues`
 */
internal class RideHazardCues {
    private data class Key(val riderId: String, val startedAt: Long)

    private var hazards: Map<Key, RideHazard> = emptyMap()
    private val distances = mutableMapOf<Key, Double>()
    private val announced = mutableSetOf<Key>()

    fun roster(riderHazards: Map<String, RideHazard>) {
        hazards = riderHazards.entries.associate { (id, hazard) -> Key(id, hazard.startedAt) to hazard }
        distances.keys.retainAll(hazards.keys)
        announced.retainAll(hazards.keys)
    }

    fun fix(lat: Double, lng: Double, relayNow: Long): String? {
        var cue: Pair<Key, Double>? = null
        for ((key, hazard) in hazards) {
            if (hazard.expiresAt <= relayNow || key in announced) continue
            val distance = GeoMath.distanceMeters(lat, lng, hazard.lat, hazard.lng)
            val previous = distances.put(key, distance)
            val closing = previous != null && previous - distance >= MIN_CLOSING_M
            if (distance <= APPROACH_RADIUS_M && closing && distance < (cue?.second ?: Double.MAX_VALUE)) {
                cue = key to distance
            }
        }
        val key = cue?.first ?: return null
        announced += key
        return CUE_PREFIX + hazards.getValue(key).kind.wire
    }

    fun reset() {
        hazards = emptyMap()
        distances.clear()
        announced.clear()
    }

    companion object {
        const val CUE_PREFIX = "groupRide.hazard."

        /** @parity /modules/vescape-core/ios/groupride/RideHazardCues.swift `approachRadiusM` */
        const val APPROACH_RADIUS_M = 30.0

        /** @parity /modules/vescape-core/ios/groupride/RideHazardCues.swift `minClosingM` */
        const val MIN_CLOSING_M = 2.0
    }
}
