package app.vescape.wear

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.vescapecore.telemetry.TelemetryLevel
import expo.modules.vescapecore.watch.WatchRouteStatus
import expo.modules.vescapecore.watch.WatchRouteStatusCodec
import expo.modules.vescapecore.watch.GroupRideFrameCodec
import expo.modules.vescapecore.watch.WatchRoutePhase
import expo.modules.vescapecore.watch.GroupRideFrame
import expo.modules.vescapecore.watch.GroupRideFrameRider
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchMapTile
import org.json.JSONObject
import expo.modules.vescapecore.watch.WatchTrailPoint
import expo.modules.vescapecore.watch.WatchTrailCodec
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.PI
import kotlin.math.sin

/**
 * Emulator-only Watch Frame replay: feeds recorded lane samples into [TelemetryState] on the same
 * path a phone push takes, so Mirror visuals can be worked on without a board, a phone or a ride.
 *
 * The watch never sees board protocol (ADR-0019), so the fixtures are lane-only JSONL generated on
 * the host by `scripts/generate-watch-fixtures.ts` from a Debug Recording. Replay is gated to a
 * debuggable build on an emulator: a real watch keeps showing real frames, and a release build has
 * no replay path at all.
 */

/** Fixture assets shipped with the watch app. [RIDE] is a real recorded ride, [SWEEP] walks every lane's full range. */
const val REPLAY_FIXTURE_RIDE = "watch-ride.jsonl"
const val REPLAY_FIXTURE_SWEEP = "watch-sweep.jsonl"

/**
 * Fixtures for the two surfaces the phone pushes outside the frame stream: the route the rider lanes
 * are placed on, and the forecast. Both fixtures are shared by every lane fixture — they describe the
 * ride's surroundings, not its telemetry.
 */
private const val REPLAY_FIXTURE_ROUTE = "watch-route.json"
private const val REPLAY_FIXTURE_WEATHER = "watch-weather.json"

/**
 * Dark street-map tiles along the replayed route: the list (`{style, tiles}`) and one JPEG per tile
 * under [REPLAY_MAP_TILE_DIR] as `<z>/<x>/<y>.jpg`. They stand in for the phone's tile items.
 */
private const val REPLAY_FIXTURE_MAP_TILES = "watch-map-tiles.json"
private const val REPLAY_MAP_TILE_DIR = "watch-map-tiles"

/**
 * The Group Ride the replayed Rider is in: a cast of other Riders covering every mark and status the
 * wrist draws. Opt-in (`bun run wear:replay ride --group`), so the not-joined layout replays too.
 */
private const val REPLAY_FIXTURE_GROUP_RIDE = "watch-group-ride.json"

/** The phone pushes the Group Ride Frame about once a second; replay keeps the same pace. */
private const val REPLAY_GROUP_RIDE_INTERVAL_MS = 1_000L

/** One recorded moment: the frame to show and the recording-relative time to show it at. */
/** @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySample` */
data class ReplaySample(val atMs: Long, val frame: WatchFrame)

/**
 * Pure lane-fixture parser. A fixture is dev input that ships as an asset, so a malformed line is
 * skipped rather than crashing the Mirror — a partly-readable fixture still animates the gauges.
 */
/** @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplayFixtureParser` */
object ReplayFixtureParser {
    /** [origin]: where the fixture's metres sit on the globe (`watch-route.json`); null leaves no map position. */
    fun parse(lines: Sequence<String>, wander: Boolean = false, origin: WatchMapPosition? = null): List<ReplaySample> {
        val recorded = lines.mapNotNull(::parseLine).toList()
        val samples = if (wander) withDetours(recorded) else recorded
        return samples.mapIndexed { index, sample ->
            val east = sample.frame.riderEastM
            val north = sample.frame.riderNorthM
            val count = minOf(index + 1, WatchTrailCodec.MAX_POINTS)
            val trail = if (east == null || north == null) emptyList() else (0 until count).mapNotNull { i ->
                val point = samples[if (count == 1) 0 else i * index / (count - 1)].frame
                val x = point.riderEastM ?: return@mapNotNull null
                val y = point.riderNorthM ?: return@mapNotNull null
                WatchTrailPoint(x - east, y - north)
            }
            val position = if (origin == null || east == null || north == null) null else
                WatchMirrorReplayAdapter.position(origin, east, north)
            sample.copy(frame = sample.frame.copy(trail = trail, mapPosition = position))
        }
    }

