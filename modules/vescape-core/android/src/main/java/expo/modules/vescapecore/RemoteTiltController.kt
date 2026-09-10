package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import expo.modules.vescapecore.protocol.buildRemoteTiltCommand

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Remote input lapses in firmware after ~1s of silence, so the held tilt only has to be refreshed
 * inside that window. It used to tick at 40ms, which left Remote Tilt claiming a write slot in every
 * alternating pair and starved telemetry polling while the pad was held. 100ms keeps a 10x margin on
 * the firmware timeout, matches Board Move's remote cadence, and leaves the link to telemetry.
 *
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift `REMOTE_TILT_REPEAT_MS`
 */
private const val REMOTE_TILT_REPEAT_MS = 100L

/**
 * Time a full-range cancel takes to ease back to neutral; smaller tilts take proportionally less.
 *
 * Dropping a large tilt straight to neutral is not safe on a self-balancing board: the firmware
 * reads the step as a big angle error and surges to correct it, which throws the rider forward.
 * Cancel therefore eases at a bounded rate instead of snapping.
 *
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift `REMOTE_TILT_CANCEL_FULL_RANGE_MS`
 */
private const val REMOTE_TILT_CANCEL_FULL_RANGE_MS = 600L

// @parity /modules/vescape-core/src/index.ts `RemoteTiltPhase`
// @parity /modules/vescape-core/ios/RemoteTiltController.swift `RemoteTiltPhase`
internal enum class RemoteTiltPhase(val wireValue: String) {
    Idle("idle"),
    Holding("holding"),
    Decaying("decaying"),
    Locked("locked"),
}

internal data class RemoteTiltDecayProgress(
    val elapsedMs: Long,
    val totalMs: Long,
)

/**
 * Streams Floaty's temporary remote-tilt input (0..255 slider, 128 neutral) to
 * the board. Refloat drops the remote input after ~1s of silence, so the active
 * tilt is repeated on a fixed [REMOTE_TILT_REPEAT_MS] tick. Requires
 * `inputtilt_remote_type` to be set to UART in the board config.
 *
 * Two streams drive the 2D pad:
 *  - [hold] keeps a constant tilt while the finger is down (live drag).
 *  - [release] eases that tilt linearly back to neutral over a chosen duration
 *    once the finger lifts.
 *
 * The repeat loop is the sole sender: rapid drag updates only swap the active
 * stream and never schedule extra writes, so the serialized GATT queue is not
 * flooded with stale packets (which lagged the board the longer it was dragged).
 *
 * Decay is tick-based rather than wall-clock: ticks fire at a fixed interval, so
 * counting them is equivalent to timing for a linear ramp and stays trivially
 * testable.
 *
 * @param transport supplies the active transport only while a tilt stream is
 *   allowed (board connected with a loaded config); `null` otherwise.
 * @param send writes a framed payload to the board. `urgent` means neutral cancel
 *   input, which must pass normal traffic at the next write boundary.
 *
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift
 */
