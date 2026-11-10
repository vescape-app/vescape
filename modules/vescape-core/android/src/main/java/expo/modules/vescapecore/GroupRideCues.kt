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
    /** Active signals of other Riders in the last roster of [rideId], by rider id. */
    private var signals: Map<String, RiderSignal> = emptyMap()
    /** The rider's own active signal in the last roster of `rideId`. */
    private var ownSignal: RiderSignal? = null
    /** The rider's own active hazard in the last roster of `rideId`. */
    private var ownHazard: RideHazard? = null
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
     * A roster of the joined ride, its [awayIds] the riders the relay marks away and [riderSignals]
     * their active signals, [now] the relay's clock. A Rider Signal cue wins over social cues of
     * the same roster: `groupRide.signal.<kind>` for a new or replaced signal (new `startedAt`),
     * else `groupRide.signal.ok` for a still-present Rider whose signal is gone before its
     * `expiresAt` by relay [now]. Expiry, a Rider leaving, and a missing [now] are silent. The
     * rider's own signal confirms what the relay accepted: `groupRide.signal.sent` for a new own
     * `startedAt` (after other Riders' new signals), `groupRide.hazard.sent` for a new own hazard
     * [ownHazardNow] (after that), `groupRide.signal.cleared` when the own signal is gone before its
     * `expiresAt` (after `ok`). Other Riders' hazards cue on approach, in [RideHazardCues]. Social: `riderJoined` for an id never seen in this ride, else
     * `riderLeft` when another Rider's id is gone and the previous roster had them live; the rider's
     * own id never makes a social cue. Rosters of any
     * other ride, or arriving while our link is down, are ignored; the first roster after joining
     * or our own reconnect only catches up, so signals already active then stay silent.
     */
    fun roster(
        rideId: String,
        riderIds: List<String>,
        awayIds: Set<String>,
        ownRiderId: String?,
        riderSignals: Map<String, RiderSignal> = emptyMap(),
        now: Long? = null,
        ownHazardNow: RideHazard? = null,
    ): String? {
        if (rideId != this.rideId || linkDown) return null
        val others = riderIds.filter { it != ownRiderId }.toSet()
        val arrived = others - seen
        val left = members - others - away
        val current = riderSignals.filterKeys { it in others }
        val raised = current.filter { (id, signal) -> signals[id]?.startedAt != signal.startedAt }.values
        val cleared = signals.filter { (id, signal) ->
            id in others && id !in current && now != null && now < signal.expiresAt
        }
        val own = ownRiderId?.let { riderSignals[it] }
        val ownSent = own != null && own.startedAt != ownSignal?.startedAt
        val ownCleared = own == null && ownSignal.let { it != null && now != null && now < it.expiresAt }
        val hazardSent = ownHazardNow != null && ownHazardNow.startedAt != ownHazard?.startedAt
        seen += others
        members = others
        away = awayIds intersect others
        signals = current
        ownSignal = own
        ownHazard = ownHazardNow
        if (syncing) {
            syncing = false
            return null
        }
        return when {
            raised.isNotEmpty() -> signalCue(raised.maxWith(compareBy({ it.kind.rank }, { it.startedAt })).kind.wire)
            ownSent -> signalCue("sent")
            hazardSent -> RideHazardCues.CUE_PREFIX + "sent"
            cleared.isNotEmpty() -> signalCue("ok")
            ownCleared -> signalCue("cleared")
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
        signals = emptyMap()
        ownSignal = null
        ownHazard = null
        syncing = true
        linkDown = false
        lostPlayed = false
    }

    companion object {
        private const val SIGNAL_CUE_PREFIX = "groupRide.signal."

        private fun signalCue(name: String) = SIGNAL_CUE_PREFIX + name

        /**
         * A Rider Signal or Ride Hazard cue: a safety call, announced at advisory priority.
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideCues.swift `isSafetyCue`
         */
        fun isSafetyCue(cue: String): Boolean =
            cue.startsWith(SIGNAL_CUE_PREFIX) || cue.startsWith(RideHazardCues.CUE_PREFIX)

        /**
         * Whether [cue] plays. The connection sounds toggle mutes every Group Ride cue except a safety
         * cue: that is a safety call, not a connection sound.
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideCues.swift `audible`
         */
        fun audible(cue: String, connectionSoundsEnabled: Boolean): Boolean =
            connectionSoundsEnabled || isSafetyCue(cue)

        /**
         * How long our joined ride's link may stay down before `lost` plays. A rejoin inside it is
         * silent, so a flapping connection does not chatter.
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideCues.swift `lostGraceMs`
         */
        const val LOST_GRACE_MS = 15_000L
    }
}
