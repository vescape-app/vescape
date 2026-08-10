package app.vescape.wear

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject

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

/** One recorded moment: the frame to show and the recording-relative time to show it at. */
data class ReplaySample(val atMs: Long, val frame: WatchFrame)

/**
 * Pure lane-fixture parser. A fixture is dev input that ships as an asset, so a malformed line is
 * skipped rather than crashing the Mirror — a partly-readable fixture still animates the gauges.
 */
object ReplayFixtureParser {
    fun parse(lines: Sequence<String>): List<ReplaySample> = lines.mapNotNull(::parseLine).toList()

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
                ),
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun JSONObject.nullableLane(key: String): Double? =
        if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
}

object ReplayGate {
    /**
     * Replay runs only where there is nothing real to mirror. Emulator detection reads [Build]
     * rather than `ro.kernel.qemu`, which is not readable from the SDK.
     */
    fun isEnabled(context: Context): Boolean = isDebuggable(context) && isEmulator()

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
class FrameReplayer(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private var samples: List<ReplaySample> = emptyList()
    private var index = 0
    private var loopStartedAt = 0L
    private var running = false

    fun start(fixture: String) {
        if (running) return
        samples = load(fixture)
        if (samples.isEmpty()) return
        WatchDiagnostics.recordReplay(fixture, samples.size)
        running = true
        restartLoop()
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
                WatchDiagnostics.recordFrame()
                TelemetryState.acceptFrame(sample.frame, now)
                index++
                if (index >= samples.size) restartLoop() else scheduleNext()
            },
            (dueAt - SystemClock.elapsedRealtime()).coerceAtLeast(0),
        )
    }

    private fun load(fixture: String): List<ReplaySample> = try {
        context.assets.open(fixture).bufferedReader().useLines(ReplayFixtureParser::parse)
    } catch (e: Exception) {
        WatchDiagnostics.recordReplayError(fixture, e)
        emptyList()
    }
}
