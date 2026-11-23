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
import androidx.annotation.WorkerThread
import androidx.annotation.MainThread

/**
 * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift
 */
@MainThread
internal class GroupRideObserver(
    private val handler: Handler,
    private val emit: (String, Map<String, Any?>) -> Unit,
    private val online: OnlineCapability,
    /**
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `onCue`
     */
    private val onCue: (String) -> Unit = {},
    private val ownLocation: () -> Pair<Double, Double>? = { null },
    /**
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `signalContext`
     */
    private val signalContext: () -> RiderSignalContext = { RiderSignalContext(fix = null, insidePrivacyZone = true) },
    /**
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `deviceCredential`
     */
    private val deviceCredential: () -> DeviceCredential? = { null },
    private val onPublicRideDemandChanged: () -> Unit = {},
    persistPublicRide: (PublicRideSwitch) -> Unit = {},
    private val lastKnownLocation: () -> Pair<Double, Double>? = { null },
    now: () -> Long = System::currentTimeMillis,
    /** @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `watchNetwork` */
    private val watchNetwork: (onAvailable: () -> Unit) -> (() -> Unit) = { { } },
    private val sockets: WebSocket.Factory = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .pingInterval(PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
        .build(),
) {

    private var webSocket: WebSocket? = null
    private var socketCredential: DeviceCredential? = null
    private var serverUrl: String? = null
    private var reconnectAttempt = 0
    private var stopped = true
    private val signalNotices = RiderSignalNotices()
    private val hazardCues = RideHazardCues()
    private var lookingAround = false
    private var lastSignalAvailability: Map<String, Any?>? = null
    private var lastConnection = "idle"
    private var onlineUnsub: (() -> Unit)? = null
    private var networkUnsub: (() -> Unit)? = null
    private val reconnectRunnable = Runnable { connect() }
    private val missedRetryRunnable = Runnable {
        webSocket?.close(NORMAL_CLOSURE, "missed positions retry")
        scheduleReconnect()
    }
    private val expiryRunnable: Runnable = Runnable { publicRide.expire() }
    private val ridersFlushRunnable: Runnable = Runnable { publicRide.flushRiders() }

    /**
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
            if (name == "onPublicRideStatus") refreshSignalAvailability()
        },
        send = { frame -> webSocket?.takeIf { linkOpen }?.let { send(it, frame) } ?: false },
        scheduleMissedRetry = { delay ->
            handler.removeCallbacks(missedRetryRunnable)
            delay?.let { handler.postDelayed(missedRetryRunnable, it) }
        },
        scheduleRidersFlush = { delay ->
            handler.removeCallbacks(ridersFlushRunnable)
            delay?.let { handler.postDelayed(ridersFlushRunnable, it) }
        },
        onPublicRideDemandChanged = onPublicRideDemandChanged,
        onPins = ::onPublicPins,
        onCue = onCue,
    )

    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            val ws = webSocket
            if (!stopped && ws != null && publicRide.riding) {
                refreshSignalAvailability()
                if (send(ws, JSONObject().put("type", "heartbeat"))) {
                    handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
                }
            }
        }
    }

    val active: Boolean get() = !stopped

    val publicRideNeedsLink: Boolean get() = publicRide.needsLink
    val publicRideNeedsGps: Boolean get() = publicRide.needsGps

    /**
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `watchRoster`
     */
    val watchRoster: GroupRideRoster? get() = publicRide.nearbyRoster.takeIf { !stopped }

    fun start(url: String) {
        if (!stopped && url == serverUrl) {
            resyncNow()
            retryNow(restartPending = false)
            return
        }
        if (serverUrl != null && serverUrl != url) publicRide.discardMissed()
        handler.removeCallbacks(reconnectRunnable)
        webSocket?.let { previous ->
            webSocket = null
            previous.close(NORMAL_CLOSURE, "server changed")
            stopHeartbeat()
            publicRide.linkLost()
        }
        stopped = false
        serverUrl = url
        reconnectAttempt = 0
        onlineUnsub?.invoke()
        onlineUnsub = online.addListener(::onOnlineChanged)
        networkUnsub?.invoke()
        networkUnsub = watchNetwork { handler.post { retryNow(restartPending = true) } }
        connect()
        publicRide.resync()
    }

    fun stop() {
        stopped = true
        handler.removeCallbacks(reconnectRunnable)
        onlineUnsub?.invoke()
        onlineUnsub = null
        networkUnsub?.invoke()
        networkUnsub = null
        webSocket?.close(NORMAL_CLOSURE, "client stop")
        webSocket = null
        lastSignalAvailability = null
        stopHeartbeat()
        publicRide.linkLost()
        emitConnection("idle")
    }

    /** @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `resync` */
    fun resync() {
        handler.post {
            if (stopped) return@post
            resyncNow()
            retryNow(restartPending = false)
        }
    }

    /** @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `replayEvent` */
    fun replayEvent(name: String) {
        handler.post {
            if (stopped) return@post
            when (name) {
                "onGroupRideConnection" -> emitConnection(lastConnection)
                "onGroupRideSignalAvailability" -> {
                    lastSignalAvailability = null
                    refreshSignalAvailability()
                }
                "onPublicRideStatus" -> publicRide.emitCurrentStatus()
                "onPublicRiders" -> publicRide.emitCurrentRiders()
                "onPublicPins" -> publicRide.emitCurrentPins()
            }
        }
    }

    private fun resyncNow() {
        emitConnection(lastConnection)
        lastSignalAvailability = null
        refreshSignalAvailability()
        publicRide.resync()
    }

    private fun retryNow(restartPending: Boolean) {
        if (stopped || online.onlineBlocked || linkOpen) return
        val pending = webSocket
        if (pending != null && !restartPending) return
        handler.removeCallbacks(reconnectRunnable)
        webSocket = null
        pending?.cancel()
        reconnectAttempt = 0
        connect()
    }

    private fun onOnlineChanged() {
        if (stopped) return
        if (online.onlineBlocked) tearDownForBlock()
        else if (webSocket == null) connect()
    }

    private fun tearDownForBlock() {
        handler.removeCallbacks(reconnectRunnable)
        webSocket?.close(NORMAL_CLOSURE, "online blocked")
        webSocket = null
        reconnectAttempt = 0
        stopHeartbeat()
        publicRide.linkLost()
        emitConnection("blocked")
    }

    private val linkOpen: Boolean get() = webSocket != null && lastConnection == "connected"

    private fun isCurrentSocket(ws: WebSocket): Boolean =
        !stopped && !online.onlineBlocked && webSocket === ws

    /**
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `sendSignal`
     */
    fun sendSignal(kind: String) = sendPin(kind, RiderSignalKind.fromWire(kind))

    /**
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

    fun clearSignal() {
        handler.post { submitPin(RiderPinIntent.Clear(PinSlot.SIGNAL)) }
    }

    fun clearHazard() {
        handler.post { submitPin(RiderPinIntent.Clear(PinSlot.HAZARD)) }
    }

    /**
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
            presence.atMs?.let { publicRide.position(presence, it) }
        }
    }

    /**
     * @parity /modules/vescape-core/ios/groupride/GroupRideObserver.swift `loadPublicRide`
     */
    fun loadPublicRide(stored: PublicRideSwitch, accountId: String?) {
        handler.post { publicRide.load(stored, accountId) }
    }

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
        @WorkerThread
        override fun onOpen(ws: WebSocket, response: Response) {
            handler.post {
                if (!isCurrentSocket(ws)) return@post
                reconnectAttempt = 0
                emitConnection("connected")
            }
        }

        @WorkerThread
        override fun onMessage(ws: WebSocket, text: String) {
            handler.post { if (isCurrentSocket(ws)) handleMessage(text) }
        }

        @WorkerThread
        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            handler.post {
                if (isCurrentSocket(ws)) ws.close(NORMAL_CLOSURE, null)
            }
        }

        @WorkerThread
        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            handler.post {
                if (isCurrentSocket(ws)) scheduleReconnect()
            }
        }

        @WorkerThread
        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "Relay WS failure: ${t.message}")
            val code = response?.code
            handler.post {
                if (!isCurrentSocket(ws)) return@post
                if (code == GroupRideOnlineGate.VERSION_REJECTION_CODE) {
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
        private const val PING_INTERVAL_SECONDS = 5L
        private const val CONNECT_TIMEOUT_SECONDS = 5L
        private const val HEARTBEAT_INTERVAL_MS = 3_000L
        private val RECONNECT_DELAYS_MS = longArrayOf(500, 1_000, 2_000, 3_000)

        /**
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
    val atMs: Long? = null,
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
