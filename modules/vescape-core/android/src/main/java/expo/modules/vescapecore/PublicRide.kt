package expo.modules.vescapecore

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
 * The rider rides public while the switch is active, a board is connected and an Account is signed
 * in. The relay turns an hours switch off at its end time by itself; the local timer only flips the
 * switch for the UI. Signing out or changing Account ends the public ride and turns the switch off.
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
    /** Other riders' pins changed: their signals, their hazards by Account id, and the relay clock. */
    private val onPins: (List<SignalRider>, Map<String, RideHazard>, Long?) -> Unit = { _, _, _ -> },
) {
    var switch: PublicRideSwitch = PublicRideSwitch.OFF
        private set
    private var boardConnected = false
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

    /** The rider should be public right now. */
    val wanted: Boolean get() = switch.activeAt(now()) && boardConnected && accountId != null

    /** Positions go out: the relay confirmed public riding on the open link. */
    val riding: Boolean get() = live && linkReady

    /** The rider can raise a signal or mark a hazard publicly: wanted public, on a relay that has it. */
    val canPin: Boolean get() = wanted && supported

    /** The socket must stay up for the public ride or for looking around. */
    val needsLink: Boolean get() = wanted || lookAround != null

    /** Start from the persisted switch and the signed-in Account. */
    fun load(stored: PublicRideSwitch, account: String?) {
        accountId = account
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
        if (next.on) reason = null
        persist(next)
        armTimer()
        // A new end time must reach the relay: send `public-on` again with it.
        if (changed && next.on && sentOn) sentOn = false
        reconcile()
        emitStatus()
        return true
    }

    fun setBoardConnected(connected: Boolean) {
        if (connected == boardConnected) return
        boardConnected = connected
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
        dropOwnPins()
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
    fun linkReady(features: Set<String>) {
        linkReady = true
        supported = PUBLIC_RIDE_FEATURE in features
        sentOn = false
        live = false
        reconcile()
        lookAround?.let(::sendNearby)
        emitStatus()
    }

    /**
     * The link is gone. Nothing is buffered: positions taken while it is down are dropped (#678
     * keeps them for the reconnect). Watched riders are forgotten until the next `nearby-riders`.
     */
    fun linkLost() {
        linkReady = false
        sentOn = false
        live = false
        if (riders.isNotEmpty()) {
            riders.clear()
            emitRiders()
        }
        emitStatus()
    }

    /** A GPS fix, Privacy Zone gate already applied, taken at [at] (GPS time, epoch ms). */
    fun position(presence: RiderPresence, at: Long) {
        // #678: unsent positions would be buffered here instead of dropped.
        if (!riding) return
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
        if (linkReady) sendNearby(point)
    }

    fun stopWatchingNearby() {
        if (lookAround == null) return
        lookAround = null
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
        if (!linkReady || !supported) return
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

    private fun dropOwnPins() {
        pendingPins.clear()
        if (ownPins.isEmpty()) return
        ownPins.clear()
        emitPins()
    }

    /** The relay clock now, advanced from the last `public-pins`; the phone clock before one. */
    private fun relayNow(): Long = pinsNow?.let { it + now() - pinsReceivedAt } ?: now()

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
            "on" to switch.on,
            "until" to switch.until,
            "live" to riding,
            "supported" to supported,
            "reason" to reason,
        )
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
