package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.TestScheduler
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchMirrorCoordinatorTests.swift */
class WatchMirrorCoordinatorTest {
    private class Transport : WatchMirrorTransport {
        override var reachable = true
        override var requiresWakeReport = true
        var starts = 0
        var stops = 0
        var frames = 0
        var lastFrame = byteArrayOf()
        var onFrame: () -> Unit = {}
        var onGroup: () -> Unit = {}
        var groups = 0
        var statuses = 0
        var settings = 0
        var launches = 0
        override fun start() { starts++ }
        override fun stop() { stops++ }
        override fun pushFrame(frame: ByteArray) { frames++; lastFrame = frame; onFrame() }
        override fun pushGroup(frame: ByteArray) { groups++; onGroup() }
        override fun pushRouteStatus(status: WatchRouteStatus) { statuses++ }
        override fun pushSettings(settings: WatchSettings) { this.settings++ }
        override fun pushWeather(weather: WatchWeather) {}
        override fun pushBoard(board: WatchBoard) {}
        override fun launch() { launches++ }
    }
    private class Sources : WatchMirrorSources {
        var subscribed = 0
        var cancelled = 0
        var changed: () -> Unit = {}
        var phase = WatchRoutePhase.READY
        override fun routeStatus() = WatchRouteStatus(phase, 1)
        override fun mapRoute(): WatchMapRouteProgress? = null
        override fun subscribe(routeChanged: () -> Unit, weatherChanged: (WatchWeather) -> Unit): () -> Unit {
            subscribed++
            changed = routeChanged
            return { cancelled++ }
        }
    }
    private class Harness {
        val scheduler = TestScheduler()
        val transport = Transport()
        val sources = Sources()
        var board = true
        var navigatingChanges = 0
        var mapPosition: WatchMapPosition? = WatchMapPosition(51.1, 17.0)
        val mapTiles = mutableListOf<WatchMapRider?>()
        val coordinator = WatchMirrorCoordinator(
            scheduler, { scheduler.currentTimeMs },
            { WatchSnapshot(speed = if (board) 25.0 else null, dutyCycle = null, dutyExcluded = true, batterySoc = null, motorTemp = null, ctrlTemp = null, navBearing = 90.0, navDistanceM = 100.0, mapPosition = mapPosition, riderSpeedMps = 5.0, routeSpanM = 800.0) },
            { false }, { GroupRideFrame(0.0, 600.0, emptyList()) }, transport, sources, { _, _ -> },
            { navigatingChanges++ }, { mapTiles += it },
        )
        fun active() { coordinator.start(); coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE) }
    }

    @Test fun `lifetime is idempotent and survives board disconnect`() {
        val h = Harness()
        h.active()
        h.coordinator.start()
        h.scheduler.advance(1000)
        h.board = false
        h.scheduler.advance(1000)
        assertEquals(1, h.transport.starts)
        assertEquals(1, h.sources.subscribed)
        assertEquals(8, h.transport.frames)
        assertEquals(2, h.transport.groups)
        assertEquals(8, h.transport.statuses)
        val lanes = ByteBuffer.wrap(h.transport.lastFrame).order(ByteOrder.LITTLE_ENDIAN)
        assertTrue(lanes.getFloat(2).isNaN()) // Board lane clears while route distance remains live.
        assertEquals(100f, lanes.getFloat(2 + 6 * 4), 0f)
        assertEquals(0, h.transport.lastFrame[1].toInt())
        h.coordinator.stop()
        h.coordinator.stop()
        h.scheduler.advance(5000)
        assertEquals(8, h.transport.frames)
        assertEquals(1, h.transport.stops)
        assertEquals(1, h.sources.cancelled)
        assertEquals(0, h.scheduler.pendingCount)
    }

    @Test fun `asleep and unreachable suppress streams but legacy wrists still get frames`() {
        val h = Harness()
        h.coordinator.start()
        h.scheduler.advance(1000)
        assertEquals(0, h.transport.frames)
        h.transport.requiresWakeReport = false
        h.scheduler.advance(1000)
        assertEquals(4, h.transport.frames)
        assertEquals(0, h.transport.groups)
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE)
        h.transport.reachable = false
        h.scheduler.advance(1000)
        assertEquals(4, h.transport.frames)
        assertEquals(0, h.transport.groups)
    }

    @Test fun `ambient settings reload keeps slow cadence and active restores latest rate`() {
        val h = Harness()
        h.active()
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.AMBIENT)
        h.coordinator.applySettings(WatchSettings(null, 10, false), 100, true)
        h.scheduler.advance(4999)
        assertEquals(0, h.transport.frames)
        h.scheduler.advance(1)
        assertEquals(1, h.transport.frames)
        assertEquals(0, h.transport.groups)
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE)
        h.scheduler.advance(100)
        assertEquals(2, h.transport.frames)
        assertEquals(1, h.transport.settings)
    }

    @Test fun `expired wake heartbeat stops both streams and same level resumes`() {
        val h = Harness()
        h.active()
        h.scheduler.advance(WATCH_MIRROR_AWAKE_TIMEOUT_MS)
        val frames = h.transport.frames
        val groups = h.transport.groups
        h.scheduler.advance(2000)
        assertEquals(frames, h.transport.frames)
        assertEquals(groups, h.transport.groups)
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE)
        h.scheduler.advance(1000)
        assertEquals(frames + 4, h.transport.frames)
        assertEquals(groups + 1, h.transport.groups)
    }

    @Test fun `queued old source callbacks cannot affect a restarted mirror`() {
        val h = Harness()
        h.active()
        val oldCallback = h.sources.changed
        oldCallback()
        h.coordinator.stop()
        h.active()
        oldCallback()
        h.scheduler.advance(0)
        assertEquals(0, h.transport.statuses)
        h.sources.changed()
        h.scheduler.advance(0)
        assertEquals(1, h.transport.statuses)
    }

    @Test fun `stop from a delivery callback cannot rearm either stream`() {
        for (stopFromGroup in listOf(false, true)) {
            val h = Harness()
            if (stopFromGroup) h.transport.onGroup = { h.coordinator.stop() }
            else h.transport.onFrame = { h.coordinator.stop() }
            h.active()
            h.scheduler.advance(1000)
            val frames = h.transport.frames
            val groups = h.transport.groups
            h.scheduler.advance(5000)
            assertEquals(frames, h.transport.frames)
            assertEquals(groups, h.transport.groups)
            assertEquals(0, h.scheduler.pendingCount)
        }
    }

    @Test fun `board auto launch honors preference presence and session identity`() {
        val h = Harness()
        h.active()
        h.coordinator.boardConnected(1)
        h.coordinator.boardConnected(1)
        h.coordinator.applySettings(WatchSettings(null, 10, false), 250, false)
        h.coordinator.boardConnected(2)
        h.coordinator.applySettings(WatchSettings(null, 10, false), 250, true)
        h.transport.reachable = false
        h.coordinator.boardConnected(2)
        h.transport.reachable = true
        h.coordinator.boardConnected(2)
        assertEquals(2, h.transport.launches)
    }

    /** Issue #550: the wrist route needs live fixes, so its demand must follow route and wrist edges. */
    @Test fun `navigating follows a drawable route on a receiving wrist`() {
        val h = Harness()
        h.coordinator.start()
        h.scheduler.advance(1000)
        assertFalse(h.coordinator.navigating) // Asleep wrist: nothing to keep GPS on for.
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE)
        h.scheduler.advance(250)
        assertTrue(h.coordinator.navigating)
        h.sources.phase = WatchRoutePhase.COMPUTING
        h.scheduler.advance(250)
        assertFalse(h.coordinator.navigating)
        h.sources.phase = WatchRoutePhase.READY
        h.scheduler.advance(250)
        assertTrue(h.coordinator.navigating)
        h.transport.reachable = false
        h.scheduler.advance(250)
        assertFalse(h.coordinator.navigating)
        h.scheduler.advance(1000)
        assertEquals(4, h.navigatingChanges)
    }

    /** Issue #551: tiles only reach an awake wrist that draws a map, around a GPS fix. */
    @Test fun `street map tiles follow an active wrist only`() {
        val h = Harness()
        h.coordinator.start()
        h.scheduler.advance(1000)
        assertTrue(h.mapTiles.isNotEmpty() && h.mapTiles.all { it == null }) // Asleep.
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE)
        h.mapTiles.clear()
        h.scheduler.advance(250)
        assertEquals(WatchMapRider(WatchMapPosition(51.1, 17.0), null, 5.0, 800.0), h.mapTiles.single())
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.AMBIENT)
        h.mapTiles.clear()
        h.scheduler.advance(WATCH_FRAME_AMBIENT_INTERVAL_MS)
        assertEquals(listOf<WatchMapRider?>(null), h.mapTiles)
        h.coordinator.acceptWakeLevel(WatchMirrorWakeLevel.ACTIVE)
        h.mapPosition = null
        h.mapTiles.clear()
        h.scheduler.advance(250)
        assertEquals(listOf<WatchMapRider?>(null), h.mapTiles) // No fix to plan around.
        h.mapTiles.clear()
        h.coordinator.stop()
        assertEquals(listOf<WatchMapRider?>(null), h.mapTiles)
    }

    /** Issue #554: the Street map setting pauses tiles to an active wrist and resumes them. */
    @Test fun `street map setting off pauses tiles and on resumes them`() {
        val h = Harness()
        h.active()
        h.coordinator.applySettings(WatchSettings(null, 10, false, streetMapEnabled = false), 250, true)
        h.mapTiles.clear()
        h.scheduler.advance(1000)
        assertTrue(h.mapTiles.isNotEmpty() && h.mapTiles.all { it == null })
        assertTrue(h.transport.frames > 0) // Only the map pauses; frames keep flowing.
        h.coordinator.applySettings(WatchSettings(null, 10, false, streetMapEnabled = true), 250, true)
        h.mapTiles.clear()
        h.scheduler.advance(250)
        assertEquals(WatchMapRider(WatchMapPosition(51.1, 17.0), null, 5.0, 800.0), h.mapTiles.single())
    }
}
