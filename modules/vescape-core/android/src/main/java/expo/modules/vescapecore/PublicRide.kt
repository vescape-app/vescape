package expo.modules.vescapecore

import expo.modules.vescapecore.geo.GeoMath
import expo.modules.vescapecore.watch.GroupRideRoster
import org.json.JSONArray
import org.json.JSONObject
import androidx.annotation.MainThread

/**
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `PublicRideSwitch`
 */
internal data class PublicRideSwitch(val on: Boolean, val until: Long?) {
    fun activeAt(now: Long): Boolean = on && (until == null || until > now)

    companion object {
        val OFF = PublicRideSwitch(on = false, until = null)
    }
}

/**
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift
 */
@MainThread
internal class PublicRide(
    private val now: () -> Long,
    private val persist: (PublicRideSwitch) -> Unit,
    private val scheduleExpiry: (Long?) -> Unit,
    private val emit: (String, Map<String, Any?>) -> Unit,
    private val send: (JSONObject) -> Boolean,
    private val scheduleMissedRetry: (Long?) -> Unit = {},
    private val scheduleRidersFlush: (Long?) -> Unit = {},
    private val onPublicRideDemandChanged: () -> Unit = {},
    private val onPins: (List<SignalRider>, Map<String, RideHazard>, Long?) -> Unit = { _, _, _ -> },
    private val onCue: (String) -> Unit = {},
) {
    var switch: PublicRideSwitch = PublicRideSwitch.OFF
        private set
    private enum class Activation(val wireValue: String) {
        OFF("off"), WAITING("waiting"), PHONE("phone"), BOARD("board"),
    }

    private var boardConnected = false
    private var manualSharing = false
    private var accountId: String? = null
    private var linkReady = false
    private var supported = false
    private var sentOn = false
    private var live = false
    private var reason: String? = null
    private var lookAround: Pair<Double, Double>? = null
    private val riders = LinkedHashMap<String, Map<String, Any?>>()
    private var ridersNow: Long? = null
    /**
     * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `ridersPending`
     */
    private var ridersPending = false
    private var lastStatus: Map<String, Any?>? = null
    /**
     * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `pendingPins`
     */
    private val pendingPins = mutableMapOf<PinSlot, RiderPinIntent>()
    private val ownPins = mutableMapOf<PinSlot, Map<String, Any?>>()
    private var confirmedOwnSignal: RiderSignal? = null
    private val announcedSignals = mutableMapOf<String, RiderSignal>()
    private val pins = LinkedHashMap<String, PublicPins>()
    private var pinsNow: Long? = null
    private var pinsReceivedAt = 0L
    private var missedSupported = false
    /**
     * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `missed`
     */
    private val missed = ArrayDeque<Pair<Long, RiderPresence>>()
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

    val wanted: Boolean
        get() {
            val activation = this.activation
            return activation == Activation.BOARD || activation == Activation.PHONE
        }

    val needsGps: Boolean get() = activation == Activation.PHONE

    val riding: Boolean get() = wanted && live && linkReady

    val canPin: Boolean get() = wanted && supported

    val needsLink: Boolean get() = wanted || lookAround != null || missed.isNotEmpty()

    fun load(stored: PublicRideSwitch, account: String?) {
        accountId = account
        manualSharing = false
        switch = if (account == null || !stored.activeAt(now())) PublicRideSwitch.OFF else stored
        if (switch != stored) persist(switch)
        armTimer()
        emitStatus(force = true)
    }

    fun set(next: PublicRideSwitch): Boolean {
        if (next.on && (accountId == null || !next.activeAt(now()))) return false
        val changed = next != switch
        switch = next
        if (!next.on) manualSharing = false
        if (next.on) reason = null
        persist(next)
        armTimer()
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

    fun setAccount(account: String?): Boolean {
        if (account == accountId) return false
        val hadAccount = accountId != null
        if (sentOn) send(JSONObject().put("type", "public-off"))
        sentOn = false
        live = false
        accountId = account
        manualSharing = false
        linkReady = false
        authenticatedAccount = null
        dropOwnPins()
        announcedSignals.clear()
        resetReceived()
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

    fun expire() {
        if (!switch.on || switch.activeAt(now())) {
            armTimer()
            return
        }
        switchOff(REASON_END_TIME)
    }

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

    fun position(presence: RiderPresence, atMs: Long) {
        if (!wanted) return
        if (!riding) {
            keepMissed(presence, atMs)
            return
        }
        sendMissed()
        send(
            JSONObject()
                .put("type", "public-position")
                .put("at", atMs)
                .put("presence", presence.toJson()),
        )
    }

    fun watchNearby(point: Pair<Double, Double>) {
        lookAround = point
        emitDemand()
        if (linkReady) sendNearby(point)
    }

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
        if (!riding && riders.isNotEmpty()) {
            riders.clear()
            emitRiders()
        }
    }

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

    fun emitCurrentStatus() = emitStatus(force = true)

    fun emitCurrentRiders() = emitRiders()

    fun emitCurrentPins() = emitPins()

    fun resync() {
        emitCurrentStatus()
        emitCurrentRiders()
        emitCurrentPins()
    }

    fun handle(type: String, json: JSONObject): Boolean {
        when (type) {
            "public-status" -> onStatus(json)
            "missed-stored" -> {
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
                if (!ridersPending) {
                    ridersPending = true
                    scheduleRidersFlush(RIDERS_BATCH_MS)
                }
            }
            "public-rider-gone" -> {
                if (riders.remove(json.optString("accountId")) != null) emitRiders()
            }
            "public-pins" -> {
                val id = json.optString("accountId").takeIf { it.isNotEmpty() } ?: return true
                val signal = RiderPin.parse(json.optJSONObject("signal"), RiderSignalKind::fromWire)
                val relayTime = json.optLongOrNull("now")
                if (id == accountId) {
                    if (riding && relayTime != null) confirmOwnSignal(signal, relayTime)
                    return true
                }
                val hazard = RiderPin.parse(json.optJSONObject("hazard"), RideHazardKind::fromWire)
                val previous = pins[id]?.signal
                if (signal == null && hazard == null) pins.remove(id) else pins[id] = PublicPins(json.optString("nick"), signal, hazard)
                if (relayTime != null) {
                    pinsNow = relayTime
                    pinsReceivedAt = now()
                    announcePeerSignal(signal, id, previous, json.optLongOrNull("clearedSignalStartedAt"), relayTime)
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

    private fun confirmOwnSignal(signal: RiderSignal?, relayTime: Long) {
        val previous = confirmedOwnSignal
        confirmedOwnSignal = signal
        if (signal != null && ownPins.containsKey(PinSlot.SIGNAL) &&
            signal.expiresAt > relayTime && signal.startedAt != previous?.startedAt
        ) {
            onCue("groupRide.signal.sent")
        } else if (signal == null && !ownPins.containsKey(PinSlot.SIGNAL) &&
            previous != null && previous.expiresAt > relayTime
        ) {
            onCue("groupRide.signal.cleared")
        }
    }

    private fun announcePeerSignal(
        signal: RiderSignal?,
        riderId: String,
        previous: RiderSignal?,
        clearedStartedAt: Long?,
        relayTime: Long,
    ) {
        announcedSignals.values.removeAll { it.expiresAt <= relayTime }
        if (signal != null && signal.expiresAt > relayTime &&
            (announcedSignals[riderId]?.let { it.startedAt < signal.startedAt } ?: true)
        ) {
            announcedSignals[riderId] = signal
            onCue("groupRide.signal.${signal.kind.wire}")
        } else if (signal == null && previous != null && previous.startedAt == clearedStartedAt) {
            onCue("groupRide.signal.ok")
        }
    }

    fun handleError(message: String): Boolean {
        if (message == MISSED_NOT_STORED) {
            return false
        }
        val why = when (message) {
            CONNECTION_REPLACED -> REASON_REPLACED
            in REFUSALS -> REASON_REFUSED
            else -> return false
        }
        sentOn = false
        live = false
        switchOff(why)
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
            REASON_REPLACED, REASON_END_TIME -> switchOff(why)
            else -> {
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

    private fun reconcile() {
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

    private fun keepMissed(presence: RiderPresence, atMs: Long) {
        if (!wanted || (linkReady && !missedSupported)) return
        val last = missed.lastOrNull()?.first
        if (last != null && atMs - last < MISSED_SPACING_MS) return
        missed.addLast(atMs to presence)
        while (missed.size > missedInFlight &&
            (atMs - missed[missedInFlight].first > MISSED_MAX_AGE_MS || missed.size > MISSED_MAX_AGE_MS / MISSED_SPACING_MS + 1)
        ) missed.removeAt(missedInFlight)
        emitDemand()
    }

    private fun sendMissed() {
        if (!linkReady || accountId == null || authenticatedAccount != accountId || !missedSupported || missedInFlight > 0 || missed.isEmpty()) return
        val batch = missed.take(MISSED_BATCH_MAX)
        val positions = JSONArray()
        batch.forEach { (atMs, presence) -> positions.put(JSONObject().put("at", atMs).put("presence", presence.toJson())) }
        if (send(JSONObject().put("type", "missed-positions").put("positions", positions))) {
            missedInFlight = batch.size
            scheduleMissedRetry(MISSED_RETRY_MS)
        }
    }

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
        confirmedOwnSignal = null
        if (ownPins.isEmpty()) return
        ownPins.clear()
        emitPins()
    }

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

    fun flushRiders() {
        if (ridersPending) emitRiders()
    }

    private fun emitRiders() {
        if (ridersPending) {
            ridersPending = false
            scheduleRidersFlush(null)
        }
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
        const val MISSED_RETRY_MS = 10_000L
        const val RIDERS_BATCH_MS = 250L
        const val MISSED_SPACING_MS = 5_000L
        const val MISSED_MAX_AGE_MS = 3 * 60 * 60_000L
        const val MISSED_BATCH_MAX = 500
        const val LOOK_AROUND_RECENTRE_M = 1_000.0
        const val MISSED_NOT_STORED = "missed positions not stored"
        const val CONNECTION_REPLACED = "connection replaced"
        const val REASON_REPLACED = "replaced"
        const val REASON_END_TIME = "end-time"
        const val REASON_SIGNED_OUT = "signed-out"
        const val REASON_REFUSED = "refused"
        const val PUBLIC_PREFIX = "public-"
        const val PIN_LIFETIME_MS = 90 * 60_000L
        private val REFUSALS = setOf(
            "public ride needs an Account",
            "public ride needs a nick",
            "public ride end time already passed",
        )

        /**
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
 * @parity /modules/vescape-core/ios/groupride/PublicRide.swift `PublicPins`
 */
internal data class PublicPins(val nick: String, val signal: RiderSignal?, val hazard: RideHazard?)

private fun JSONObject.optLongOrNull(key: String): Long? = if (has(key) && !isNull(key)) optLong(key) else null

/**
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
