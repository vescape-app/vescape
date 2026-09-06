package expo.modules.vescapecore

import android.os.Handler
import android.util.Log
import expo.modules.vescapecore.appstatus.OnlineCapability
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
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var serverUrl: String? = null
    private var reconnectAttempt = 0
    private var stopped = true
    private var riderId: String? = null
    private var riderName: String? = null
    private var riderColor: String? = null
    private var joinedRideId: String? = null
    private var desiredRideId: String? = null
    private var lastPresence: RiderPresence? = null
    /** Remover for the App Status listener; non-null only while observing. */
    private var onlineUnsub: (() -> Unit)? = null
    private val reconnectRunnable = Runnable { connect() }
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            val ws = webSocket
            if (!stopped && ws != null && joinedRideId != null) {
                ws.send(JSONObject().put("type", "heartbeat").toString())
                handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
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

    fun start(url: String) {
        if (!stopped && url == serverUrl) return
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
        stopHeartbeat()
        emitConnection("idle")
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
        stopHeartbeat()
        emit("onGroupRideJoined", mapOf("rideId" to null))
        emit("onGroupRideRoster", mapOf("rideId" to null, "riders" to emptyList<Map<String, Any?>>()))
        emitConnection("blocked")
    }

    /** Callback may arrive after its socket was closed or superseded. */
    private fun isCurrentSocket(ws: WebSocket): Boolean =
        !stopped && !online.onlineBlocked && webSocket === ws

    /**
     * Create a Group Ride over the live observe socket: bind this connection's Rider with
     * `hello`, then send `create` carrying the creator's location and optional name. This is
     * the only location egress while observing. The server fans the result back as
     * `ride-created`, so there is no local optimistic insert here. No-op when not connected.
     */
    fun create(riderId: String, riderName: String, riderColor: String?, name: String?, lat: Double, lng: Double) {
        handler.post {
            val ws = webSocket
            if (stopped || ws == null) {
                Log.w(TAG, "create ignored: observe socket not connected")
                return@post
            }
            if (joinedRideId != null || desiredRideId != null) {
                ws.send(JSONObject().put("type", "leave").toString())
                joinedRideId = null
                desiredRideId = null
                stopHeartbeat()
            }
            sendHello(ws, riderId, riderName, riderColor)
            lastPresence = RiderPresence(lat = lat, lng = lng, heading = null, speed = null, soc = null, motorTemp = null, ctrlTemp = null, phoneBattery = null, boardName = null)
            val create = JSONObject()
                .put("type", "create")
                .put("location", JSONObject().put("lat", lat).put("lng", lng))
            if (!name.isNullOrBlank()) create.put("name", name)
            ws.send(create.toString())
        }
    }

    fun join(riderId: String, riderName: String, riderColor: String?, rideId: String, presence: RiderPresence?) {
        handler.post {
            val ws = webSocket
            if (stopped || ws == null) {
                Log.w(TAG, "join ignored: observe socket not connected")
                return@post
            }
            val previousRideId = joinedRideId ?: desiredRideId
            if (previousRideId != null && previousRideId != rideId) {
                ws.send(JSONObject().put("type", "leave").toString())
                joinedRideId = null
                stopHeartbeat()
            }
            sendHello(ws, riderId, riderName, riderColor)
            desiredRideId = rideId
            presence?.let { lastPresence = it }
            val join = JSONObject()
                .put("type", "join")
                .put("rideId", rideId)
            presence?.let { join.put("presence", it.toJson()) }
            ws.send(join.toString())
        }
    }

    fun leave() {
        handler.post {
            val ws = webSocket ?: return@post
            ws.send(JSONObject().put("type", "leave").toString())
            joinedRideId = null
            desiredRideId = null
            stopHeartbeat()
            emit("onGroupRideJoined", mapOf("rideId" to null))
            emit("onGroupRideRoster", mapOf("rideId" to null, "riders" to emptyList<Map<String, Any?>>()))
        }
    }

    /**
     * Re-bind this connection's Rider identity after a name/color change. Updates the
     * remembered identity (so a reconnect re-announces the fresh values) and, while the
     * socket is live, re-sends `hello` — the server re-emits the roster so peers update
     * without a rejoin. No-op when the observe socket is not connected.
     */
    fun updateIdentity(riderId: String, riderName: String, riderColor: String?) {
        handler.post {
            this.riderId = riderId
            this.riderName = riderName
            this.riderColor = riderColor
            val ws = webSocket
            if (stopped || ws == null) return@post
            sendHello(ws, riderId, riderName, riderColor)
        }
    }

    fun pushPresence(presence: RiderPresence) {
        handler.post {
            val ws = webSocket
            if (stopped || ws == null || joinedRideId == null) return@post
            lastPresence = presence
            ws.send(
                JSONObject()
                    .put("type", "presence")
                    .put("presence", presence.toJson())
                    .toString(),
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
        webSocket = client.newWebSocket(GroupRideOnlineGate.buildObserveRequest(url, online.appVersion), listener)
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            handler.post {
                if (!isCurrentSocket(ws)) return@post
                reconnectAttempt = 0
                emitConnection("connected")
                val id = riderId
                val name = riderName
                if (id != null && name != null) sendHello(ws, id, name, riderColor)
                val rideId = desiredRideId
                if (rideId != null && id != null && name != null) sendJoin(ws, rideId, lastPresence)
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
                emit("onGroupRideSnapshot", mapOf("rides" to rides))
            }
            "ride-created" -> rideSummary(json.optJSONObject("ride"))?.let {
                emit("onGroupRideCreated", mapOf("ride" to it))
            }
            "ride-updated" -> rideSummary(json.optJSONObject("ride"))?.let {
                emit("onGroupRideUpdated", mapOf("ride" to it))
            }
            "ride-ended" -> {
                val rideId = json.optString("rideId")
                if (rideId.isNotEmpty()) emit("onGroupRideEnded", mapOf("rideId" to rideId))
                if (rideId.isNotEmpty() && rideId == joinedRideId) {
                    joinedRideId = null
                    desiredRideId = null
                    stopHeartbeat()
                    emit("onGroupRideJoined", mapOf("rideId" to null))
                    emit(
                        "onGroupRideRoster",
                        mapOf("rideId" to null, "riders" to emptyList<Map<String, Any?>>()),
                    )
                }
            }
            "joined" -> {
                val rideId = json.optString("rideId")
                if (rideId.isNotEmpty()) {
                    joinedRideId = rideId
                    desiredRideId = rideId
                    startHeartbeat()
                    emit("onGroupRideJoined", mapOf("rideId" to rideId))
                }
            }
            "roster" -> {
                val ridersJson = json.optJSONArray("riders")
                val riders = mutableListOf<Map<String, Any?>>()
                if (ridersJson != null) {
                    for (i in 0 until ridersJson.length()) {
                        riderView(ridersJson.optJSONObject(i))?.let(riders::add)
                    }
                }
                emit(
                    "onGroupRideRoster",
                    mapOf(
                        "rideId" to if (json.isNull("rideId")) null else json.optString("rideId").takeIf { it.isNotEmpty() },
                        "riders" to riders,
                    ),
                )
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
            emit("onGroupRideRoster", mapOf("rideId" to null, "riders" to emptyList<Map<String, Any?>>()))
        }
        emit("onGroupRideError", mapOf("message" to message))
    }

    private fun sendHello(ws: WebSocket, riderId: String, riderName: String, riderColor: String?) {
        this.riderId = riderId
        this.riderName = riderName
        this.riderColor = riderColor
        val hello = JSONObject()
            .put("type", "hello")
            .put("riderId", riderId)
            .put("name", riderName)
        if (!riderColor.isNullOrBlank()) hello.put("color", riderColor)
        ws.send(hello.toString())
    }

    private fun sendJoin(ws: WebSocket, rideId: String, presence: RiderPresence?) {
        val join = JSONObject()
            .put("type", "join")
            .put("rideId", rideId)
        presence?.let { join.put("presence", it.toJson()) }
        ws.send(join.toString())
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

    private fun riderView(obj: JSONObject?): Map<String, Any?>? {
        obj ?: return null
        val id = obj.optString("id")
        if (id.isEmpty()) return null
        return mapOf(
            "id" to id,
            "name" to obj.optString("name"),
            // optString turns JSON null into the literal string "null" — guard with isNull.
            "color" to if (obj.isNull("color")) null else obj.optString("color").takeIf { it.isNotEmpty() },
            "presence" to presenceMap(obj.optJSONObject("presence")),
            "trail" to trailList(obj.optJSONArray("trail")),
            "stale" to obj.optBoolean("stale"),
            "lastSeen" to obj.optLong("lastSeen"),
        )
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

    private fun presenceMap(obj: JSONObject?): Map<String, Any?>? {
        obj ?: return null
        return mapOf(
            "lat" to obj.optDouble("lat"),
            "lng" to obj.optDouble("lng"),
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

    // @parity /modules/vescape-core/src/index.ts `GroupRideConnectionState`
    private fun emitConnection(state: String) {
        emit("onGroupRideConnection", mapOf("state" to state))
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