internal class RemoteTiltController(
    private val scheduler: Scheduler,
    private val transport: () -> BoardTransport?,
    private val send: (payload: ByteArray, urgent: Boolean) -> Boolean,
) {
    /** The tilt currently being streamed, as a function of elapsed ticks. */
    private sealed interface Stream {
        /** Tilt value to emit [tick] repeats into the stream. */
        fun valueAt(tick: Int): Int

        /** Whether the stream has reached neutral and should stop after [tick]. */
        fun finished(tick: Int): Boolean

        /** Constant tilt held while the finger is down. */
        data class Hold(val value: Int) : Stream {
            override fun valueAt(tick: Int) = value

            override fun finished(tick: Int) = false
        }

        /** Linear ease from [from] to neutral over [steps] ticks. */
        data class Decay(val from: Int, val steps: Int) : Stream {
            override fun valueAt(tick: Int): Int {
                if (tick >= steps) return REMOTE_TILT_CENTER
                val progress = tick.toDouble() / steps
                return (from + (REMOTE_TILT_CENTER - from) * progress).roundToInt()
            }

            override fun finished(tick: Int) = tick >= steps
        }
    }

    private var stream: Stream? = null
    private var tick = 0
    private var repeat: Cancellable? = null
    private var locked = false

    /**
     * The tilt currently being commanded (0..255), or [REMOTE_TILT_CENTER] when
     * idle. Reflects the held/easing target the controller is streaming, not the
     * board's own ramped angle.
     */
    val currentValue: Int
        get() = stream?.valueAt(tick) ?: REMOTE_TILT_CENTER

    /** Whether the active hold is a lock (held until cancelled), not a live drag. */
    val isLocked: Boolean
        get() = locked

    val phase: RemoteTiltPhase
        get() = when {
            stream == null -> RemoteTiltPhase.Idle
            locked -> RemoteTiltPhase.Locked
            stream is Stream.Decay -> RemoteTiltPhase.Decaying
            else -> RemoteTiltPhase.Holding
        }

    /** Exact native decay timing, used to render the pad's diagonal return path. */
    val decayProgress: RemoteTiltDecayProgress?
        get() {
            val decay = stream as? Stream.Decay ?: return null
            return RemoteTiltDecayProgress(
                elapsedMs = tick.toLong() * REMOTE_TILT_REPEAT_MS,
                totalMs = decay.steps.toLong() * REMOTE_TILT_REPEAT_MS,
            )
        }

    /** Hold a constant tilt (live pad drag). Streams until [release] or [stop]. */
    fun hold(value: Int): Boolean {
        val started = start(Stream.Hold(value.coerceIn(0, 255)))
        if (started) locked = false
        return started
    }

    /** Lock a constant tilt, held indefinitely until [stop] or a new [hold]/[release]. */
    fun lock(value: Int): Boolean {
        val started = start(Stream.Hold(value.coerceIn(0, 255)))
        locked = started
        return started
    }

    /**
     * Release the pad into a linear ease from [value] back to neutral over
     * [durationMs]. A duration shorter than one tick snaps straight to neutral.
     */
    fun release(value: Int, durationMs: Long): Boolean {
        val steps = (durationMs / REMOTE_TILT_REPEAT_MS).toInt()
        if (steps <= 0) return stop()
        val started = start(Stream.Decay(value.coerceIn(0, 255), steps))
        if (started) locked = false
        return started
    }

    /**
     * Cancel the active tilt the way a rider expects: ease whatever is currently commanded back to
     * neutral at a bounded rate ([REMOTE_TILT_CANCEL_FULL_RANGE_MS] for a full-range tilt) rather
     * than snapping. Use [stop] only for teardown, where an immediate neutral is the point.
     */
    fun cancel(): Boolean {
        val value = currentValue
        val distance = abs(value - REMOTE_TILT_CENTER)
        if (distance == 0) return stop()
        val durationMs =
            distance * REMOTE_TILT_CANCEL_FULL_RANGE_MS / (255 - REMOTE_TILT_CENTER)
        return release(value, durationMs)
    }

    /** Immediate neutral, no ease. Teardown only — see [cancel] for the rider-facing cancel. */
    fun stop(): Boolean {
        val wasActive = stream != null
        clear()

        // Snap to neutral so the board releases tilt immediately instead of
        // waiting for its ~1s remote-input timeout.
        transport()?.let { send(buildRemoteTiltCommand(it, REMOTE_TILT_CENTER), true) }
        return wasActive
    }

    private fun start(next: Stream): Boolean {
        val transport = transport() ?: return false

        // A running loop just picks up the new stream on its next tick; swapping
        // mid-drag must not flood the queue with an extra immediate write.
        val alreadyStreaming = repeat != null
        stream = next
        tick = 0
        if (alreadyStreaming) return true

        val sent = send(buildRemoteTiltCommand(transport, next.valueAt(0)), false)
        scheduleRepeat()
        return sent
    }

    private fun scheduleRepeat() {
        repeat = scheduler.postDelayed(REMOTE_TILT_REPEAT_MS) {
            val stream = stream
            val transport = transport()
            if (stream == null || transport == null) {
                clear()
                return@postDelayed
            }
            tick += 1
            send(buildRemoteTiltCommand(transport, stream.valueAt(tick)), false)
            if (stream.finished(tick)) {
                clear()
                return@postDelayed
            }
            scheduleRepeat()
        }
    }

    private fun clear() {
        stream = null
        tick = 0
        locked = false
        repeat?.cancel()
        repeat = null
    }
}
