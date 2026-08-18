package app.vescape.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Wrist -> phone command channel (ADR-0033). The only thing the Mirror sends back: rider intent,
 * never state. Mirrors the phone-side peer by convention, same as the frame and settings paths.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt
 */
const val COMMAND_PATH = "/command"

private const val COMMAND_KIND_MOVE: Byte = 1
private const val COMMAND_KIND_MIRROR_AWAKE: Byte = 2

/**
 * How often the Mirror re-states its wake level while it is on screen. The phone stops pushing
 * after `WATCH_MIRROR_AWAKE_TIMEOUT_MS` (45 s) without a tick, so this is a third of its dead-man:
 * the phone stops streaming into a wrist that died, dropped out of range, or lost its stop message.
 */
const val WAKE_LEVEL_HEARTBEAT_MS = 15_000L

/**
 * How awake the Mirror is, and therefore how fast frames are worth receiving. Without this the
 * phone pushes at full cadence into a stopped activity for as long as its service lives, purely
 * because the Mirror is *installed* — the capability it gates on says nothing about running.
 *
 * Wire values — append, never renumber.
 */
enum class WakeLevel(val wire: Byte) {
    ASLEEP(0),
    ACTIVE(1),
    AMBIENT(2),
}

/**
 * Tick spacing while a Move button is held. The phone stops the board after
 * `WATCH_MOVE_DEADMAN_MS` (900 ms) without a tick, so this is a third of its dead-man: a release
 * lost to a Bluetooth drop costs the rider under a second of roll, not an unbounded one.
 */
const val MOVE_REPEAT_MS = 300L

/** `[kind, direction]`, direction `-1` back / `0` stop / `1` forward. */
fun encodeMoveCommand(direction: Int): ByteArray =
    byteArrayOf(COMMAND_KIND_MOVE, direction.coerceIn(-1, 1).toByte())

/** `[kind, level]`, level per [WakeLevel.wire]. */
fun encodeWakeLevelCommand(level: WakeLevel): ByteArray =
    byteArrayOf(COMMAND_KIND_MIRROR_AWAKE, level.wire)

/**
 * Fire-and-forget send of the rider's *current* intent to every connected node, off the UI thread.
 *
 * Latest-wins, not a queue. Each send blocks on the Data Layer, so on a degraded link ticks would
 * pile up behind one another — and a backlog is dangerous here, not merely wasteful: the release
 * would sit behind the holds that preceded it, and a link that recovers would replay stale holds,
 * re-arming the phone's dead-man and rolling a board the rider let go of. Only the newest direction
 * is ever in flight; a release therefore overtakes every hold that has not left the wrist yet.
 *
 * A single thread keeps the sends ordered against each other. Failures are logged, not surfaced —
 * the next tick is already coming, and Moves that stop arriving stop the board by design.
 */
class CommandSender(context: Context) {
    private val appContext = context.applicationContext
    private val sends = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "vescape-wear-commands") }
    private val messageClient by lazy { Wearable.getMessageClient(appContext) }
    private val nodeClient by lazy { Wearable.getNodeClient(appContext) }

    /** The direction still to be sent, and whether a worker is already on its way to read it. */
    private val pending = AtomicInteger(0)
    private val scheduled = AtomicBoolean(false)

    fun sendMove(direction: Int) {
        pending.set(direction.coerceIn(-1, 1))
        // A worker that has not yet read `pending` will pick this value up, so it needs no task.
        if (!scheduled.compareAndSet(false, true)) return
        try {
            sends.execute {
                scheduled.set(false)
                send(pending.get())
            }
        } catch (rejected: RejectedExecutionException) {
            // The wrist app is going away; the phone's dead-man is what stops the board now.
            scheduled.set(false)
            Log.w("VescapeWear", "Move command dropped after shutdown", rejected)
        }
    }

    private fun send(direction: Int) = sendPayload(encodeMoveCommand(direction))

    private fun sendPayload(payload: ByteArray) {
        try {
            for (node in Tasks.await(nodeClient.connectedNodes)) {
                Tasks.await(messageClient.sendMessage(node.id, COMMAND_PATH, payload))
            }
        } catch (error: Exception) {
            Log.w("VescapeWear", "Wrist command send failed", error)
        }
    }

    /**
     * Tell the phone how awake the Mirror is. Not routed through the latest-wins [pending] slot:
     * a wake level is not a Move, and coalescing the two would let a stale hold ride out under a
     * wake tick. Ordered behind whatever is already queued, which is all this needs.
     */
    fun sendWakeLevel(level: WakeLevel) {
        try {
            sends.execute { sendPayload(encodeWakeLevelCommand(level)) }
        } catch (rejected: RejectedExecutionException) {
            // The wrist app is going away; the phone's wake-level dead-man stops the push anyway.
            Log.w("VescapeWear", "Wake level dropped after shutdown", rejected)
        }
    }

    fun shutdown() {
        sends.shutdown()
    }
}
