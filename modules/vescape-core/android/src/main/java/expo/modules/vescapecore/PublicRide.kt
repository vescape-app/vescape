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
 * the relay protocol (`public-on`/`public-off`/`public-position`, `nearby`, and the riders the relay
 * reports around the rider). Pure: the [GroupRideObserver] that owns the socket feeds it link and
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

    /** The rider should be public right now. */
    val wanted: Boolean get() = switch.activeAt(now()) && boardConnected && accountId != null

    /** Positions go out: the relay confirmed public riding on the open link. */
    val riding: Boolean get() = live && linkReady

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

    /** Replay state to a JS runtime that just subscribed. */
    fun resync() {
        emitStatus(force = true)
        emitRiders()
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
        emitStatus()
    }

    /** Bring the relay in line with [wanted]. */
    private fun reconcile() {
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

    companion object {
        const val PUBLIC_RIDE_FEATURE = "public-ride"
        const val REASON_REPLACED = "replaced"
        const val REASON_END_TIME = "end-time"
        const val REASON_SIGNED_OUT = "signed-out"
        const val REASON_REFUSED = "refused"
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
