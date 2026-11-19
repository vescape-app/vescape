package expo.modules.vescapecore

import expo.modules.vescapecore.geo.GeoMath
import expo.modules.vescapecore.watch.GroupRideRoster
import org.json.JSONArray
import org.json.JSONObject

/**
 * The rider's public ride switch: off, on until [until] (epoch ms), or on with no end (always).
 *
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `PublicRideSwitch`
 */
internal data class PublicRideSwitch(val on: Boolean, val until: Long?) {
    fun activeAt(now: Long): Boolean = on && (until == null || until > now)

    companion object {
        val OFF = PublicRideSwitch(on = false, until = null)
    }
}

/**
 * Public ride on the phone: the switch, its timer, when the rider goes public, and the public half of
 * the relay protocol (`public-on`/`public-off`/`public-position`, `nearby`, the riders the relay
 * reports around the rider, and Rider Signals and Ride Hazards by distance). Pure: the [GroupRideObserver] that owns the socket feeds it link and
 * relay events and hands it a [send] that only works while the link is open.
 *
 * An active switch and a signed-in Account allow sharing from a Board Session or by phone.
 * A connected board takes over phone sharing until the Board Session ends. The relay and the
 * local switch each enforce the end time. Signing out or changing Account turns the switch off.
 *
 * Wire protocol: vescape-server `docs/group-ride/PROTOCOL.md`, "Public ride". Main thread only.
 *
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift
 */
