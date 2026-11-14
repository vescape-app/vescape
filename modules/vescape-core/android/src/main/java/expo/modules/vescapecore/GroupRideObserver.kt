package expo.modules.vescapecore

import android.os.Handler
import android.os.SystemClock
import android.util.Log
import expo.modules.vescapecore.appstatus.OnlineCapability
import expo.modules.vescapecore.geo.GeoMath
import expo.modules.vescapecore.notices.RideNotices
import expo.modules.vescapecore.watch.GeoPoint
import expo.modules.vescapecore.watch.GroupRideRoster
import expo.modules.vescapecore.watch.GroupRideRosterRider
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Group Ride **observe** client: a native WebSocket to the relay server that lives in the
 * foreground service and surfaces ride-lifecycle events to JS. Observing sends NOTHING — it
 * only receives the active-ride [snapshot] on connect, then `ride-created` / `ride-updated` /
 * `ride-ended` deltas (global fan-out). Location leaves the device only when creating/joining
 * (later slices), never while observing.
 *
 * Wire protocol: vescape-server `docs/group-ride/PROTOCOL.md`. All state is touched on the
 * main thread ([handler]); OkHttp callbacks hop back onto it before mutating anything.
 *
 * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift
 */
internal class GroupRideObserver(
    private val handler: Handler,
    private val emit: (String, Map<String, Any?>) -> Unit,
    private val online: OnlineCapability,
    /**
     * Fired whenever [participating] flips, including the transitions the rider never asked for — a
     * host ending the ride, an App Status block tearing the socket down, a relay saying the ride is
     * gone. GPS demand is resolved from participation, so a departure nobody reports is a monitor
     * left running for a ride that no longer exists.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onParticipationChanged`
     */
    private val onParticipationChanged: () -> Unit = {},
    /**
     * Plays a Group Ride app cue: `groupRide.created` for a new ride the rider created or one
     * nearby, and `joined`, `riderJoined`, `riderLeft`, `lost`, `restored` as the joined ride changes.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onCue`
     */
    private val onCue: (String) -> Unit = {},
    /** The device's latest position (lat, lng), for the nearby test of `groupRide.created`. */
    private val ownLocation: () -> Pair<Double, Double>? = { null },
    /**
     * The fix and Privacy Zone state a Rider Signal send is checked against.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `signalContext`
     */
    private val signalContext: () -> RiderSignalContext = { RiderSignalContext(fix = null, insidePrivacyZone = true) },
    /** Opens the relay socket; tests stand in a fake to see the frames. */
    private val sockets: WebSocket.Factory = OkHttpClient.Builder()
        .pingInterval(PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
        .build(),
) {

    private var webSocket: WebSocket? = null
    private var serverUrl: String? = null
    private var reconnectAttempt = 0
    private var stopped = true
        set(value) {
            field = value
            notifyParticipationIfChanged()
        }
    private var riderId: String? = null
    private var riderName: String? = null
    private var joinedRideId: String? = null
        set(value) {
            field = value
            notifyParticipationIfChanged()
        }
    private var desiredRideId: String? = null
        set(value) {
            if (value != field) {
                forgetRideCues()
                // A pin intent belongs to the ride it was made in.
                pendingPins.clear()
            }
            field = value
            notifyParticipationIfChanged()
        }
    /** Cue decisions for the joined ride; any change of the wanted ride forgets them. */
    private val cues = GroupRideCues()
    /** Other Riders' signals as Ride Notices; forgotten with [cues]. */
    private val signalNotices = RiderSignalNotices()
    /** Other Riders' hazards, announced on approach; forgotten with [cues]. */
    private val hazardCues = RideHazardCues()
    /**
     * The latest pin intent per slot made while the relay was out of reach, replayed once the ride
     * is rejoined. A later intent in the same slot overwrites it; leaving the ride drops them.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `pendingPins`
     */
    private val pendingPins = mutableMapOf<PinSlot, RiderPinIntent>()
    /** Optional capabilities the connected relay advertised in its `snapshot`. */
    private var relayFeatures: Set<String> = emptySet()
    private fun supports(slot: PinSlot): Boolean = slot.relayFeature in relayFeatures
    /** Last availability handed to JS, so only changes are emitted. */
    private var lastSignalAvailability: Map<String, Any?>? = null
    /** Relay clock (epoch ms) of [lastRoster]; null from relays that predate it. */
    private var lastRosterNow: Long? = null
    /** Monotonic time [lastRosterNow] was taken at, to advance it when the roster is replayed. */
    private var lastRosterReceivedAt = 0L
    /**
     * The rider left while the socket was down, so the relay still holds them in the ride as away.
     * Sent once right after the next `hello`; a create/join before then supersedes it, since the
     * relay leaves the previous ride itself.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `pendingLeave`
     */
    private var pendingLeave = false

    /** Last `participating` value handed to the owner, so only real transitions are reported. */
    private var lastParticipating = false
    private var lastPresence: RiderPresence? = null
    /** Last state handed to JS, replayed by [resync] so a fresh JS runtime is not stuck on `idle`. */
    private var lastConnection = "idle"
    /** Active rides as last known from the relay, keyed by id; the relay only sends a full
     *  snapshot on connect, so the cache is what a re-subscribing JS runtime gets. */
    private val knownRides = LinkedHashMap<String, Map<String, Any?>>()
    private var lastRosterRideId: String? = null
    private var lastRoster: List<Map<String, Any?>> = emptyList()
    /** [lastRoster] typed for native readers; kept in step by [emitRoster]. */
    private var lastRosterRiders: List<GroupRideRosterRider> = emptyList()
    /** Remover for the App Status listener; non-null only while observing. */
    private var onlineUnsub: (() -> Unit)? = null
    private val reconnectRunnable = Runnable { connect() }
    private val lostRunnable = Runnable { cues.graceElapsed()?.let(onCue) }
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            val ws = webSocket
            if (!stopped && ws != null && joinedRideId != null) {
                // The beat also ages the GPS fix a send needs.
                refreshSignalAvailability()
                if (send(ws, JSONObject().put("type", "heartbeat"))) {
                    handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
                }
            }
        }
    }

    /** True while the observe connection should be kept alive (drives service idle checks). */
    val active: Boolean get() = !stopped

    /**
     * True while the rider is in (or rejoining) a specific ride. Distinct from [active]: the app
     * observes the lobby whenever it is open, but only real ride participation should block
     * board-less shutdown paths like Auto close.
     */
    val participating: Boolean get() = !stopped && (joinedRideId != null || desiredRideId != null)

    /**
     * The joined Group Ride for the Watch Mirror, or null while the Rider is not in one. A roster
     * that has not arrived yet (or belongs to another ride) reads as empty: joined, nobody placed.
     * Main thread, like every other read and write of this observer's state.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `joinedRoster`
     */
    val joinedRoster: GroupRideRoster?
        get() {
            val rideId = joinedRideId
            if (stopped || rideId == null) return null
            return GroupRideRoster(riderId, if (lastRosterRideId == rideId) lastRosterRiders else emptyList())
        }

    /**
     * Watches the three fields [participating] is derived from, so no mutation site has to remember
     * to report — and so the report lands *after* the state changed, which a caller refreshing right
     * after an enqueued `handler.post` cannot do. Edge-triggered: the fields are cleared together in
     * several places and the owner must not see a departure per field.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `notifyParticipationIfChanged`
     */
    private fun notifyParticipationIfChanged() {
        val current = participating
        if (current == lastParticipating) return
        lastParticipating = current
        onParticipationChanged()
    }

    fun start(url: String) {
        // The observer outlives the JS runtime (it runs in the foreground service), so a relaunch
        // re-subscribes to a socket that will emit nothing on its own. Replay instead of returning
        // silently, or JS renders `idle`/OFFLINE over a live connection.
        if (!stopped && url == serverUrl) {
            resync()
            return
        }
        stopped = false
        serverUrl = url
        reconnectAttempt = 0
        onlineUnsub?.invoke()
        // The gate can outlive the JS runtime, so the observe socket reacts to App Status changes
        // directly rather than through JS — tearing down on a block, resuming when it clears.
        onlineUnsub = online.addListener(::onOnlineChanged)
        connect()
    }

    fun stop() {
        stopped = true
        handler.removeCallbacks(reconnectRunnable)
        onlineUnsub?.invoke()
        onlineUnsub = null
        webSocket?.close(NORMAL_CLOSURE, "client stop")
        webSocket = null
        joinedRideId = null
        desiredRideId = null
        lastPresence = null
        knownRides.clear()
        relayFeatures = emptySet()
        // A restarted observer must re-emit availability to the fresh JS store.
        lastSignalAvailability = null
        lastRosterRideId = null
        lastRoster = emptyList()
        lastRosterRiders = emptyList()
        lastRosterNow = null
        stopHeartbeat()
        emitConnection("idle")
    }

    /**
     * [stop] for a deliberate Exit: a participating rider with an open socket first sends `leave`,
     * so the relay drops them now instead of holding them as away until its expiry. OkHttp writes
     * queued frames before the close frame, so the `leave` is flushed ahead of the close. With the
     * socket down nothing is sent; the relay's away expiry removes the rider. Every other stop path
     * (App Status block, Auto close, JS runtime restarts) uses plain [stop] and keeps them away.
     *
     * @platform-diff iOS has no deliberate Exit: its Live Activity offers only Stop ride and the
     * `exitApp` caller is the Android back button, so an iOS rider is removed by the away expiry.
     */
    fun leaveAndStop() {
        handler.post {
            val ws = webSocket
            if (participating && ws != null && linkOpen) send(ws, JSONObject().put("type", "leave"))
            stop()
        }
    }

    /** Replay the current observe state to a JS runtime that just re-subscribed. */
    private fun resync() {
        emitConnection(lastConnection)
        // Snapshot first: JS drops an active ride that is missing from the ride list.
        emit("onGroupRideSnapshot", mapOf("rides" to knownRides.values.toList()))
        emit("onGroupRideJoined", mapOf("rideId" to joinedRideId))
        // JS times pins from the replayed `now` as if it had just arrived, so advance it first.
        emitRoster(
            lastRosterRideId,
            lastRoster,
            lastRosterNow?.let { it + SystemClock.elapsedRealtime() - lastRosterReceivedAt },
        )
        lastSignalAvailability = null
        refreshSignalAvailability()
    }

    /**
     * React to an App Status change while observing: tear down the moment online work is blocked,
     * or reconnect once a block clears. Runs on the main thread (the coordinator fetch posts there).
     */
    private fun onOnlineChanged() {
        if (stopped) return
        if (online.onlineBlocked) tearDownForBlock()
        // Block cleared while observing with no socket (torn down by an earlier block, or refused
        // at start): resume. A change arriving while connected leaves the live socket alone.
        else if (webSocket == null) connect()
    }

    /**
     * Drop an active/reconnecting observe socket because online work is now blocked: cancel
     * reconnect, close the socket, clear ride/roster state, and surface the distinct `blocked`
     * connection state instead of a disconnect loop. Board Session, Recording, and History are
     * untouched — this only gates Group Ride.
     */
    private fun tearDownForBlock() {
        handler.removeCallbacks(reconnectRunnable)
        webSocket?.close(NORMAL_CLOSURE, "online blocked")
        webSocket = null
        reconnectAttempt = 0
        joinedRideId = null
        desiredRideId = null
        knownRides.clear()
        stopHeartbeat()
        emit("onGroupRideJoined", mapOf("rideId" to null))
        emitRoster(null, emptyList())
        emitConnection("blocked")
    }

    /** The socket is open: frames sent now reach the relay after this connection's `hello`. */
    private val linkOpen: Boolean get() = webSocket != null && lastConnection == "connected"

    /** Callback may arrive after its socket was closed or superseded. */
    private fun isCurrentSocket(ws: WebSocket): Boolean =
        !stopped && !online.onlineBlocked && webSocket === ws

    /**
     * Create a Group Ride over the live observe socket: bind this connection's Rider with
     * `hello`, then send `create` carrying the creator's location and optional name. This is
     * the only location egress while observing. The server fans the result back as
     * `ride-created`, so there is no local optimistic insert here. No-op when not connected.
     * With [auto] the relay joins the nearest ride in range instead, creating only when none is.
     */
    fun create(riderId: String, riderName: String, name: String?, lat: Double, lng: Double, auto: Boolean) {
        handler.post {
            val ws = webSocket
            if (stopped || ws == null) {
                Log.w(TAG, "create ignored: observe socket not connected")
                return@post
            }
            if (joinedRideId != null || desiredRideId != null) {
                send(ws, JSONObject().put("type", "leave"))
                joinedRideId = null
                desiredRideId = null
                stopHeartbeat()
            }
            pendingLeave = false
            sendHello(ws, riderId, riderName)
            lastPresence = RiderPresence(lat = lat, lng = lng, heading = null, speed = null, soc = null, motorTemp = null, ctrlTemp = null, phoneBattery = null, boardName = null)
            val create = JSONObject()
                .put("type", "create")
                .put("location", JSONObject().put("lat", lat).put("lng", lng))
            if (!name.isNullOrBlank()) create.put("name", name)
            if (auto) create.put("auto", true)
            send(ws, create)
        }
    }

    fun join(riderId: String, riderName: String, rideId: String, presence: RiderPresence?) {
        handler.post {
            val ws = webSocket
            if (stopped || ws == null) {
                Log.w(TAG, "join ignored: observe socket not connected")
                return@post
            }
            val previousRideId = joinedRideId ?: desiredRideId
            if (previousRideId != null && previousRideId != rideId) {
                send(ws, JSONObject().put("type", "leave"))
                joinedRideId = null
                stopHeartbeat()
            }
            pendingLeave = false
            sendHello(ws, riderId, riderName)
            desiredRideId = rideId
            presence?.let { lastPresence = it }
            val join = JSONObject()
                .put("type", "join")
                .put("rideId", rideId)
            presence?.let { join.put("presence", it.toJson()) }
            send(ws, join)
        }
    }

    /**
     * Leave the ride now, connected or not: no rejoin on reconnect, no cues for it, and JS sees the
     * same departure as a live leave. While the socket is down the relay keeps the rider as away,
     * so the leave waits in [pendingLeave] for the next connection.
     */
    fun leave() {
        handler.post {
            val ws = webSocket
            if (ws != null && linkOpen) {
                send(ws, JSONObject().put("type", "leave"))
            } else if (joinedRideId != null || desiredRideId != null) {
                pendingLeave = true
            }
            joinedRideId = null
            desiredRideId = null
            stopHeartbeat()
            emit("onGroupRideJoined", mapOf("rideId" to null))
            emitRoster(null, emptyList())
        }
    }

    /**
     * Re-bind this connection's Rider identity after a name change. Updates the remembered
     * identity (so a reconnect re-announces the fresh values) and, while the socket is live,
     * re-sends `hello` — the server re-emits the roster so peers update without a rejoin.
     * No-op when the observe socket is not connected.
     */
    fun updateIdentity(riderId: String, riderName: String) {
        handler.post {
            this.riderId = riderId
            this.riderName = riderName
            val ws = webSocket
            if (stopped || ws == null) return@post
            sendHello(ws, riderId, riderName)
        }
    }

    /**
     * Raise a Rider Signal of [kind] at the latest GPS fix. Rejected (logged, nothing sent) outside a
     * ride, for an unknown kind, without a recent fix, or against a relay that
     * does not advertise signals. While the relay is out of reach the intent waits for the rejoin.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `sendSignal`
     */
    fun sendSignal(kind: String) = sendPin(kind, RiderSignalKind.fromWire(kind))

    /**
     * Mark a Ride Hazard of [kind] at the latest GPS fix; gated like [sendSignal].
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `sendHazard`
     */
    fun sendHazard(kind: String) = sendPin(kind, RideHazardKind.fromWire(kind))

    private fun sendPin(wire: String, kind: PinKind?) {
        handler.post {
            val intent = kind?.let { RiderSignals.sendIntent(it, signalContext()) }
            if (intent == null) {
                Log.w(TAG, "pin rejected: kind=$wire, unknown kind or no recent fix")
                return@post
            }
            submitPin(intent)
        }
    }

    /** Clear the Rider's active signal; held like a send while the relay is out of reach. */
    fun clearSignal() {
        handler.post { submitPin(RiderPinIntent.Clear(PinSlot.SIGNAL)) }
    }

    /** Clear the Rider's active hazard; held like a send while the relay is out of reach. */
    fun clearHazard() {
        handler.post { submitPin(RiderPinIntent.Clear(PinSlot.HAZARD)) }
    }

    /**
     * Recompute what JS needs to offer a signal or hazard; emits only on change.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `refreshSignalAvailability`
     * @parity /modules/vescape-core/src/index.ts `GroupRideSignalAvailability`
     */
    fun refreshSignalAvailability() {
        handler.post {
            if (stopped) return@post
            val context = signalContext()
            val availability = mapOf(
                "supported" to supports(PinSlot.SIGNAL),
                "hazardsSupported" to supports(PinSlot.HAZARD),
                "insidePrivacyZone" to context.insidePrivacyZone,
                "hasRecentFix" to (context.fix != null),
            )
            if (availability == lastSignalAvailability) return@post
            lastSignalAvailability = availability
            emit("onGroupRideSignalAvailability", availability)
        }
    }

    /**
     * A new device GPS fix: plays the approach cue of another Rider's hazard it just closed in on.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onFix`
     */
    fun onFix(lat: Double, lng: Double) {
        handler.post {
            if (stopped || joinedRideId == null) return@post
            hazardCues.fix(lat, lng)?.let(onCue)
        }
    }

    private fun submitPin(intent: RiderPinIntent) {
        if (stopped || !participating) {
            Log.w(TAG, "pin ignored: not in a ride")
            return
        }
        val ws = webSocket?.takeIf { linkOpen && joinedRideId != null }
        if (ws == null) {
            pendingPins[intent.slot] = intent
            return
        }
        pendingPins.remove(intent.slot)
        if (supports(intent.slot)) {
            // A socket already closing refuses the frame: hold it for the rejoin like an offline
            // intent, unless a newer one took the slot meanwhile.
            if (!send(ws, intent.frame())) pendingPins.putIfAbsent(intent.slot, intent)
        } else {
            Log.w(TAG, "pin ignored: relay does not support ${intent.slot.relayFeature}")
        }
    }

    fun pushPresence(presence: RiderPresence) {
        handler.post {
            val ws = webSocket
            if (stopped || ws == null || joinedRideId == null) return@post
            lastPresence = presence
            send(ws,
                JSONObject()
                    .put("type", "presence")
                    .put("presence", presence.toJson()),
            )
        }
    }

    private fun connect() {
        val url = serverUrl ?: return
        if (stopped) return
        // Native owns the gate: refuse the upgrade (fresh start or scheduled reconnect) while online
        // work is blocked, surfacing `blocked` instead of hammering the relay.
        if (online.onlineBlocked) {
            emitConnection("blocked")
            return
        }
        emitConnection("connecting")
        webSocket = sockets.newWebSocket(GroupRideOnlineGate.buildObserveRequest(url, online.appVersion), listener)
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            handler.post {
                if (!isCurrentSocket(ws)) return@post
                reconnectAttempt = 0
                emitConnection("connected")
                val id = riderId
                val name = riderName
                if (id == null || name == null) return@post
                sendHello(ws, id, name)
                if (pendingLeave) {
                    pendingLeave = false
                    send(ws, JSONObject().put("type", "leave"))
                }
                desiredRideId?.let { sendJoin(ws, it, lastPresence) }
            }
        }

        override fun onMessage(ws: WebSocket, text: String) {
            handler.post { if (isCurrentSocket(ws)) handleMessage(text) }
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            handler.post {
                if (isCurrentSocket(ws)) ws.close(NORMAL_CLOSURE, null)
            }
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            handler.post {
                if (isCurrentSocket(ws)) scheduleReconnect()
            }
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "Group Ride observe WS failure: ${t.message}")
            val code = response?.code
            handler.post {
                if (!isCurrentSocket(ws)) return@post
                if (code == GroupRideOnlineGate.VERSION_REJECTION_CODE) {
                    // Server refused the upgrade for this app version — refresh App Status so the
                    // gate learns the block, and surface `blocked` rather than reconnect-looping.
                    online.refresh()
                    tearDownForBlock()
                    return@post
                }
                scheduleReconnect()
            }
        }
    }

    private fun scheduleReconnect() {
        webSocket = null
        if (stopped) return
        if (cues.linkDropped()) handler.postDelayed(lostRunnable, GroupRideCues.LOST_GRACE_MS)
        joinedRideId = null
        stopHeartbeat()
        emitConnection("disconnected")
        val delay = RECONNECT_DELAYS_MS[reconnectAttempt.coerceAtMost(RECONNECT_DELAYS_MS.lastIndex)]
        reconnectAttempt++
        handler.postDelayed(reconnectRunnable, delay)
    }

    private fun handleMessage(text: String) {
        val json = try {
            JSONObject(text)
        } catch (e: Exception) {
            Log.w(TAG, "Discarding malformed Group Ride frame: ${e.message}")
            return
        }
        when (json.optString("type")) {
            "snapshot" -> {
                val ridesJson = json.optJSONArray("rides")
                val rides = mutableListOf<Map<String, Any?>>()
                if (ridesJson != null) {
                    for (i in 0 until ridesJson.length()) {
                        rideSummary(ridesJson.optJSONObject(i))?.let(rides::add)
                    }
                }
                knownRides.clear()
                rides.forEach { ride -> (ride["id"] as? String)?.let { knownRides[it] = ride } }
                relayFeatures = stringSet(json.optJSONArray("features"))
                emit("onGroupRideSnapshot", mapOf("rides" to rides))
                refreshSignalAvailability()
            }
            "ride-created" -> rideSummary(json.optJSONObject("ride"))?.let {
                val isNew = it["id"] !in knownRides
                rememberRide(it)
                val location = it["location"] as? Map<*, *>
                val lat = location?.get("lat") as? Double
                val lng = location?.get("lng") as? Double
                val creatorId = (it["creator"] as? Map<*, *>)?.get("id") as? String
                if (isNew && lat != null && lng != null && rideCreatedAudible(creatorId, riderId, lat, lng, ownLocation())) {
                    onCue("groupRide.created")
                }
                emit("onGroupRideCreated", mapOf("ride" to it))
            }
            "ride-updated" -> rideSummary(json.optJSONObject("ride"))?.let {
                rememberRide(it)
                emit("onGroupRideUpdated", mapOf("ride" to it))
            }
            "ride-ended" -> {
                val rideId = json.optString("rideId")
                if (rideId.isNotEmpty()) {
                    knownRides.remove(rideId)
                    emit("onGroupRideEnded", mapOf("rideId" to rideId))
                }
                if (rideId.isNotEmpty() && rideId == joinedRideId) {
                    joinedRideId = null
                    desiredRideId = null
                    stopHeartbeat()
                    emit("onGroupRideJoined", mapOf("rideId" to null))
                    emitRoster(null, emptyList())
                }
            }
            "joined" -> {
                val rideId = json.optString("rideId")
                if (rideId.isNotEmpty()) {
                    // The wanted ride first: switching rides forgets the old ride's cues.
                    desiredRideId = rideId
                    handler.removeCallbacks(lostRunnable)
                    cues.joined(rideId)?.let(onCue)
                    joinedRideId = rideId
                    startHeartbeat()
                    emit("onGroupRideJoined", mapOf("rideId" to rideId))
                    // Replay pin intents made while the relay was out of reach.
                    pendingPins.values.toList().forEach(::submitPin)
                }
            }
            "roster" -> {
                val ridersJson = json.optJSONArray("riders")
                val riders = mutableListOf<Map<String, Any?>>()
                val signals = mutableMapOf<String, RiderSignal>()
                val hazards = mutableMapOf<String, RideHazard>()
                if (ridersJson != null) {
                    for (i in 0 until ridersJson.length()) {
                        val obj = ridersJson.optJSONObject(i)
                        val signal = RiderPin.parse(obj?.optJSONObject("signal"), RiderSignalKind::fromWire)
                        val hazard = RiderPin.parse(obj?.optJSONObject("hazard"), RideHazardKind::fromWire)
                        val view = riderView(obj, signal, hazard) ?: continue
                        riders += view
                        signal?.let { signals[view["id"] as String] = it }
                        hazard?.let { hazards[view["id"] as String] = it }
                    }
                }
                val rideId = if (json.isNull("rideId")) null else json.optString("rideId").takeIf { it.isNotEmpty() }
                val now = if (json.has("now")) json.optLong("now") else null
                if (rideId != null && rideId == joinedRideId) {
                    val awayIds = riders.filter { it["away"] == true }.mapNotNull { it["id"] as? String }.toSet()
                    val ownHazard = riderId?.let { hazards[it] }
                    hazardCues.roster(hazards.filterKeys { it != riderId })
                    cues.roster(rideId, riders.mapNotNull { it["id"] as? String }, awayIds, riderId, signals, now, ownHazard)?.let(onCue)
                    val signalRiders = riders.map {
                        val id = it["id"] as String
                        SignalRider(id, it["name"] as? String ?: "", signals[id])
                    }
                    val update = signalNotices.roster(signalRiders, riderId, now, System.currentTimeMillis())
                    update.clears.forEach(RideNotices::clear)
                    update.posts.forEach { RideNotices.post(it.key, it.content, it.revision) }
                }
                emitRoster(rideId, riders, now)
            }
            "error" -> {
                val message = json.optString("message")
                if (message.isNotEmpty()) {
                    handleError(message)
                }
            }
        }
    }

    private fun handleError(message: String) {
        val missingRideId = message.removePrefix(NO_SUCH_RIDE_PREFIX).takeIf { it != message }?.trim()
        if (missingRideId != null) {
            val isCurrentRide = missingRideId == desiredRideId || missingRideId == joinedRideId
            if (!isCurrentRide) return
            joinedRideId = null
            desiredRideId = null
            stopHeartbeat()
            emit("onGroupRideJoined", mapOf("rideId" to null))
            emitRoster(null, emptyList())
        }
        emit("onGroupRideError", mapOf("message" to message))
    }

    private fun sendHello(ws: WebSocket, riderId: String, riderName: String) {
        this.riderId = riderId
        this.riderName = riderName
        send(ws,
            JSONObject()
                .put("type", "hello")
                .put("riderId", riderId)
                .put("name", riderName),
        )
    }

    private fun sendJoin(ws: WebSocket, rideId: String, presence: RiderPresence?) {
        val join = JSONObject()
            .put("type", "join")
            .put("rideId", rideId)
        presence?.let { join.put("presence", it.toJson()) }
        send(ws, join)
    }

    private fun send(ws: WebSocket, frame: JSONObject): Boolean {
        val sent = try {
            ws.send(frame.toString())
        } catch (error: Exception) {
            expo.modules.vescapecore.diagnostics.UnexpectedNativeError.report(
                "group_ride_frame_encode", "encode_failed", error,
            )
            false
        }
        if (!sent && isCurrentSocket(ws)) {
            Log.w(TAG, "Group Ride send failed; reconnecting")
            scheduleReconnect()
        }
        return sent
    }

    /** Decode the `RideSummary` shape shared by `snapshot` and `ride-created`. */
    private fun rideSummary(obj: JSONObject?): Map<String, Any?>? {
        obj ?: return null
        val id = obj.optString("id")
        if (id.isEmpty()) return null
        val location = obj.optJSONObject("location") ?: return null
        val creator = obj.optJSONObject("creator") ?: return null
        return mapOf(
            "id" to id,
            "name" to obj.optString("name"),
            "createdAt" to obj.optLong("createdAt"),
            "riderCount" to obj.optInt("riderCount"),
            "location" to mapOf(
                "lat" to location.optDouble("lat"),
                "lng" to location.optDouble("lng"),
            ),
            "creator" to mapOf(
                "id" to creator.optString("id"),
                "name" to creator.optString("name"),
            ),
        )
    }

    /** @parity /modules/vescape-core/src/index.ts `GroupRideRider` */
    private fun riderView(obj: JSONObject?, signal: RiderSignal?, hazard: RideHazard?): Map<String, Any?>? {
        obj ?: return null
        val id = obj.optString("id")
        if (id.isEmpty()) return null
        return mapOf(
            "id" to id,
            "name" to obj.optString("name"),
            "presence" to presenceMap(obj.optJSONObject("presence")),
            "trail" to trailList(obj.optJSONArray("trail")),
            "stale" to obj.optBoolean("stale"),
            // The relay keeps a Rider whose socket closed as `away`; older relays omit it.
            "away" to obj.optBoolean("away"),
            "lastSeen" to obj.optLong("lastSeen"),
            "signal" to signal?.toMap(),
            "hazard" to hazard?.toMap(),
        )
    }

    private fun stringSet(arr: JSONArray?): Set<String> {
        arr ?: return emptySet()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf(String::isNotEmpty) }.toSet()
    }

    private fun trailList(arr: JSONArray?): List<Map<String, Any?>>? {
        arr ?: return null
        val points = mutableListOf<Map<String, Any?>>()
        for (i in 0 until arr.length()) {
            val p = arr.optJSONObject(i) ?: continue
            points.add(mapOf("lat" to p.optDouble("lat"), "lng" to p.optDouble("lng")))
        }
        return points
    }

    private fun rememberRide(ride: Map<String, Any?>) {
        (ride["id"] as? String)?.let { knownRides[it] = ride }
    }

    private fun emitRoster(rideId: String?, riders: List<Map<String, Any?>>, now: Long? = null) {
        lastRosterRideId = rideId
        lastRoster = riders
        lastRosterRiders = riders.mapNotNull(::rosterRider)
        lastRosterNow = now
        lastRosterReceivedAt = SystemClock.elapsedRealtime()
        emit("onGroupRideRoster", mapOf("rideId" to rideId, "riders" to riders, "now" to now))
    }

    // @parity /modules/vescape-core/src/index.ts `GroupRideConnectionState`
    private fun emitConnection(state: String) {
        lastConnection = state
        emit("onGroupRideConnection", mapOf("state" to state))
    }

    /** The rider is out of the ride: drop its cue state, a pending `lost` included, and signal notices. */
    private fun forgetRideCues() {
        cues.reset()
        hazardCues.reset()
        signalNotices.reset().forEach { RideNotices.clear(it) }
        handler.removeCallbacks(lostRunnable)
    }

    private fun startHeartbeat() {
        handler.removeCallbacks(heartbeatRunnable)
        handler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
    }

    private fun stopHeartbeat() {
        handler.removeCallbacks(heartbeatRunnable)
    }

    companion object {
        private const val TAG = "GroupRideObserver"
        private const val NORMAL_CLOSURE = 1000
        private const val PING_INTERVAL_SECONDS = 20L
        // Must stay well under the server's 5s stale threshold: it's the sole keepalive
        // when a Rider isn't actively streaming presence (stationary, no GPS/board), so a
        // slower beat would leave them perpetually greyed as "Stale".
        private const val HEARTBEAT_INTERVAL_MS = 3_000L
        private const val NO_SUCH_RIDE_PREFIX = "no such ride:"
        private val RECONNECT_DELAYS_MS = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000)

        /**
         * Null without both finite coordinates, so neither the phone map nor the watch places the
         * Rider (not at 0,0, not at NaN).
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `presenceMap`
         */
        internal fun presenceMap(obj: JSONObject?): Map<String, Any?>? {
            obj ?: return null
            val lat = obj.optDouble("lat").takeIf { it.isFinite() } ?: return null
            val lng = obj.optDouble("lng").takeIf { it.isFinite() } ?: return null
            return mapOf(
                "lat" to lat,
                "lng" to lng,
                "heading" to obj.optionalDouble("heading"),
                "speed" to obj.optionalDouble("speed"),
                "soc" to obj.optionalDouble("soc"),
                "motorTemp" to obj.optionalDouble("motorTemp"),
                "ctrlTemp" to obj.optionalDouble("ctrlTemp"),
                "phoneBattery" to obj.optionalDouble("phoneBattery"),
                "boardName" to obj.optString("boardName").takeIf { it.isNotEmpty() },
                "target" to obj.optJSONObject("target")?.let {
                    mapOf("lat" to it.optDouble("lat"), "lng" to it.optDouble("lng"))
                },
            )
        }

        /**
         * Discovery radius for nearby Group Rides.
         *
         * @parity /src/modules/group-ride/lib/nearby.ts `NEARBY_RADIUS_M`
         */
        internal const val NEARBY_RADIUS_M = 40_000.0

        /**
         * Whether a ride just created plays `groupRide.created`: the rider created it, or it lies
         * within [NEARBY_RADIUS_M] of [own]. Without a position only the rider's own ride counts.
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `rideCreatedAudible`
         */
        internal fun rideCreatedAudible(
            creatorId: String?,
            ownRiderId: String?,
            rideLat: Double,
            rideLng: Double,
            own: Pair<Double, Double>?,
        ): Boolean {
            if (ownRiderId != null && creatorId == ownRiderId) return true
            own ?: return false
            return GeoMath.distanceMeters(own.first, own.second, rideLat, rideLng) <= NEARBY_RADIUS_M
        }

        /**
         * A [riderView] map as the typed entry native keeps; null when it carries no id. No presence
         * leaves the Rider unplaced.
         *
         * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `rosterRider`
         */
        internal fun rosterRider(view: Map<String, Any?>): GroupRideRosterRider? {
            val id = view["id"] as? String ?: return null
            val presence = view["presence"] as? Map<*, *>
            val lat = presence?.get("lat") as? Double
            val lng = presence?.get("lng") as? Double
            return GroupRideRosterRider(
                id = id,
                name = view["name"] as? String ?: "",
                position = if (lat != null && lng != null) GeoPoint(lat, lng) else null,
                stale = view["stale"] as? Boolean ?: false,
                away = view["away"] as? Boolean ?: false,
                lastSeenMs = view["lastSeen"] as? Long ?: 0L,
                soc = presence?.get("soc") as? Double,
                motorTempC = presence?.get("motorTemp") as? Double,
                ctrlTempC = presence?.get("ctrlTemp") as? Double,
            )
        }
    }
}

/**
 * The Rider's shared map target (their direction Map Point).
 * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `TargetPoint`
 */
internal data class TargetPoint(
    val lat: Double,
    val lng: Double,
)

/** @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `RiderPresence` */
internal data class RiderPresence(
    val lat: Double,
    val lng: Double,
    val heading: Double?,
    val speed: Double?,
    val soc: Double?,
    val motorTemp: Double?,
    val ctrlTemp: Double?,
    val phoneBattery: Double?,
    val boardName: String?,
    val target: TargetPoint? = null,
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
            .put("lat", lat)
            .put("lng", lng)
        heading?.let { json.put("heading", it) }
        speed?.let { json.put("speed", it) }
        soc?.let { json.put("soc", it) }
        motorTemp?.let { json.put("motorTemp", it) }
        ctrlTemp?.let { json.put("ctrlTemp", it) }
        phoneBattery?.let { json.put("phoneBattery", it) }
        boardName?.let { json.put("boardName", it) }
        target?.let { json.put("target", JSONObject().put("lat", it.lat).put("lng", it.lng)) }
        return json
    }
}

private fun JSONObject.optionalDouble(key: String): Double? =
    if (has(key) && !isNull(key)) optDouble(key) else null
