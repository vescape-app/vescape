package expo.modules.vescapecore.replay

import expo.modules.vescapecore.protocol.SessionTransport
import expo.modules.vescapecore.protocol.VescGattListener
import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.content.Context
import android.os.Handler
import android.util.Log

/** Wall-clock tail after the last recorded chunk before the replay disconnects the session. */
private const val REPLAY_END_TAIL_MS = 250L

/** One scheduled playback event — board chunk or GPS fix — by recorded time. */
private sealed class ReplayEvent(val t: Long) {
    class Chunk(val chunk: ReplayChunk) : ReplayEvent(chunk.t)
    class Fix(val fix: ReplayLocation) : ReplayEvent(fix.t)
}

/**
 * Dev-mode [SessionTransport] that plays a Debug Recording through the real session stack
 * (ADR 0024): fakes the connect/subscribing/ready callbacks, emits recorded `rx` chunks *and*
 * recorded GPS fixes at their recorded `t` offsets on one merged timeline, swallows writes, and
 * ends the session like a real disconnect when the recording runs out.
 * Pacing comes from [clock]: a plain replay runs the whole recording at 1× real time, and a replay
 * given a warmup window runs that much of it faster so the session comes up with its live window
 * already filled instead of spending real minutes waiting for one.
 * Replaying a ride means reproducing where it happened, so the recording owns position for the
 * whole session; a recording without `location` lines replays like ordinary use without a GPS fix.
 * The replay session runs with `recordingEnabled = false` so playback never records a new Debug
 * Recording of itself.
 *
 * @parity /modules/vescape-core/ios/replay/ReplayTransport.swift
 */
internal class ReplayTransport(
    private val context: Context,
    private val handler: Handler,
    private val recordingName: String,
    private val listener: VescGattListener,
    private val dispatchListener: ((() -> Unit) -> Unit),
    private val onLocation: (ReplayLocation) -> Unit,
    /** The session clock this playback drives; installed by the controller for the session. */
    val clock: ReplayClock,
) : SessionTransport {
    @Volatile
    private var cancelled = false
    private var pending: Runnable? = null

    override fun connect(deviceId: String) {
        Log.d(VESC_SESSION_TAG, "replay connect recording=$recordingName")
        // Decode off-main (a ride recording can be megabytes); playback runs on the handler.
        Thread({
            val events = try {
                val jsonl = ReplayRecordings.read(context, recordingName)
                val chunks = ReplayChunkDecoder.rxChunks(jsonl).map { ReplayEvent.Chunk(it) }
                val fixes = ReplayChunkDecoder.locations(jsonl).map { ReplayEvent.Fix(it) }
                (chunks + fixes).sortedBy(ReplayEvent::t)
            } catch (e: Exception) {
                Log.w(VESC_SESSION_TAG, "replay load failed: ${e.message}")
                // A stop during background load must not surface as a session failure.
                if (!cancelled) dispatchListener { listener.onGattFailure("REPLAY_LOAD_FAILED", e.message ?: "Recording unreadable") }
                return@Thread
            }
            handler.post { startPlayback(events) }
        }, "vesc-replay-load").start()
    }

    private fun startPlayback(events: List<ReplayEvent>) {
        if (cancelled) return
        dispatchListener { listener.onGattConnected() }
        dispatchListener { listener.onGattSubscribing() }
        dispatchListener { listener.onGattReady() }
        clock.startPlayback(System.currentTimeMillis())
        scheduleNext(events, 0)
    }

    /**
     * Cursor-based pacing: only the next chunk is ever scheduled, so an hour-long recording never
     * floods the handler with queued callbacks. Recorded `t` is relative to recording start, and
     * [ReplayClock.delayUntilRecorded] turns it into a wall delay — preserving the original absolute
     * pacing (including the recorded connect handshake gap), divided by the speed session time is
     * currently running at.
     */
    private fun scheduleNext(events: List<ReplayEvent>, index: Int) {
        if (cancelled) return
        if (index >= events.size) {
            postAt((events.lastOrNull()?.t ?: 0L) + REPLAY_END_TAIL_MS) {
                Log.d(VESC_SESSION_TAG, "replay finished recording=$recordingName events=${events.size}")
                dispatchListener { listener.onGattDisconnected(status = 0, intentional = false) }
            }
            return
        }
        val event = events[index]
        postAt(event.t) {
            when (event) {
                is ReplayEvent.Chunk -> dispatchListener { listener.onGattFrameChunk(event.chunk.bytes) }
                is ReplayEvent.Fix -> onLocation(event.fix)
            }
            scheduleNext(events, index + 1)
        }
    }

    private fun postAt(recordedT: Long, block: () -> Unit) {
        val runnable = Runnable { if (!cancelled) { pending = null; block() } }
        pending = runnable
        handler.postDelayed(runnable, clock.delayUntilRecorded(recordedT))
    }

    /** Replay swallows all writes; request/response FSMs get replies on the recording's schedule. */
    override fun sendPayload(payload: ByteArray): Boolean = !cancelled

    override fun sendRemoteInput(payload: ByteArray, urgent: Boolean): Boolean = !cancelled

    override fun clear(markIntentional: Boolean) {
        cancelled = true
        pending?.let(handler::removeCallbacks)
        pending = null
    }
}
