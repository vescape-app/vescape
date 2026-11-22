package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Scheduler

/**
 * @parity /modules/vescape-core/ios/watch/WatchMirrorCoordinator.swift `WATCH_FRAME_INTERVAL_MS`
 */
internal const val WATCH_FRAME_INTERVAL_MS = 250L
/** @parity /modules/vescape-core/ios/watch/WatchMirrorCoordinator.swift `WATCH_FRAME_AMBIENT_INTERVAL_MS` */
internal const val WATCH_FRAME_AMBIENT_INTERVAL_MS = 5_000L

internal interface WatchMirrorTransport {
    val reachable: Boolean
    val requiresWakeReport: Boolean
    fun start()
    fun stop()
    fun pushFrame(frame: ByteArray)
    fun pushGroup(frame: ByteArray)
    fun pushRouteStatus(status: WatchRouteStatus)
    fun pushSettings(settings: WatchSettings)
    fun pushWeather(weather: WatchWeather)
    fun pushBoard(board: WatchBoard)
    fun launch()
}

internal interface WatchMirrorSources {
    fun routeStatus(): WatchRouteStatus
    fun mapRoute(): WatchMapRouteProgress?
    fun subscribe(routeChanged: () -> Unit, weatherChanged: (WatchWeather) -> Unit): () -> Unit
}

/**
 * @parity /modules/vescape-core/ios/watch/WatchMirrorCoordinator.swift
 */
internal class WatchMirrorCoordinator(
    private val scheduler: Scheduler,
    private val nowMs: () -> Long,
    snapshot: () -> WatchSnapshot,
    isStale: () -> Boolean,
    groupFrame: () -> GroupRideFrame?,
    private val transport: WatchMirrorTransport,
    private val sources: WatchMirrorSources,
    private val record: (String, Map<String, Any?>) -> Unit,
    private val onNavigatingChanged: () -> Unit = {},
    private val mapTiles: (WatchMapRider?) -> Unit = {},
) {
    private var running = false
    private var generation = 0L
    private var unsubscribe: (() -> Unit)? = null
    private var wakeLevel = WatchMirrorWakeLevel.ASLEEP
    private var wakeAtMs = 0L
    private var configuredIntervalMs = WATCH_FRAME_INTERVAL_MS
    private var autoLaunch = true
    private var streetMapEnabled = true
    private var launchedSessionId = 0L
    var navigating = false
        private set
    private val tick = WatchTick(scheduler, { snapshot().also(::updateMapTiles) }, isStale, ::canPushAndTrackNavigation, { frame ->
        transport.pushFrame(frame)
        pushRouteStatus()
    }, configuredIntervalMs)
    private val groupTick = GroupRideFrameTick(scheduler, ::canPush, ::effectiveWakeLevel, groupFrame, transport::pushGroup)

    fun start() {
        if (running) return
        running = true
        val currentGeneration = ++generation
        transport.start()
        unsubscribe = sources.subscribe(
            { scheduler.post { if (running && generation == currentGeneration) pushRouteStatus() } },
            { weather -> scheduler.post { if (running && generation == currentGeneration) transport.pushWeather(weather) } },
        )
        tick.start()
        groupTick.start()
    }

    fun stop() {
        if (!running) return
        running = false
        generation++
        unsubscribe?.invoke()
        unsubscribe = null
        tick.stop()
        groupTick.stop()
        mapTiles(null)
        transport.stop()
        wakeLevel = WatchMirrorWakeLevel.ASLEEP
        navigating = false
        applyInterval()
    }

    private fun effectiveWakeLevel(): WatchMirrorWakeLevel =
        if (nowMs() - wakeAtMs > WATCH_MIRROR_AWAKE_TIMEOUT_MS) WatchMirrorWakeLevel.ASLEEP else wakeLevel

    private fun canPush(): Boolean = running && transport.reachable &&
        (!transport.requiresWakeReport || effectiveWakeLevel() != WatchMirrorWakeLevel.ASLEEP)

    private fun canPushAndTrackNavigation(): Boolean {
        val canPush = canPush()
        val next = canPush && sources.routeStatus().phase == WatchRoutePhase.READY
        if (next != navigating) {
            navigating = next
            onNavigatingChanged()
        }
        if (!canPush) mapTiles(null)
        return canPush
    }

    private fun updateMapTiles(snapshot: WatchSnapshot) {
        val position = snapshot.mapPosition
        mapTiles(
            if (!streetMapEnabled || position == null || effectiveWakeLevel() != WatchMirrorWakeLevel.ACTIVE) null
            else WatchMapRider(position, snapshot.courseDeg, snapshot.riderSpeedMps, snapshot.routeSpanM, sources.mapRoute()),
        )
    }

    fun acceptWakeLevel(level: WatchMirrorWakeLevel) {
        val changed = level != wakeLevel
        wakeLevel = level
        wakeAtMs = nowMs()
        if (changed) record("watch_mirror_wake_level", mapOf("level" to level.name))
        applyInterval()
    }

    fun applySettings(settings: WatchSettings, intervalMs: Long, autoLaunch: Boolean) {
        configuredIntervalMs = intervalMs
        this.autoLaunch = autoLaunch
        streetMapEnabled = settings.streetMapEnabled
        applyInterval()
        transport.pushSettings(settings)
    }

    private fun applyInterval() {
        tick.setIntervalMs(if (effectiveWakeLevel() == WatchMirrorWakeLevel.AMBIENT) WATCH_FRAME_AMBIENT_INTERVAL_MS else configuredIntervalMs)
    }

    private fun pushRouteStatus() {
        if (canPush()) transport.pushRouteStatus(sources.routeStatus())
    }

    fun pushBoard(board: WatchBoard) = transport.pushBoard(board)

    fun boardConnected(sessionId: Long) {
        if (!autoLaunch || !transport.reachable || sessionId == launchedSessionId) return
        launchedSessionId = sessionId
        transport.launch()
    }
}
