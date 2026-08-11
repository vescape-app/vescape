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

/**
 * Tick spacing while a Move button is held. The phone stops the board after
 * `WATCH_MOVE_DEADMAN_MS` (900 ms) without a tick, so this is a third of its dead-man: a release
 * lost to a Bluetooth drop costs the rider under a second of roll, not an unbounded one.
 */
const val MOVE_REPEAT_MS = 300L

/** `[kind, direction]`, direction `-1` back / `0` stop / `1` forward. */
fun encodeMoveCommand(direction: Int): ByteArray =
    byteArrayOf(COMMAND_KIND_MOVE, direction.coerceIn(-1, 1).toByte())

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

    private fun send(direction: Int) {
        try {
            val payload = encodeMoveCommand(direction)
            for (node in Tasks.await(nodeClient.connectedNodes)) {
                Tasks.await(messageClient.sendMessage(node.id, COMMAND_PATH, payload))
            }
        } catch (error: Exception) {
            Log.w("VescapeWear", "Move command send failed", error)
        }
    }

    fun shutdown() {
        sends.shutdown()
    }
}
