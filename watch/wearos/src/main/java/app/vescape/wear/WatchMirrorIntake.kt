package app.vescape.wear

import expo.modules.vescapecore.watch.GroupRideFrameCodec
import expo.modules.vescapecore.watch.RideNoticeFrameCodec
import expo.modules.vescapecore.watch.RideNoticeFrameItem
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchRouteStatusCodec

/**
 * Wrist projection of the phone's channels. Transport and replay submit the same wire payloads;
 * arrival time belongs to the adapter, while expiry is evaluated against the application clock.
 * No radio, UI scheduling, commands or diagnostics live here.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMirrorIntake.swift
 */
internal class WatchMirrorIntake(
    /** Ride Notice expiry is phone wall-clock time, unlike frame freshness. */
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
    /** The Ride Notice the full-screen card shows, or null for the gauges. */
    val rideNoticeCard: RideNoticeFrameItem? get() = rideNotices.card
    private var latestFrame: WatchFrame? = null
    /** Newest last, at most [MIRROR_CADENCE_WINDOW_GAPS] long. */
    private val recentGapsMs = ArrayDeque<Long>()
    private var lastGroupRideAtMs: Long? = null

    fun acceptTelemetry(bytes: ByteArray, receivedAtMs: Long, appliedAtMs: Long): Boolean {
        val frame = WatchFrameDecoder.decode(bytes) ?: return false
        val gapMs = lastFrameAtMs?.let { (receivedAtMs - it).coerceAtLeast(0) }
        // A gap past the longest window was an outage, not a cadence: kept, it would hold the window
        // at its cap for the frames after the reconnect.
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

    /** Null is deletion. Invalid cold payloads replace old values, unlike dropped hot messages. */
    fun acceptRoute(bytes: ByteArray?) { route = bytes?.let(WatchRouteDecoder::decode) }
    fun acceptSettings(payload: Map<String, Any?>?) { settings = WatchSettings.decode(payload.orEmpty()) }
    fun acceptWeather(payload: Map<String, Any?>?) { weather = decodeWatchWeather(payload) }
    fun acceptBoard(payload: Map<String, Any?>?) { board = decodeBoardLightsPayload(payload) }

    /**
     * Null is deletion. An unreadable frame keeps the list held: dropping it could hide a "Rider
     * down" the phone still shows. True when a notice the wrist has not shown arrived (buzz).
     */
    fun acceptRideNotices(bytes: ByteArray?): Boolean {
        if (bytes == null) {
            rideNotices.clear()
            return false
        }
        val frame = RideNoticeFrameCodec.decode(bytes) ?: return false
        return rideNotices.accept(frame, wallClockMs())
    }

    /**
     * The rider tapped the card away. Wrist-local: it returns while the phone posts a new revision.
     * The dismiss command to the phone (#652) is sent next to this call.
     */
    fun hideRideNotice(id: Int, rev: Int) = rideNotices.hide(id, rev)

    /** A complete cold snapshot on startup/reconnect also clears channels absent from the phone. */
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
        // The phone never deletes this item: absent means not written yet, which keeps what is held.
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
        RideNoticeState.card.value = intake.rideNoticeCard
    }

    /** A Ride Notice delivery; buzzes once for a pair the wrist has not shown. */
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
