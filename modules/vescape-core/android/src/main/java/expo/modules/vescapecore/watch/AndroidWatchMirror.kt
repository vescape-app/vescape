package expo.modules.vescapecore.watch

import android.content.Context
import android.os.SystemClock
import expo.modules.vescapecore.maptiles.MapTiles
import expo.modules.vescapecore.navigation.NavigationController
import expo.modules.vescapecore.navigation.NavigationStatus
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.weather.WeatherCoordinator
import kotlinx.coroutines.CoroutineScope

/**
 * Android source/transport adapters; no stream timing or Board Session lifetime decisions.
 * @parity /modules/vescape-core/ios/watch/IOSWatchMirror.swift
 * @platform-diff Android route cold-state publication is process-scoped inside NavigationController;
 * service-scoped mirroring subscribes only to live route status. iOS binds both at process launch.
 */
internal fun androidWatchMirror(
    context: Context,
    scope: CoroutineScope,
    scheduler: Scheduler,
    snapshot: () -> WatchSnapshot,
    isStale: () -> Boolean,
    groupFrame: () -> GroupRideFrame?,
    record: (String, Map<String, Any?>) -> Unit,
    onNavigatingChanged: () -> Unit,
): WatchMirrorCoordinator {
    val navigation = NavigationController.get(context)
    val weather = WeatherCoordinator.get()
    val presence = WatchMirrorPresence(context, scope, record)
    val telemetry = WatchTelemetryPusher(context, scope, record)
    val settingsPusher = WatchSettingsPusher.get(context, scope)
    val weatherPusher = WatchWeatherPusher(context, scope, record)
    val boardPusher = WatchBoardPusher(context, scope, record)
    val launcher = WatchMirrorLauncher(context, scope, record)
    val mapTiles = WatchMapTileSender(
        scheduler, scope, SystemClock::elapsedRealtime,
        fetch = { tile -> MapTiles.get(context).tile(tile.z, tile.x, tile.y) },
        transport = WatchMapTilePusher(context),
    )
    return WatchMirrorCoordinator(
        scheduler, SystemClock::elapsedRealtime, snapshot, isStale, groupFrame,
        transport = object : WatchMirrorTransport {
            override val reachable get() = presence.present
            override val requiresWakeReport get() = presence.reportsWakeLevel
            override fun start() = presence.start()
            override fun stop() = presence.stop()
            override fun pushFrame(frame: ByteArray) = telemetry.pushFrame(frame)
            override fun pushGroup(frame: ByteArray) = telemetry.pushGroupRideFrame(frame)
            override fun pushRouteStatus(status: WatchRouteStatus) = telemetry.pushRouteStatus(status)
            override fun pushSettings(settings: WatchSettings) = settingsPusher.push(settings)
            override fun pushWeather(weather: WatchWeather) = weatherPusher.push(weather)
            override fun pushBoard(board: WatchBoard) = boardPusher.push(board)
            override fun launch() = launcher.launch()
        },
        sources = object : WatchMirrorSources {
            override fun routeStatus(): WatchRouteStatus {
                val current = navigation.current
                val phase = when {
                    navigation.computing -> WatchRoutePhase.COMPUTING
                    current == null -> WatchRoutePhase.IDLE
                    current.status != NavigationStatus.READY || WatchRouteMirror.failed -> WatchRoutePhase.FAILED
                    else -> WatchRoutePhase.READY
                }
                return WatchRouteStatus(phase, WatchRouteMirror.desiredRouteId)
            }
            override fun mapRoute(): WatchMapRouteProgress? {
                val route = WatchRouteMirror.mapRoute ?: return null
                return navigation.currentProgress?.let { WatchMapRouteProgress(route, it.remainingMeters) }
            }
            override fun subscribe(routeChanged: () -> Unit, weatherChanged: (WatchWeather) -> Unit): () -> Unit {
                navigation.onWatchChange = routeChanged
                val unsubscribe = weather.addChangeListener { it?.let { value -> weatherChanged(value.toWatchWeather()) } }
                weather.current?.let { weatherChanged(it.toWatchWeather()) }
                return {
                    navigation.onWatchChange = null
                    unsubscribe()
                }
            }
        },
        record = record,
        onNavigatingChanged = onNavigatingChanged,
        mapTiles = mapTiles::update,
    )
}
