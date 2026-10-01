package app.vescape.wear

import expo.modules.vescapecore.watch.GroupRideFrameCodec
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchRouteStatusCodec

/**
 * Wrist projection of the phone's channels. Transport and replay submit the same wire payloads;
 * arrival time belongs to the adapter, while expiry is evaluated against the application clock.
 * No radio, UI scheduling, commands or diagnostics live here.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMirrorIntake.swift
 */
internal class WatchMirrorIntake {
    var mirror = MirrorStateReducer.reduce(null, null, 0)
        private set
    var route: WatchRoute? = null
        private set
    var routeStatus: WatchRouteStatus? = null
        private set
    var settings = WatchSettings()
        private set
    var weather: WatchWeather? = null
        private set
    var board = WatchBoardLights()
        private set
    var groupRide: WatchGroupRide? = null
        private set
    var lastFrameAtMs: Long? = null
        private set
    private var latestFrame: WatchFrame? = null
    private var frameGapMs: Long? = null
    private var lastGroupRideAtMs: Long? = null

    fun acceptTelemetry(bytes: ByteArray, receivedAtMs: Long, appliedAtMs: Long): Boolean {
        val frame = WatchFrameDecoder.decode(bytes) ?: return false
        lastFrameAtMs?.let { frameGapMs = (receivedAtMs - it).coerceAtLeast(0) }
        latestFrame = frame
        lastFrameAtMs = receivedAtMs
        refresh(appliedAtMs)
        return true
    }

    fun acceptGroupRide(bytes: ByteArray, receivedAtMs: Long) {
        val frame = GroupRideFrameCodec.decode(bytes) ?: return
        groupRide = WatchGroupRide.accepting(frame, groupRide)
        lastGroupRideAtMs = receivedAtMs
    }

    fun acceptRouteStatus(bytes: ByteArray?) {
        if (bytes == null) routeStatus = null else WatchRouteStatusCodec.decode(bytes)?.let { routeStatus = it }
    }

    /** Null is deletion. Invalid cold payloads replace old values, unlike dropped hot messages. */
    fun acceptRoute(bytes: ByteArray?) { route = bytes?.let(WatchRouteDecoder::decode) }
    fun acceptSettings(payload: Map<String, Any?>?) { settings = WatchSettings.decode(payload.orEmpty()) }
    fun acceptWeather(payload: Map<String, Any?>?) { weather = decodeWatchWeather(payload) }
    fun acceptBoard(payload: Map<String, Any?>?) { board = decodeBoardLightsPayload(payload) }

    /** A complete cold snapshot on startup/reconnect also clears channels absent from the phone. */
    fun restoreColdState(
        route: ByteArray?, settings: Map<String, Any?>?, weather: Map<String, Any?>?, board: Map<String, Any?>?,
    ) {
        acceptRoute(route)
        acceptSettings(settings)
        acceptWeather(weather)
        acceptBoard(board)
    }

    fun refresh(nowMs: Long) {
        mirror = MirrorStateReducer.reduce(latestFrame, lastFrameAtMs, nowMs, mirrorDisconnectedTimeoutMs(frameGapMs))
        if (mirror.status == MirrorStatus.DISCONNECTED) routeStatus = null
        lastGroupRideAtMs?.let {
            if (nowMs - it > GROUP_RIDE_TIMEOUT_MS) {
                groupRide = null
                lastGroupRideAtMs = null
            }
        }
    }
}

/** Main-thread publication adapter. Existing views subscribe to individual channels, not a giant snapshot. */
internal object MirrorIntakeState {
    private val intake = WatchMirrorIntake()

    fun apply(change: WatchMirrorIntake.() -> Unit) {
        intake.change()
        TelemetryState.mirrorState.value = intake.mirror
        RouteState.accept(intake.route)
        RouteState.status.value = intake.routeStatus
        SettingsState.accept(intake.settings)
        WeatherState.accept(intake.weather)
        BoardState.accept(intake.board)
        GroupRideState.group.value = intake.groupRide
    }

    fun acceptTelemetry(bytes: ByteArray, receivedAtMs: Long, appliedAtMs: Long) = apply {
        if (acceptTelemetry(bytes, receivedAtMs, appliedAtMs)) WatchDiagnostics.recordFrame()
        else WatchDiagnostics.recordDecodeFailure(bytes)
    }
}
