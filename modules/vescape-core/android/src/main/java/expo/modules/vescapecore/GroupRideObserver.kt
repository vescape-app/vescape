package expo.modules.vescapecore

import android.os.Handler
import android.util.Log
import expo.modules.vescapecore.appstatus.OnlineCapability
import expo.modules.vescapecore.auth.DeviceCredential
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
 * The relay link of the public ride: a native WebSocket to the relay server that lives in the
 * foreground service and carries the [PublicRide] — going public, positions, nearby riders, pins.
 * The socket itself sends no location; [PublicRide] decides what leaves the device.
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
     * Plays a Ride Hazard approach cue.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onCue`
     */
    private val onCue: (String) -> Unit = {},
    /** The device's latest position (lat, lng), for looking around. */
    private val ownLocation: () -> Pair<Double, Double>? = { null },
    /**
     * The fix and Privacy Zone state a Rider Signal send is checked against.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `signalContext`
     */
    private val signalContext: () -> RiderSignalContext = { RiderSignalContext(fix = null, insidePrivacyZone = true) },
    /**
     * Read Account and token together, so a credential change cannot label a new token with the old Account.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `deviceCredential`
     */
    private val deviceCredential: () -> DeviceCredential? = { null },
    private val onPublicRideDemandChanged: () -> Unit = {},
    /** Persists the public ride switch. */
    persistPublicRide: (PublicRideSwitch) -> Unit = {},
    /** The last position the phone knew, for looking around without a fresh fix. */
    private val lastKnownLocation: () -> Pair<Double, Double>? = { null },
    now: () -> Long = System::currentTimeMillis,
    /** Opens the relay socket; tests stand in a fake to see the frames. */
    private val sockets: WebSocket.Factory = OkHttpClient.Builder()
        .pingInterval(PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
        .build(),
) {

    private var webSocket: WebSocket? = null
    private var socketCredential: DeviceCredential? = null
    private var serverUrl: String? = null
    private var reconnectAttempt = 0
    private var stopped = true
    /** Other Riders' signals as Ride Notices. */
    private val signalNotices = RiderSignalNotices()
    /** Other Riders' hazards, announced on approach. */
    private val hazardCues = RideHazardCues()
    /** JS asked to look around; fixes start and re-centre it. */
    private var lookingAround = false
    /** Last availability handed to JS, so only changes are emitted. */
    private var lastSignalAvailability: Map<String, Any?>? = null
    /** Last state handed to JS, replayed by [resync] so a fresh JS runtime is not stuck on `idle`. */
    private var lastConnection = "idle"
    /** Remover for the App Status listener; non-null only while observing. */
    private var onlineUnsub: (() -> Unit)? = null
    private val reconnectRunnable = Runnable { connect() }
    private val missedRetryRunnable = Runnable {
        webSocket?.close(NORMAL_CLOSURE, "missed positions retry")
        scheduleReconnect()
    }
    private val expiryRunnable: Runnable = Runnable { publicRide.expire() }

    /**
     * The public ride on this socket. Main thread, like the rest of the observer.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `publicRide`
     */
    private val publicRide: PublicRide = PublicRide(
        now = now,
        persist = persistPublicRide,
        scheduleExpiry = { delay ->
            handler.removeCallbacks(expiryRunnable)
            delay?.let { handler.postDelayed(expiryRunnable, it) }
        },
        emit = { name, payload ->
            emit(name, payload)
            // Going public or off it changes whether a pin can be sent.
            if (name == "onPublicRideStatus") refreshSignalAvailability()
        },
        send = { frame -> webSocket?.takeIf { linkOpen }?.let { send(it, frame) } ?: false },
        scheduleMissedRetry = { delay ->
            handler.removeCallbacks(missedRetryRunnable)
            delay?.let { handler.postDelayed(missedRetryRunnable, it) }
        },
        onPublicRideDemandChanged = onPublicRideDemandChanged,
        onPins = ::onPublicPins,
    )

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            val ws = webSocket
            if (!stopped && ws != null && publicRide.riding) {
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

    /** The public ride or a look-around needs the socket, so the owner keeps it up. */
    val publicRideNeedsLink: Boolean get() = publicRide.needsLink
    val publicRideNeedsGps: Boolean get() = publicRide.needsGps

    /**
     * What the Watch Mirror draws: the nearby public riders while the rider rides public, else null.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `watchRoster`
     */
    val watchRoster: GroupRideRoster? get() = publicRide.nearbyRoster.takeIf { !stopped }

    fun start(url: String) {
        // The observer outlives the JS runtime (it runs in the foreground service), so a relaunch
        // re-subscribes to a socket that will emit nothing on its own. Replay instead of returning
        // silently, or JS renders `idle`/OFFLINE over a live connection.
        if (!stopped && url == serverUrl) {
            resync()
            return
        }
        if (serverUrl != null && serverUrl != url) publicRide.discardMissed()
        stopped = false
        serverUrl = url
        reconnectAttempt = 0
        onlineUnsub?.invoke()
        // The gate can outlive the JS runtime, so the observe socket reacts to App Status changes
        // directly rather than through JS — tearing down on a block, resuming when it clears.
        onlineUnsub = online.addListener(::onOnlineChanged)
        connect()
        // A fresh JS runtime learns the switch even before the relay answers.
        publicRide.resync()
    }

    fun stop() {
        stopped = true
        handler.removeCallbacks(reconnectRunnable)
        onlineUnsub?.invoke()
        onlineUnsub = null
        webSocket?.close(NORMAL_CLOSURE, "client stop")
        webSocket = null
        // A restarted observer must re-emit availability to the fresh JS store.
        lastSignalAvailability = null
        stopHeartbeat()
        publicRide.linkLost()
        emitConnection("idle")
    }

    /** Replay the current observe state to a JS runtime that just re-subscribed. */
    private fun resync() {
        emitConnection(lastConnection)
        lastSignalAvailability = null
        refreshSignalAvailability()
        publicRide.resync()
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
     * reconnect, close the socket, and surface the distinct `blocked` connection state instead of a
     * disconnect loop. Board Session, Recording, and History are untouched.
     */
    private fun tearDownForBlock() {
        handler.removeCallbacks(reconnectRunnable)
        webSocket?.close(NORMAL_CLOSURE, "online blocked")
        webSocket = null
        reconnectAttempt = 0
        stopHeartbeat()
        publicRide.linkLost()
        emitConnection("blocked")
    }

    /** The socket is open: frames sent now reach the relay. */
    private val linkOpen: Boolean get() = webSocket != null && lastConnection == "connected"

    /** Callback may arrive after its socket was closed or superseded. */
    private fun isCurrentSocket(ws: WebSocket): Boolean =
        !stopped && !online.onlineBlocked && webSocket === ws

    /**
     * Raise a Rider Signal of [kind] at the latest GPS fix on the public ride. Rejected (logged,
     * nothing sent) off the public ride, for an unknown kind, or without a recent fix.
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

    /** Clear the Rider's active signal. */
    fun clearSignal() {
        handler.post { submitPin(RiderPinIntent.Clear(PinSlot.SIGNAL)) }
    }

    /** Clear the Rider's active hazard. */
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
            val public = publicRide.canPin
            val availability = mapOf(
                "supported" to public,
                "hazardsSupported" to public,
                "insidePrivacyZone" to context.insidePrivacyZone,
                "hasRecentFix" to (context.fix != null),
            )
            if (availability == lastSignalAvailability) return@post
            lastSignalAvailability = availability
            emit("onGroupRideSignalAvailability", availability)
        }
    }

    /**
     * A new device GPS fix: plays the approach cue of another Rider's hazard it just closed in on,
     * and moves look-around with the rider.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onFix`
     */
    fun onFix(lat: Double, lng: Double) {
        handler.post {
            if (stopped) return@post
            hazardCues.fix(lat, lng, publicRide.relayNow())?.let(onCue)
            if (lookingAround) publicRide.followNearby(lat to lng)
        }
    }

    private fun submitPin(intent: RiderPinIntent) {
        if (stopped) return
        if (!publicRide.submitPin(intent)) Log.w(TAG, "pin ignored: not riding public")
    }

    fun pushPresence(presence: RiderPresence) {
        handler.post {
            if (stopped) return@post
            presence.at?.let { publicRide.position(presence, it) }
        }
    }

    /**
     * Start the public ride from the persisted switch and the signed-in Account.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `loadPublicRide`
     */
    fun loadPublicRide(stored: PublicRideSwitch, accountId: String?) {
        handler.post { publicRide.load(stored, accountId) }
    }

    /** The rider moved the switch; a refused change (signed out, end time past) re-emits the status. */
    fun setPublicRide(next: PublicRideSwitch) {
        handler.post {
            if (!publicRide.set(next)) publicRide.resync()
        }
    }

    /** @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `setManualPublicRideSharing` */
    fun setManualPublicRideSharing(enabled: Boolean) {
        handler.post { publicRide.setManualSharing(enabled) }
    }

    fun setBoardConnected(connected: Boolean) {
        handler.post { publicRide.setBoardConnected(connected) }
    }

    /**
     * The signed-in Account changed. The public ride ends, and a live socket reconnects so the relay
     * sees the new credential.
     */
    fun setAccount(accountId: String?) {
        handler.post {
            val changed = publicRide.setAccount(accountId)
            val credential = deviceCredential()
            if (stopped || (!changed && credential?.token == socketCredential?.token && credential?.serverUrl == socketCredential?.serverUrl)) return@post
            val ws = webSocket ?: return@post
            webSocket = null
            ws.close(NORMAL_CLOSURE, "account changed")
            reconnectAttempt = 0
            scheduleReconnect()
        }
    }

    /**
     * Look around: watch public riders near the latest fix, or the last known position without one.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `watchPublicRiders`
     */
    fun watchPublicRiders() {
        handler.post {
            lookingAround = true
            val point = ownLocation() ?: lastKnownLocation()
            if (point == null) {
                Log.w(TAG, "look-around waits for a fix: no known position")
                return@post
            }
            publicRide.watchNearby(point)
        }
    }

    fun stopWatchingPublicRiders() {
        handler.post {
            lookingAround = false
            publicRide.stopWatchingNearby()
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
        socketCredential = deviceCredential()?.takeIf {
            it.token.isNotEmpty() && GroupRideOnlineGate.webSocketUrl(it.serverUrl) == url
        }
        webSocket = sockets.newWebSocket(
            GroupRideOnlineGate.buildObserveRequest(url, online.appVersion, socketCredential?.token),
            listener,
        )
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            handler.post {
                if (!isCurrentSocket(ws)) return@post
                reconnectAttempt = 0
                emitConnection("connected")
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
            Log.w(TAG, "Relay WS failure: ${t.message}")
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
        stopHeartbeat()
        publicRide.linkLost()
        emitConnection("disconnected")
        val delay = RECONNECT_DELAYS_MS[reconnectAttempt.coerceAtMost(RECONNECT_DELAYS_MS.lastIndex)]
        reconnectAttempt++
        handler.postDelayed(reconnectRunnable, delay)
    }

    private fun handleMessage(text: String) {
        val json = try {
            JSONObject(text)
        } catch (e: Exception) {
            Log.w(TAG, "Discarding malformed relay frame: ${e.message}")
            return
        }
        when (val type = json.optString("type")) {
            // The relay's greeting lists the optional features it speaks.
            "snapshot" -> {
                publicRide.linkReady(stringSet(json.optJSONArray("features")), socketCredential?.accountId)
                refreshSignalAvailability()
            }
            "error" -> {
                val message = json.optString("message")
                if (message.isNotEmpty() && !publicRide.handleError(message)) Log.w(TAG, "relay error: $message")
            }
            else -> if (publicRide.handle(type, json) && publicRide.riding) startHeartbeat()
        }
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
            Log.w(TAG, "Relay send failed; reconnecting")
            scheduleReconnect()
        }
        return sent
    }

    private fun stringSet(arr: JSONArray?): Set<String> {
        arr ?: return emptySet()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf(String::isNotEmpty) }.toSet()
    }

    // @parity /modules/vescape-core/src/index.ts `GroupRideConnectionState`
    private fun emitConnection(state: String) {
        lastConnection = state
        emit("onGroupRideConnection", mapOf("state" to state))
    }

    /**
     * Public riders' pins changed: they drive the signal notices and the hazard approach cues.
     *
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onPublicPins`
     */
    private fun onPublicPins(signals: List<SignalRider>, hazards: Map<String, RideHazard>, relayNow: Long?) {
        hazardCues.roster(hazards)
        val update = signalNotices.roster(signals, null, relayNow, System.currentTimeMillis())
        update.clears.forEach { RideNotices.clear(it) }
        update.posts.forEach { RideNotices.post(it.key, it.content, it.revision) }
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
         * A rider view map as the typed entry native keeps; null when it carries no id. No presence
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
    /** GPS time of the fix (epoch ms); sent beside the presence on a public ride, never inside it. */
    val at: Long? = null,
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