    /** Smooth, seeded world-space detours. Rejoin every two minutes; never mutate the planned route.
     * @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplayFixtureParser.withDetours`
     */
    private fun withDetours(samples: List<ReplaySample>): List<ReplaySample> {
        fun target(node: Long, axis: Long): Double {
            if (node % 4 == 0L) return 0.0
            var seed = ((node * 2 + axis) * 1664525 + 1013904223) and 0xffffffffL
            seed = ((seed xor (seed shr 16)) * 1664525 + 1013904223) and 0xffffffffL
            return (seed.toDouble() / 4294967295.0 * 2 - 1) * 35
        }
        var previous: WatchFrame? = null
        return samples.map { sample ->
            val east = sample.frame.riderEastM ?: return@map sample
            val north = sample.frame.riderNorthM ?: return@map sample
            val node = sample.atMs / 30_000
            val t = (sample.atMs % 30_000).toDouble() / 30_000
            val eased = t * t * (3 - 2 * t)
            fun offset(axis: Long) = target(node, axis) + (target(node + 1, axis) - target(node, axis)) * eased
            val x = east + offset(0)
            val y = north + offset(1)
            val dx = previous?.riderEastM?.let { x - it }
            val dy = previous?.riderNorthM?.let { y - it }
            val course = if (dx != null && dy != null && hypot(dx, dy) > 0.1) {
                (Math.toDegrees(atan2(dx, dy)) + 360) % 360
            } else sample.frame.courseDeg
            val frame = sample.frame.copy(riderEastM = x, riderNorthM = y, courseDeg = course)
            previous = frame
            sample.copy(frame = frame)
        }
    }

