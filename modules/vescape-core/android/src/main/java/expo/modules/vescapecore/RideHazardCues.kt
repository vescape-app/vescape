package expo.modules.vescapecore

import expo.modules.vescapecore.geo.GeoMath

/**
 * Decides when another Rider's Ride Hazard is announced: never when it is marked, only once the
 * device's GPS fix comes within [APPROACH_RADIUS_M] of it while closing in, about 5 s ahead at a
 * trail pace. Each hazard (rider id + `startedAt`) cues once; a replaced hazard is a new pin. Closing
 * in means the distance shrank by at least [MIN_CLOSING_M] since the previous fix, so GPS jitter
 * while standing next to a hazard stays silent. Pure: the observer feeds it rosters and fixes.
 *
 * @parity /modules/vescape-core/ios/groupride/RideHazardCues.swift `RideHazardCues`
 */
internal class RideHazardCues {
    private data class Key(val riderId: String, val startedAt: Long)

    /** Other Riders' active hazards in the last roster of the joined ride. */
    private var hazards: Map<Key, RideHazard> = emptyMap()
    private val distances = mutableMapOf<Key, Double>()
    private val announced = mutableSetOf<Key>()

    /** Other Riders' active hazards by rider id; the rider's own never cues. */
    fun roster(riderHazards: Map<String, RideHazard>) {
        hazards = riderHazards.entries.associate { (id, hazard) -> Key(id, hazard.startedAt) to hazard }
        distances.keys.retainAll(hazards.keys)
        announced.retainAll(hazards.keys)
    }

    /** A new device fix: `groupRide.hazard.<kind>` of the nearest hazard just approached, else null. */
    fun fix(lat: Double, lng: Double): String? {
        var cue: Pair<Key, Double>? = null
        for ((key, hazard) in hazards) {
            if (key in announced) continue
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