internal class PublicRide(
    private val now: () -> Long,
    private val persist: (PublicRideSwitch) -> Unit,
    /** Arm the switch timer to fire [expire] after the delay; null cancels it. */
    private val scheduleExpiry: (Long?) -> Unit,
    private val emit: (String, Map<String, Any?>) -> Unit,
    /** Send a frame on the open link; false when there is none. */
    private val send: (JSONObject) -> Boolean,
    /** Reconnect after this delay if a batch is still unacknowledged; null cancels it. */
    private val scheduleMissedRetry: (Long?) -> Unit = {},
    private val onPublicRideDemandChanged: () -> Unit = {},
    /** Other riders' pins changed: their signals, their hazards by Account id, and the relay clock. */
    private val onPins: (List<SignalRider>, Map<String, RideHazard>, Long?) -> Unit = { _, _, _ -> },
) {
    var switch: PublicRideSwitch = PublicRideSwitch.OFF
        private set
    private enum class Activation(val wireValue: String) {
        OFF("off"), WAITING("waiting"), PHONE("phone"), BOARD("board"),
    }

    private var boardConnected = false
    private var manualSharing = false
    private var accountId: String? = null
    /** The link is up and has announced its features. */
    private var linkReady = false
    private var supported = false
    /** `public-on` went out on this link and no `public-off` since. */
    private var sentOn = false
    /** The relay confirmed this connection rides public. */
    private var live = false
    /** Why the public ride last ended without the rider turning it off; cleared when it goes on. */
    private var reason: String? = null
    /** The point watched with the switch off ("who is near me"); null when not looking around. */
    private var lookAround: Pair<Double, Double>? = null
    private val riders = LinkedHashMap<String, Map<String, Any?>>()
    private var ridersNow: Long? = null
    private var lastStatus: Map<String, Any?>? = null
    /**
     * The latest pin intent per slot made before the relay confirmed the public ride, sent once it
     * does. A later intent in the same slot overwrites it; the public ride ending drops them.
     *
     * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `pendingPins`
     */
    private val pendingPins = mutableMapOf<PinSlot, RiderPinIntent>()
    /** The rider's own pins as sent; the relay never echoes them back. Times are relay clock estimates. */
    private val ownPins = mutableMapOf<PinSlot, Map<String, Any?>>()
    /** Other riders' pins as the relay last reported them, by Account id. */
    private val pins = LinkedHashMap<String, PublicPins>()
    private var pinsNow: Long? = null
    /** Phone time [pinsNow] arrived at, to advance it. */
    private var pinsReceivedAt = 0L
    /** The open link takes `missed-positions`. */
    private var missedSupported = false
    /**
     * Positions taken while public with the link down, oldest first: one per [MISSED_SPACING_MS],
     * at most [MISSED_MAX_AGE_MS] back. Memory only, so an app kill loses them; they belong to
     * [accountId] and are thrown away when it changes.
     *
     * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `missed`
     */
    private val missed = ArrayDeque<Pair<Long, RiderPresence>>()
    /** How many of the oldest [missed] positions are out as one batch, waiting for `missed-stored`. */
    private var missedInFlight = 0
    private var authenticatedAccount: String? = null
    private var lastNeedsLink = false
    private var lastNeedsGps = false

    private val activation: Activation
        get() {
            if (accountId == null || !switch.activeAt(now())) return Activation.OFF
            if (boardConnected) return Activation.BOARD
            return if (manualSharing) Activation.PHONE else Activation.WAITING
        }

    /** The rider should be public right now. */
    val wanted: Boolean
        get() {
            val activation = this.activation
            return activation == Activation.BOARD || activation == Activation.PHONE
        }

    /** Manual sharing keeps phone GPS active in the background, even without a board. */
    val needsGps: Boolean get() = activation == Activation.PHONE

    /** Positions go out: the relay confirmed public riding on the open link. */
    val riding: Boolean get() = wanted && live && linkReady

    /** The rider can raise a signal or mark a hazard publicly: wanted public, on a relay that has it. */
    val canPin: Boolean get() = wanted && supported

    /** The socket stays up until the completed buffer is acknowledged, even off the public ride. */
    val needsLink: Boolean get() = wanted || lookAround != null || missed.isNotEmpty()

    /** Start from the persisted switch and the signed-in Account. */
    fun load(stored: PublicRideSwitch, account: String?) {
        accountId = account
        manualSharing = false
        switch = if (account == null || !stored.activeAt(now())) PublicRideSwitch.OFF else stored
        if (switch != stored) persist(switch)
        armTimer()
        emitStatus(force = true)
    }

    /**
     * The rider moved the switch. Refused (false) without an Account or with an end time already
     * past; off always works.
     */
    fun set(next: PublicRideSwitch): Boolean {
        if (next.on && (accountId == null || !next.activeAt(now()))) return false
        val changed = next != switch
        switch = next
        if (!next.on) manualSharing = false
        if (next.on) reason = null
        persist(next)
        armTimer()
        // A new end time must reach the relay: send `public-on` again with it.
        if (changed && next.on && sentOn) sentOn = false
        reconcile()
        emitStatus()
        return true
    }

    /** @parity /modules/vescape-core/ios/groupride/PublicRide.swift `setManualSharing` */
    fun setManualSharing(enabled: Boolean) {
        if (boardConnected || activation == Activation.OFF || manualSharing == enabled) return
        manualSharing = enabled
        if (enabled) reason = null
        reconcile()
        emitStatus()
    }

    /** @parity /modules/vescape-core/ios/groupride/PublicRide.swift `setBoardConnected` */
    fun setBoardConnected(connected: Boolean) {
        if (connected == boardConnected) return
        boardConnected = connected
        if (connected) manualSharing = false
        reconcile()
        emitStatus()
    }

    /**
     * The signed-in Account changed: sign-out, a rejected credential, or another Account. Ends the
     * public ride at once and turns the switch off. Returns true when the Account changed, so the
     * owner reconnects the socket under the new credential.
     */
    fun setAccount(account: String?): Boolean {
        if (account == accountId) return false
        val hadAccount = accountId != null
        // `public-off` goes out on the old connection, which still carries the old Account.
        if (sentOn) send(JSONObject().put("type", "public-off"))
        sentOn = false
        live = false
        accountId = account
        manualSharing = false
        linkReady = false
        authenticatedAccount = null
        dropOwnPins()
        resetReceived()
        // Kept positions are the old Account's: never sent under another.
        discardMissed()
        if (hadAccount && switch.on) {
            switch = PublicRideSwitch.OFF
            reason = REASON_SIGNED_OUT
            persist(switch)
            armTimer()
        }
        emitStatus()
        return true
    }

    /** The switch timer fired. */
    fun expire() {
        if (!switch.on || switch.activeAt(now())) {
            armTimer()
            return
        }
        switchOff(REASON_END_TIME)
    }

    /** The link opened and the relay listed its [features]. */
    fun linkReady(features: Set<String>, authenticatedAccount: String?) {
        this.authenticatedAccount = authenticatedAccount
        linkReady = true
        supported = PUBLIC_RIDE_FEATURE in features
        missedSupported = MISSED_POSITIONS_FEATURE in features
        missedInFlight = 0
        if (!missedSupported) discardMissed()
        sentOn = false
        live = false
        sendMissed()
        reconcile()
        lookAround?.let(::sendNearby)
        emitStatus()
    }

    /**
     * The link is gone. Positions taken while it is down are kept for the reconnect; a batch out
     * without `missed-stored` is sent again. Watched riders are forgotten until the next `nearby-riders`.
     */
    fun linkLost() {
        linkReady = false
        authenticatedAccount = null
        scheduleMissedRetry(null)
        missedInFlight = 0
        sentOn = false
        live = false
        resetReceived()
        emitStatus()
    }

    /** A GPS fix, Privacy Zone gate already applied, taken at [at] (GPS time, epoch ms). */
    fun position(presence: RiderPresence, at: Long) {
        if (!wanted) return
        if (!riding) {
            keepMissed(presence, at)
            return
        }
        // Historical batches do not depend on the new public ride being confirmed.
        sendMissed()
        send(
            JSONObject()
                .put("type", "public-position")
                .put("at", at)
                .put("presence", presence.toJson()),
        )
    }

    /** Watch public riders around [point] with the switch off. */
    fun watchNearby(point: Pair<Double, Double>) {
        lookAround = point
        emitDemand()
        if (linkReady) sendNearby(point)
    }

    /**
     * A fix while looking around: starts watching when no point was known, and re-centres once the
     * rider is [LOOK_AROUND_RECENTRE_M] from the watched point. A public rider's own positions move
     * the relay's centre, so then only the point follows.
     */
    fun followNearby(point: Pair<Double, Double>) {
        val current = lookAround ?: return watchNearby(point)
        val moved = GeoMath.distanceMeters(current.first, current.second, point.first, point.second)
        if (moved < LOOK_AROUND_RECENTRE_M) return
        lookAround = point
        if (linkReady && !riding) sendNearby(point)
    }

    fun stopWatchingNearby() {
        if (lookAround == null) return
        lookAround = null
        emitDemand()
        if (linkReady) send(JSONObject().put("type", "nearby-stop"))
        // A public rider keeps receiving its own area.
        if (!riding && riders.isNotEmpty()) {
            riders.clear()
            emitRiders()
        }
    }

    /**
     * Raise, replace, or clear the rider's own public pin. False when the rider is not public, so
     * the intent is not the public ride's. Held until the relay confirms the public ride.
     */
    fun submitPin(intent: RiderPinIntent): Boolean {
        if (!canPin) return false
        when (intent) {
            is RiderPinIntent.Send -> {
                val startedAt = relayNow()
                ownPins[intent.slot] = mapOf(
                    "kind" to intent.kind.wire,
                    "lat" to intent.lat,
                    "lng" to intent.lng,
                    "startedAt" to startedAt,
                    "expiresAt" to startedAt + PIN_LIFETIME_MS,
                )
            }
            is RiderPinIntent.Clear -> ownPins.remove(intent.slot)
        }
        pendingPins[intent.slot] = intent
        sendPendingPins()
        emitPins()
        return true
    }

    /**
     * The nearby public riders for the Watch Mirror while the rider rides public, in relay order;
     * null otherwise. The wrist orders and caps them.
     *
     * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `nearbyRoster`
     */
    val nearbyRoster: GroupRideRoster?
        get() {
            if (!riding) return null
            val rows = riders.values.mapNotNull { view ->
                GroupRideObserver.rosterRider(view + mapOf("id" to view["accountId"], "name" to view["nick"]))
            }
            return GroupRideRoster(ownRiderId = accountId, riders = rows)
        }

    /** Replay state to a JS runtime that just subscribed. */
    fun resync() {
        emitStatus(force = true)
        emitRiders()
        emitPins()
    }

    /** A relay frame; true when it was a public ride one. */
    fun handle(type: String, json: JSONObject): Boolean {
        when (type) {
            "public-status" -> onStatus(json)
            "missed-stored" -> {
                // The whole batch is done, positions the relay dropped included.
                repeat(missedInFlight.coerceAtMost(missed.size)) { missed.removeFirst() }
                missedInFlight = 0
                scheduleMissedRetry(null)
                sendMissed()
                emitDemand()
            }
            "nearby-riders" -> {
                riders.clear()
                json.optJSONArray("riders")?.let { array ->
                    for (i in 0 until array.length()) publicRiderView(array.optJSONObject(i))?.let { riders[it["accountId"] as String] = it }
                }
                ridersNow = json.optLongOrNull("now")
                emitRiders()
            }
            "public-rider" -> {
                val view = publicRiderView(json.optJSONObject("rider")) ?: return true
                riders[view["accountId"] as String] = view
                ridersNow = json.optLongOrNull("now")
                emitRiders()
            }
            "public-rider-gone" -> {
                if (riders.remove(json.optString("accountId")) != null) emitRiders()
            }
            "public-pins" -> {
                val id = json.optString("accountId").takeIf { it.isNotEmpty() } ?: return true
                // The relay echoes the rider's own pins; those live in `ownPins`, not among others'.
                if (id == accountId) return true
                val signal = RiderPin.parse(json.optJSONObject("signal"), RiderSignalKind::fromWire)
                val hazard = RiderPin.parse(json.optJSONObject("hazard"), RideHazardKind::fromWire)
                // A missing slot is none: cleared, expired, out of reach, or the rider went.
                if (signal == null && hazard == null) pins.remove(id) else pins[id] = PublicPins(json.optString("nick"), signal, hazard)
                json.optLongOrNull("now")?.let {
                    pinsNow = it
                    pinsReceivedAt = now()
                }
                emitPins()
                onPins(
                    pins.map { (accountId, p) -> SignalRider(accountId, p.nick, p.signal) },
                    pins.mapNotNull { (accountId, p) -> p.hazard?.let { accountId to it } }.toMap(),
                    pinsNow,
                )
            }
            else -> return false
        }
        return true
    }

    /** A relay `error`; true when it refused going public, which turns the switch off. */
    fun handleError(message: String): Boolean {
        if (message == MISSED_NOT_STORED) {
            // Keep the batch and its retry deadline. Reconnect before retrying so a late ack
            // from this link cannot acknowledge a different batch.
            return false
        }
        if (message !in REFUSALS) return false
        sentOn = false
        live = false
        switchOff(REASON_REFUSED)
        return true
    }

    private fun onStatus(json: JSONObject) {
        if (json.optBoolean("on")) {
            live = true
            reason = null
            sendPendingPins()
            sendMissed()
            emitStatus()
            return
        }
        live = false
        sentOn = false
        when (val why = json.optString("reason").takeIf { it.isNotEmpty() }) {
            // Another phone of this Account went public, or the relay reached the end time.
            REASON_REPLACED, REASON_END_TIME -> switchOff(why)
            // Away too long: the relay dropped the rider; the switch still wants it, so go on again.
            else -> {
                // The relay dropped the rider and its pins with it.
                dropOwnPins()
                if (why != null) reason = why
                reconcile()
                emitStatus()
            }
        }
    }

    private fun switchOff(why: String) {
        if (sentOn) send(JSONObject().put("type", "public-off"))
        sentOn = false
        live = false
        switch = PublicRideSwitch.OFF
        manualSharing = false
        reason = why
        persist(switch)
        armTimer()
        dropOwnPins()
        emitStatus()
    }

    /** Bring the relay in line with [wanted]. */
    private fun reconcile() {
        // Off the public ride the relay drops the rider's pins.
        if (!wanted) dropOwnPins()
        if (!linkReady || !supported || accountId == null || authenticatedAccount != accountId) return
        if (wanted && !sentOn) {
            val frame = JSONObject().put("type", "public-on")
            switch.until?.let { frame.put("until", it) }
            sentOn = send(frame)
        } else if (!wanted && sentOn) {
            send(JSONObject().put("type", "public-off"))
            sentOn = false
            live = false
        }
    }

    private fun sendPendingPins() {
        if (!riding) return
        pendingPins.values.toList().forEach { intent ->
            if (send(intent.frame(PUBLIC_PREFIX))) pendingPins.remove(intent.slot)
        }
    }

    /** Keep a position the link could not take, thinned and capped; only for a public rider whose relay can take it later. */
    private fun keepMissed(presence: RiderPresence, at: Long) {
        if (!wanted || (linkReady && !missedSupported)) return
        val last = missed.lastOrNull()?.first
        if (last != null && at - last < MISSED_SPACING_MS) return
        missed.addLast(at to presence)
        // Never remove an in-flight prefix: missed-stored acknowledges exactly that prefix.
        while (missed.size > missedInFlight &&
            (at - missed[missedInFlight].first > MISSED_MAX_AGE_MS || missed.size > MISSED_MAX_AGE_MS / MISSED_SPACING_MS + 1)
        ) missed.removeAt(missedInFlight)
        emitDemand()
    }

    /** Send the oldest kept positions as one batch, unless one is already out. */
    private fun sendMissed() {
        if (!linkReady || accountId == null || authenticatedAccount != accountId || !missedSupported || missedInFlight > 0 || missed.isEmpty()) return
        val batch = missed.take(MISSED_BATCH_MAX)
        val positions = JSONArray()
        batch.forEach { (at, presence) -> positions.put(JSONObject().put("at", at).put("presence", presence.toJson())) }
        if (send(JSONObject().put("type", "missed-positions").put("positions", positions))) {
            missedInFlight = batch.size
            scheduleMissedRetry(MISSED_RETRY_MS)
        }
    }

    /** Server changes and Account changes cannot carry historical positions across identities. */
    fun discardMissed() {
        missed.clear()
        missedInFlight = 0
        scheduleMissedRetry(null)
        emitDemand()
    }

    private fun emitDemand() {
        val needed = needsLink
        val gpsNeeded = needsGps
        if (needed == lastNeedsLink && gpsNeeded == lastNeedsGps) return
        lastNeedsLink = needed
        lastNeedsGps = gpsNeeded
        onPublicRideDemandChanged()
    }

    /** Link and identity resets must forget peer pins, including far-away friends. */
    private fun resetReceived() {
        riders.clear()
        ridersNow = null
        emitRiders()
        pins.clear()
        pinsNow = null
        pinsReceivedAt = 0L
        emitPins()
        onPins(emptyList(), emptyMap(), null)
    }

    private fun dropOwnPins() {
        pendingPins.clear()
        if (ownPins.isEmpty()) return
        ownPins.clear()
        emitPins()
    }

    /** The relay clock now, advanced from the last `public-pins`; the phone clock before one. */
    fun relayNow(): Long = pinsNow?.let { it + now() - pinsReceivedAt } ?: now()

    private fun sendNearby(point: Pair<Double, Double>) {
        send(JSONObject().put("type", "nearby").put("lat", point.first).put("lng", point.second))
    }

    private fun armTimer() {
        val until = switch.until
        scheduleExpiry(if (switch.on && until != null) (until - now()).coerceAtLeast(0) else null)
    }

    /** @parity /modules/vescape-core/src/index.ts `PublicRideStatus` */
    private fun emitStatus(force: Boolean = false) {
        val status = mapOf(
            "activation" to activation.wireValue,
            "until" to switch.until,
            "live" to riding,
            "supported" to supported,
            "reason" to reason,
        )
        emitDemand()
        if (!force && status == lastStatus) return
        lastStatus = status
        emit("onPublicRideStatus", status)
    }

    private fun emitRiders() {
        emit("onPublicRiders", mapOf("riders" to riders.values.toList(), "now" to ridersNow))
    }

    /** @parity /modules/vescape-core/src/index.ts `PublicPinsEvent` */
    private fun emitPins() {
        emit(
            "onPublicPins",
            mapOf(
                "pins" to pins.map { (accountId, p) ->
                    mapOf("accountId" to accountId, "nick" to p.nick, "signal" to p.signal?.toMap(), "hazard" to p.hazard?.toMap())
                },
                "own" to mapOf("signal" to ownPins[PinSlot.SIGNAL], "hazard" to ownPins[PinSlot.HAZARD]),
                "now" to relayNow(),
            ),
        )
    }

    companion object {
        const val PUBLIC_RIDE_FEATURE = "public-ride"
        const val MISSED_POSITIONS_FEATURE = "missed-positions"
        /** Retry even after the rider finishes and GPS stops. */
        const val MISSED_RETRY_MS = 10_000L
        /** Kept positions are thinned to one per this. */
        const val MISSED_SPACING_MS = 5_000L
        /** Kept positions older than this, measured from the newest, are dropped. */
        const val MISSED_MAX_AGE_MS = 3 * 60 * 60_000L
        /** The relay takes at most this many positions per batch. */
        const val MISSED_BATCH_MAX = 500
        /** Looking around re-centres once the rider is this far from the watched point. */
        const val LOOK_AROUND_RECENTRE_M = 1_000.0
        const val MISSED_NOT_STORED = "missed positions not stored"
        const val REASON_REPLACED = "replaced"
        const val REASON_END_TIME = "end-time"
        const val REASON_SIGNED_OUT = "signed-out"
        const val REASON_REFUSED = "refused"
        /** Turns a room pin frame into the public ride's: `public-signal`, `public-hazard-clear`. */
        const val PUBLIC_PREFIX = "public-"
        /** The relay keeps a pin this long; own pins are timed the same. */
        const val PIN_LIFETIME_MS = 90 * 60_000L
        private val REFUSALS = setOf(
            "public ride needs an Account",
            "public ride needs a nick",
            "public ride end time already passed",
        )

        /**
         * A `PublicRiderView` as JS reads it; null without an Account id.
         *
         * @parity /modules/vescape-core/src/index.ts `PublicRider`
         */
        internal fun publicRiderView(obj: JSONObject?): Map<String, Any?>? {
            obj ?: return null
            val accountId = obj.optString("accountId").takeIf { it.isNotEmpty() } ?: return null
            return mapOf(
                "accountId" to accountId,
                "nick" to obj.optString("nick"),
                "presence" to GroupRideObserver.presenceMap(obj.optJSONObject("presence")),
                "trail" to trail(obj.optJSONArray("trail")),
                "stale" to obj.optBoolean("stale"),
                "away" to obj.optBoolean("away"),
                "lastSeen" to obj.optLong("lastSeen"),
            )
        }

        private fun trail(arr: JSONArray?): List<Map<String, Any?>>? {
            arr ?: return null
            return (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let { mapOf("lat" to it.optDouble("lat"), "lng" to it.optDouble("lng")) }
            }
        }
    }
}

/**
 * Another public rider's pins as this phone may see them.
 *
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `PublicPins`
 */
internal data class PublicPins(val nick: String, val signal: RiderSignal?, val hazard: RideHazard?)

private fun JSONObject.optLongOrNull(key: String): Long? = if (has(key) && !isNull(key)) optLong(key) else null

/**
 * Where the switch survives an app restart. Kept out of the settings table on purpose: a backup
 * restored on another phone must not make that phone public.
 *
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `PublicRideStore`
 */
internal class PublicRideStore(context: android.content.Context) {
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, android.content.Context.MODE_PRIVATE)

    fun read(): PublicRideSwitch {
        if (!preferences.getBoolean(ON, false)) return PublicRideSwitch.OFF
        val until = preferences.getLong(UNTIL, NO_END).takeIf { it != NO_END }
        return PublicRideSwitch(on = true, until = until)
    }

    fun write(switch: PublicRideSwitch) {
        preferences.edit()
            .putBoolean(ON, switch.on)
            .putLong(UNTIL, switch.until ?: NO_END)
            .apply()
    }

    private companion object {
        const val PREFERENCES = "vescape_public_ride"
        const val ON = "on"
        const val UNTIL = "until"
        const val NO_END = -1L
    }
}