    private fun parseLine(line: String): ReplaySample? {
        if (line.isBlank()) return null
        return try {
            val json = JSONObject(line)
            ReplaySample(
                atMs = json.getLong("t"),
                frame = WatchFrame(
                    speed = json.getDouble("speed"),
                    duty = json.nullableLane("duty"),
                    battery = json.nullableLane("battery"),
                    motorTemp = json.nullableLane("motorTemp"),
                    ctrlTemp = json.nullableLane("ctrlTemp"),
                    stale = json.optBoolean("stale", false),
                    navBearing = json.nullableLane("navBearing"),
                    navDistanceM = json.nullableLane("navDistance"),
                    riderEastM = json.nullableLane("riderEast"),
                    riderNorthM = json.nullableLane("riderNorth"),
                    courseDeg = json.nullableLane("course"),
                    routeSpanM = json.nullableLane("routeSpanM"),
                ),
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun JSONObject.nullableLane(key: String): Double? =
        if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
}

/**
 * Parsers for the non-frame fixtures. Both mirror what the phone would have pushed, so replay
 * exercises the same state the real Data Layer paths feed — [WatchRouteDecoder] and the weather
 * message listener are the only other way into these two objects.
 */
/** @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySceneParser` */
object ReplaySceneParser {
    /** Route points as metres east/north of the origin, the frame the rider lanes are relative to. */
    // @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySceneParser.parseRoute`
    fun parseRoute(json: String): WatchRoute? = try {
        val points = JSONObject(json).getJSONArray("points")
        WatchRoute(
            (0 until points.length()).map { index ->
                val point = points.getJSONObject(index)
                RoutePoint(
                    eastM = point.getDouble("east").toFloat(),
                    northM = point.getDouble("north").toFloat(),
                )
            },
        ).takeIf { it.points.isNotEmpty() }
    } catch (e: Exception) {
        null
    }

    /** The route's geographic origin: where its metres, and the rider lanes', sit on the map. */
    // @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySceneParser.parseOrigin`
    fun parseOrigin(json: String): WatchMapPosition? = try {
        val origin = JSONObject(json).getJSONObject("origin")
        WatchMapPosition(origin.getDouble("latitude"), origin.getDouble("longitude"))
    } catch (e: Exception) {
        null
    }

    /** The street-map tiles shipped beside the fixtures. Their style only matters to watchOS's store. */
    // @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySceneParser.parseMapTiles`
    fun parseMapTiles(json: String): List<WatchMapTile> = try {
        val tiles = JSONObject(json).getJSONArray("tiles")
        (0 until tiles.length()).mapNotNull { WatchMapTile.parse(tiles.getString(it)) }
    } catch (e: Exception) {
        emptyList()
    }

    /**
     * The fixture forecast, anchored to [nowMs]: the fixture carries no clock times, so the hours are
     * laid out from the next full hour and the reading is stamped as fresh. A fixed clock time would
     * age out mid-session and read as yesterday's weather.
     * @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySceneParser.parseWeather`
     */
    fun parseWeather(json: String, nowMs: Long, minuteOfDay: Int): WatchWeather? = try {
        val root = JSONObject(json)
        val hours = root.getJSONArray("hourly")
        val firstHour = (minuteOfDay / 60 + 1) * 60
        WatchWeather(
            temperatureC = root.getInt("temperatureC"),
            icon = root.getString("icon"),
            label = root.getString("label"),
            precipitationProbability = root.getInt("precipitationProbability"),
            hourly = (0 until hours.length()).map { index ->
                val hour = hours.getJSONObject(index)
                WatchWeatherHour(
                    minuteOfDay = (firstHour + index * 60) % (24 * 60),
                    temperatureC = hour.getInt("temperatureC"),
                    icon = hour.getString("icon"),
                    precipitationProbability = hour.getInt("precipitationProbability"),
                )
            },
            sunriseMinuteOfDay = root.getInt("sunriseMinuteOfDay"),
            sunsetMinuteOfDay = root.getInt("sunsetMinuteOfDay"),
            latitude = root.optDouble("latitude").takeIf { !it.isNaN() },
            longitude = root.optDouble("longitude").takeIf { !it.isNaN() },
            fetchedAtMs = nowMs,
        )
    } catch (e: Exception) {
        null
    }

    /**
     * Parser for [REPLAY_FIXTURE_GROUP_RIDE]. Levels are named ("warning", "critical") and missing ones
     * read as normal; the phone classifies, so the fixture states them rather than deriving them.
     *
     * @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplaySceneParser.parseGroupRide`
     */
    internal fun parseGroupRide(json: String): ReplayGroupRide? = try {
        val root = JSONObject(json)
        val riders = root.getJSONArray("riders")
        ReplayGroupRide(
            courseDeg = root.optDouble("courseDeg").takeIf { !it.isNaN() },
            spanM = root.getDouble("spanM"),
            riders = (0 until riders.length()).map { index ->
                val rider = riders.getJSONObject(index)
                val swing = rider.optJSONObject("swing")
                ReplayGroupRider(
                    rider = GroupRideFrameRider(
                        id = rider.getString("id"),
                        name = rider.getString("name"),
                        colorArgb = (0xFF000000 or rider.getString("color").removePrefix("#").toLong(16)).toInt(),
                        eastM = rider.getDouble("east"),
                        northM = rider.getDouble("north"),
                        stale = rider.optBoolean("stale", false),
                        batteryPercent = if (rider.has("battery")) rider.getInt("battery") else null,
                        batteryLevel = replayLevel(rider.optString("batteryLevel")),
                        heatLevel = replayLevel(rider.optString("heatLevel")),
                    ),
                    swingEastM = swing?.optDouble("east", 0.0) ?: 0.0,
                    swingNorthM = swing?.optDouble("north", 0.0) ?: 0.0,
                    swingPeriodMs = ((swing?.optDouble("periodS", 0.0) ?: 0.0) * 1000).toLong(),
                )
            },
        ).takeIf { it.riders.isNotEmpty() }
    } catch (e: Exception) {
        null
    }

    private fun replayLevel(name: String): TelemetryLevel =
        TelemetryLevel.entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: TelemetryLevel.NORMAL
}

/**
 * The Group Ride fixture: each Rider sits at a base east/north offset and may swing sinusoidally
 * around it, so distances, bearings and the in-range boundary move like a real ride.
 *
 * @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplayGroupRide`
 */
internal data class ReplayGroupRide(val courseDeg: Double?, val spanM: Double, val riders: List<ReplayGroupRider>) {
    /** The frame the phone would push [atMs] into replay; [courseDeg] is the ride's own when known. */
    fun frame(atMs: Long, courseDeg: Double?): GroupRideFrame = GroupRideFrame(
        courseDeg = courseDeg ?: this.courseDeg,
        spanM = spanM,
        riders = riders.map { it.at(atMs) },
    )
}

/** @parity /modules/vescape-core/ios/watch/WatchReplay.swift `ReplayGroupRider` */
internal data class ReplayGroupRider(
    val rider: GroupRideFrameRider,
    val swingEastM: Double,
    val swingNorthM: Double,
    val swingPeriodMs: Long,
) {
    fun at(elapsedMs: Long): GroupRideFrameRider {
        if (swingPeriodMs <= 0) return rider
        val wave = sin(2 * PI * elapsedMs / swingPeriodMs)
        return rider.copy(eastM = rider.eastM + swingEastM * wave, northM = rider.northM + swingNorthM * wave)
    }
}

/**
 * The gate every emulator-only dev mode passes through: fixture replay, and the forced ambient
 * rendering the always-on layout is worked on with. A real watch and a release build have neither.
 */
/** @parity /watch/watchos/FrameReplay.swift `FrameReplayer.requestedFixture` */
object DevGate {
    /**
     * A dev mode is explicit and never inferred: `bun run wear:replay` asks for one, and a normal
     * emulator launch listens to its paired phone like a real watch instead of silently replacing
     * those frames with a fixture. Emulator detection reads [Build] rather than `ro.kernel.qemu`,
     * which is not readable from the SDK.
     */
    fun isEnabled(context: Context, requested: Boolean): Boolean =
        requested && isDebuggable(context) && isEmulator()

    private fun isDebuggable(context: Context): Boolean =
        context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    private fun isEmulator(): Boolean =
        Build.FINGERPRINT.contains("/sdk_") ||
            Build.PRODUCT.startsWith("sdk_") ||
            Build.DEVICE.startsWith("emu")
}

/**
 * Plays a lane fixture into [TelemetryState] at its recorded pace, looping forever so the wrist
 * keeps moving while the visuals are being worked on. Main-thread only, like the message listener.
 */
/** @parity /watch/watchos/FrameReplay.swift `FrameReplayer` */
class FrameReplayer(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private var samples: List<ReplaySample> = emptyList()
    private var index = 0
    private var loopStartedAt = 0L
    private var running = false

    /** The tilt a replayed phone would be commanding: the last lock the wrist sent, or neutral. */
    private var tilt = TILT_CENTER

    /** The Group Ride fed alongside the frames, when replay was asked to join one. */
    private var groupRide: ReplayGroupRide? = null

    /** The replayed Rider's latest course, which the phone also puts in its Group Ride Frame. */
    private var courseDeg: Double? = null
    private var startedAt = 0L

    /**
     * Stand in for the phone's Remote Tilt so the Tilt page can be felt on an emulator: a lock is
     * echoed into every following frame, a cancel ([value] null) returns to neutral at once.
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.echoTilt`
     */
    fun echoTilt(value: Int?) {
        tilt = value ?: TILT_CENTER
    }

    /** [group]: also play the Group Ride fixture, as if the Rider had joined one. */
    fun start(fixture: String, group: Boolean, navigation: Boolean = true, wander: Boolean = false, routeLoading: Boolean = false) {
        if (running) return
        val routeJson = readAsset(REPLAY_FIXTURE_ROUTE)
        val origin = routeJson?.let(ReplaySceneParser::parseOrigin)
        samples = load(fixture, wander, origin).map { sample ->
            if (navigation) sample else sample.copy(frame = sample.frame.copy(
                navBearing = null, navDistanceM = null, riderEastM = null, riderNorthM = null,
            ))
        }
        if (samples.isEmpty()) return
        WatchDiagnostics.recordReplay(fixture, samples.size)
        loadScene(routeJson, origin)
        MirrorIntakeState.apply {
            acceptRouteStatus(if (routeLoading) WatchRouteStatusCodec.encode(WatchRouteStatus(WatchRoutePhase.READY, 1)) else null)
            if (routeLoading) acceptRoute(null)
        }
        groupRide = if (group) readAsset(REPLAY_FIXTURE_GROUP_RIDE)?.let(ReplaySceneParser::parseGroupRide) else null
        running = true
        startedAt = SystemClock.elapsedRealtime()
        restartLoop()
        if (groupRide != null) pushGroupRide()
    }

    /**
     * One Group Ride Frame into [GroupRideState], the path a decoded phone frame takes, then the next
     * a second later.
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.startGroupRide`
     */
    private fun pushGroupRide() {
        val group = groupRide ?: return
        if (!running) return
        val now = SystemClock.elapsedRealtime()
        MirrorIntakeState.apply { acceptGroupRide(GroupRideFrameCodec.encode(group.frame(atMs = now - startedAt, courseDeg = courseDeg)), now) }
        handler.postDelayed(::pushGroupRide, REPLAY_GROUP_RIDE_INTERVAL_MS)
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
    }

    private fun restartLoop() {
        index = 0
        loopStartedAt = SystemClock.elapsedRealtime()
        scheduleNext()
    }

    private fun scheduleNext() {
        if (!running) return
        val sample = samples[index]
        val dueAt = loopStartedAt + sample.atMs
        handler.postDelayed(
            {
                if (!running) return@postDelayed
                val now = SystemClock.elapsedRealtime()
                sample.frame.courseDeg?.let { courseDeg = it }
                MirrorIntakeState.acceptTelemetry(
                    WatchMirrorReplayAdapter.telemetry(sample.frame.copy(
                        remoteTilt = tilt,
                        tiltControl = if (tilt == TILT_CENTER) WatchTiltControl.FREE else WatchTiltControl.MANUAL,
                    )),
                    now, now,
                )
                index++
                if (index >= samples.size) restartLoop() else scheduleNext()
            },
            (dueAt - SystemClock.elapsedRealtime()).coerceAtLeast(0),
        )
    }

    /**
     * Route, street map and forecast, the surroundings every lane fixture rides through. The tiles
     * enter [MapTileState] as the phone's tile items do, read from assets instead of the Data Layer.
     * @parity /watch/watchos/FrameReplay.swift `FrameReplayer.start`
     * @parity /watch/watchos/PhoneLink.swift `acceptReplayWeather`
     * @parity /watch/watchos/PhoneLink.swift `acceptReplayRoute`
     */
    private fun loadScene(routeJson: String?, origin: WatchMapPosition?) {
        val route = routeJson?.let(ReplaySceneParser::parseRoute)
        MirrorIntakeState.apply { acceptRoute(origin?.let { WatchMirrorReplayAdapter.route(route, it) }) }
        readAsset(REPLAY_FIXTURE_MAP_TILES)?.let(ReplaySceneParser::parseMapTiles)?.forEach { tile ->
            MapTileState.put(tile) { context.assets.open("$REPLAY_MAP_TILE_DIR/${tile.key}.jpg").use { it.readBytes() } }
        }
        readAsset(REPLAY_FIXTURE_WEATHER)?.let {
            val weather = ReplaySceneParser.parseWeather(it, System.currentTimeMillis(), minuteOfDayNow())
            MirrorIntakeState.apply { acceptWeather(WatchMirrorReplayAdapter.weather(weather)) }
        }
    }

    private fun readAsset(fixture: String): String? = try {
        context.assets.open(fixture).bufferedReader().use { it.readText() }
    } catch (e: Exception) {
        WatchDiagnostics.recordReplayError(fixture, e)
        null
    }

    private fun load(fixture: String, wander: Boolean, origin: WatchMapPosition?): List<ReplaySample> = try {
        context.assets.open(fixture).bufferedReader().useLines { ReplayFixtureParser.parse(it, wander, origin) }
    } catch (e: Exception) {
        WatchDiagnostics.recordReplayError(fixture, e)
        emptyList()
    }
}
