package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import expo.modules.vescapecore.protocol.buildRemoteTiltCommand

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift `REMOTE_TILT_REPEAT_MS`
 */
private const val REMOTE_TILT_REPEAT_MS = 100L

/**
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift `REMOTE_TILT_CANCEL_FULL_RANGE_MS`
 */
internal const val REMOTE_TILT_CANCEL_FULL_RANGE_MS = 600L

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
 * @parity /modules/vescape-core/ios/RemoteTiltController.swift
 */
internal class RemoteTiltController(
    private val scheduler: Scheduler,
    private val transport: () -> BoardTransport?,
    private val send: (payload: ByteArray, urgent: Boolean) -> Boolean,
) {
    private sealed interface Stream {
        fun valueAt(tick: Int): Int

        fun finished(tick: Int): Boolean

        data class Hold(val value: Int) : Stream {
            override fun valueAt(tick: Int) = value

            override fun finished(tick: Int) = false
        }

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

    val currentValue: Int
        get() = stream?.valueAt(tick) ?: REMOTE_TILT_CENTER

    val isLocked: Boolean
        get() = locked

    val phase: RemoteTiltPhase
        get() = when {
            stream == null -> RemoteTiltPhase.Idle
            locked -> RemoteTiltPhase.Locked
            stream is Stream.Decay -> RemoteTiltPhase.Decaying
            else -> RemoteTiltPhase.Holding
        }

    val decayProgress: RemoteTiltDecayProgress?
        get() {
            val decay = stream as? Stream.Decay ?: return null
            return RemoteTiltDecayProgress(
                elapsedMs = tick.toLong() * REMOTE_TILT_REPEAT_MS,
                totalMs = decay.steps.toLong() * REMOTE_TILT_REPEAT_MS,
            )
        }

    fun hold(value: Int): Boolean {
        val started = start(Stream.Hold(value.coerceIn(0, 255)))
        if (started) locked = false
        return started
    }

    fun lock(value: Int): Boolean {
        val started = start(Stream.Hold(value.coerceIn(0, 255)))
        locked = started
        return started
    }

    fun release(value: Int, durationMs: Long): Boolean {
        val steps = (durationMs / REMOTE_TILT_REPEAT_MS).toInt()
        if (steps <= 0) return stop()
        val started = start(Stream.Decay(value.coerceIn(0, 255), steps))
        if (started) locked = false
        return started
    }

    fun cancel(): Boolean {
        val value = currentValue
        val distance = abs(value - REMOTE_TILT_CENTER)
        if (distance == 0) return stop()
        val durationMs =
            distance * REMOTE_TILT_CANCEL_FULL_RANGE_MS / (255 - REMOTE_TILT_CENTER)
        return release(value, durationMs)
    }

    fun stop(): Boolean {
        val wasActive = stream != null
        clear()

        transport()?.let { send(buildRemoteTiltCommand(it, REMOTE_TILT_CENTER), true) }
        return wasActive
    }

    private fun start(next: Stream): Boolean {
        val transport = transport() ?: return false

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
