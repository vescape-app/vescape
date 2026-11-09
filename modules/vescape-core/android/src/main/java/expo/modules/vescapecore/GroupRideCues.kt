package expo.modules.vescapecore

/**
 * Decides the cues of the joined Group Ride from the relay events [GroupRideObserver] feeds it. Pure:
 * it owns no timer, so the observer arms the [LOST_GRACE_MS] timer that ends in [graceElapsed].
 *
 * The relay keeps a Rider whose socket closed in the roster as `away`, so going away and coming back
 * changes no id and plays nothing. A live Rider's id disappearing means a manual leave; an away
 * Rider's id disappearing is the relay expiring them (or their late leave) and plays nothing.
 *
 * @parity /modules/vescape-core/ios/groupride/GroupRideCues.swift `GroupRideCues`
 */
internal class GroupRideCues {
    /** The ride the rider joined; [seen] and [members] belong to it. Kept through our own outage. */
    private var rideId: String? = null
    /** Every other Rider id seen in [rideId]. Only an id outside it is a new Rider. */
    private val seen = mutableSetOf<String>()
    /** Other Riders in the last roster of [rideId]. */
    private var members: Set<String> = emptySet()
    /** The [members] that roster marked away. */
    private var away: Set<String> = emptySet()
    /** The next roster only catches up: the first after joining, or after our own link came back. */
    private var syncing = true
    /** Our socket to [rideId] dropped and the rider has not rejoined yet. */
    private var linkDown = false
    /** `lost` already played for the current outage. */
    private var lostPlayed = false

    /**
     * The relay confirmed the rider is in [rideId]. Another ride starts over with `joined`; the same
     * ride after an outage is a rejoin, `restored` only when `lost` played for it.
     */
    fun joined(rideId: String): String? {
        if (rideId != this.rideId) {
            reset()
            this.rideId = rideId
            return "groupRide.joined"
        }
        if (!linkDown) return null
        val cue = if (lostPlayed) "groupRide.restored" else null
        linkDown = false
        lostPlayed = false
        syncing = true
        return cue
    }

    /** Our socket dropped. True when this starts an outage of the joined ride: arm the grace timer. */
    fun linkDropped(): Boolean {
        if (rideId == null || linkDown) return false
        linkDown = true
        return true
    }

    /** [LOST_GRACE_MS] passed since [linkDropped]; `lost` once per outage still unresolved. */
    fun graceElapsed(): String? {
        if (!linkDown || lostPlayed) return null
        lostPlayed = true
        return "groupRide.lost"
    }

    /**
     * A roster of the joined ride, its [awayIds] the riders the relay marks away: `riderJoined` for
     * an id never seen in this ride, else `riderLeft` when another Rider's id is gone and the previous
     * roster had them live. The rider's own id never cues. Rosters of any other ride, or arriving
     * while our link is down, are ignored.
     */
    fun roster(rideId: String, riderIds: List<String>, awayIds: Set<String>, ownRiderId: String?): String? {
        if (rideId != this.rideId || linkDown) return null
        val others = riderIds.filter { it != ownRiderId }.toSet()
        val arrived = others - seen
        val left = members - others - away
        seen += others
        members = others
        away = awayIds intersect others
        if (syncing) {
            syncing = false
            return null
        }
        return when {
            arrived.isNotEmpty() -> "groupRide.riderJoined"
            left.isNotEmpty() -> "groupRide.riderLeft"
            else -> null
        }
    }

    /** The rider is no longer in the ride (left, stopped, blocked, ride ended): forget it all. */
    fun reset() {
        rideId = null
        seen.clear()
        members = emptySet()
        away = emptySet()
        syncing = true
        linkDown = false
        lostPlayed = false
    }

    companion object {
        /**
         * How long our joined ride's link may stay down before `lost` plays. A rejoin inside it is
         * silent, so a flapping connection does not chatter.
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideCues.swift `lostGraceMs`
         */
        const val LOST_GRACE_MS = 15_000L
    }
}
