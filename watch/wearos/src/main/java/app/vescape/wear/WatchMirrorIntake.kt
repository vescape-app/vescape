package app.vescape.wear

import expo.modules.vescapecore.watch.GroupRideFrameCodec
import expo.modules.vescapecore.watch.RideNoticeFrameCodec
import expo.modules.vescapecore.watch.RideNoticeFrameItem
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchRouteStatusCodec

/**
 * @parity /modules/vescape-core/ios/watch/WatchMirrorIntake.swift
 */
internal class WatchMirrorIntake(
    private val wallClockMs: () -> Long = System::currentTimeMillis,
) {
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
    private val rideNotices = WatchRideNotices()
    val rideNoticeCard: RideNoticeFrameItem? get() = rideNotices.card
    private var latestFrame: WatchFrame? = null
    private val recentGapsMs = ArrayDeque<Long>()
    private var lastGroupRideAtMs: Long? = null

    fun acceptTelemetry(bytes: ByteArray, receivedAtMs: Long, appliedAtMs: Long): Boolean {
        val frame = WatchFrameDecoder.decode(bytes) ?: return false
        val gapMs = lastFrameAtMs?.let { (receivedAtMs - it).coerceAtLeast(0) }
        if (gapMs != null && gapMs <= MIRROR_DISCONNECTED_MAX_TIMEOUT_MS) {
            recentGapsMs.addLast(gapMs)
            if (recentGapsMs.size > MIRROR_CADENCE_WINDOW_GAPS) recentGapsMs.removeFirst()
        }
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

    fun acceptRoute(bytes: ByteArray?) { route = bytes?.let(WatchRouteDecoder::decode) }
    fun acceptSettings(payload: Map<String, Any?>?) { settings = WatchSettings.decode(payload.orEmpty()) }
    fun acceptWeather(payload: Map<String, Any?>?) { weather = decodeWatchWeather(payload) }
    fun acceptBoard(payload: Map<String, Any?>?) { board = decodeBoardLightsPayload(payload) }

    fun acceptRideNotices(bytes: ByteArray?): Boolean {
        if (bytes == null) {
            rideNotices.clear()
            return false
        }
        val frame = RideNoticeFrameCodec.decode(bytes) ?: return false
        return rideNotices.accept(frame, wallClockMs())
    }

    fun hideRideNotice(id: Int, rev: Int) = rideNotices.hide(id, rev)

    fun restoreColdState(
        route: ByteArray?,
        settings: Map<String, Any?>?,
        weather: Map<String, Any?>?,
        board: Map<String, Any?>?,
        rideNotices: ByteArray?,
    ): Boolean {
        acceptRoute(route)
        acceptSettings(settings)
        acceptWeather(weather)
        acceptBoard(board)
        return rideNotices?.let(::acceptRideNotices) ?: false
    }

    fun refresh(nowMs: Long) {
        mirror = MirrorStateReducer.reduce(latestFrame, lastFrameAtMs, nowMs, mirrorDisconnectedTimeoutMs(recentGapsMs.maxOrNull()))
        if (mirror.status == MirrorStatus.DISCONNECTED) routeStatus = null
        rideNotices.prune(wallClockMs())
        lastGroupRideAtMs?.let {
            if (nowMs - it > GROUP_RIDE_TIMEOUT_MS) {
                groupRide = null
                lastGroupRideAtMs = null
            }
        }
    }
}

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
        RideNoticeState.card.value = intake.rideNoticeCard
    }

    fun acceptRideNotices(change: WatchMirrorIntake.() -> Boolean) {
        var fresh = false
        apply { fresh = change() }
        if (fresh) RideNoticeState.buzz()
    }

    fun acceptTelemetry(bytes: ByteArray, receivedAtMs: Long, appliedAtMs: Long) = apply {
        if (acceptTelemetry(bytes, receivedAtMs, appliedAtMs)) WatchDiagnostics.recordFrame()
        else WatchDiagnostics.recordDecodeFailure(bytes)
    }
}
