package app.vescape.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt
 * @parity /modules/vescape-core/ios/watch/WatchCommand.swift
 */
const val COMMAND_PATH = "/command"

private const val COMMAND_KIND_MOVE: Byte = 1
private const val COMMAND_KIND_MIRROR_AWAKE: Byte = 2
private const val COMMAND_KIND_LIGHTS: Byte = 3
private const val COMMAND_KIND_TILT_LOCK: Byte = 4
private const val COMMAND_KIND_TILT_CANCEL: Byte = 5
private const val COMMAND_KIND_DISMISS_NOTICE: Byte = 6

const val WAKE_LEVEL_HEARTBEAT_MS = 15_000L

enum class WakeLevel(val wire: Byte) {
    ASLEEP(0),
    ACTIVE(1),
    AMBIENT(2),
}

const val MOVE_REPEAT_MS = 300L

fun encodeMoveCommand(direction: Int): ByteArray =
    byteArrayOf(COMMAND_KIND_MOVE, direction.coerceIn(-1, 1).toByte())

fun encodeWakeLevelCommand(level: WakeLevel): ByteArray =
    byteArrayOf(COMMAND_KIND_MIRROR_AWAKE, level.wire)

enum class LightSwitch(val selector: Int) {
    LEDS(0),
    HEADLIGHT(1),
}

fun encodeLightsCommand(switch: LightSwitch, on: Boolean): ByteArray =
    byteArrayOf(COMMAND_KIND_LIGHTS, ((switch.selector shl 1) or if (on) 1 else 0).toByte())

fun encodeTiltLockCommand(value: Int): ByteArray =
    byteArrayOf(COMMAND_KIND_TILT_LOCK, value.coerceIn(0, 255).toByte())

fun encodeTiltCancelCommand(): ByteArray = byteArrayOf(COMMAND_KIND_TILT_CANCEL, 0)

fun encodeDismissNoticeCommand(id: Int, rev: Int): ByteArray =
    byteArrayOf(COMMAND_KIND_DISMISS_NOTICE, id.coerceIn(0, 255).toByte(), rev.coerceIn(0, 255).toByte())

/**
 * @parity /watch/watchos/PhoneLink.swift `sendMove`
 * @platform-diff `WCSession.sendMessageData` is already non-blocking and latest-wins, so the
 *   watchOS wrist needs no coalescing slot to keep a release from queueing behind stale holds.
 */
class CommandSender(context: Context) {
    private val appContext = context.applicationContext
    private val sends = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "vescape-wear-commands") }
    private val messageClient by lazy { Wearable.getMessageClient(appContext) }
    private val nodeClient by lazy { Wearable.getNodeClient(appContext) }

    private val pending = AtomicInteger(0)
    private val scheduled = AtomicBoolean(false)

    private val pendingTilt = AtomicReference<ByteArray?>(null)

    fun sendMove(direction: Int) {
        pending.set(direction.coerceIn(-1, 1))
        if (!scheduled.compareAndSet(false, true)) return
        try {
            sends.execute {
                scheduled.set(false)
                send(pending.get())
            }
        } catch (rejected: RejectedExecutionException) {
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

    fun sendWakeLevel(level: WakeLevel) {
        try {
            sends.execute { sendPayload(encodeWakeLevelCommand(level)) }
        } catch (rejected: RejectedExecutionException) {
            Log.w("VescapeWear", "Wake level dropped after shutdown", rejected)
        }
    }

    fun sendLights(switch: LightSwitch, on: Boolean) {
        try {
            sends.execute { sendPayload(encodeLightsCommand(switch, on)) }
        } catch (rejected: RejectedExecutionException) {
            Log.w("VescapeWear", "Lights command dropped after shutdown", rejected)
        }
    }

    /**
     * @parity /watch/watchos/PhoneLink.swift `hideRideNotice`
     */
    fun sendDismissNotice(id: Int, rev: Int) {
        try {
            sends.execute { sendPayload(encodeDismissNoticeCommand(id, rev)) }
        } catch (rejected: RejectedExecutionException) {
            Log.w("VescapeWear", "Notice dismiss dropped after shutdown", rejected)
        }
    }

    fun sendTiltLock(value: Int) {
        replayTiltEcho?.let { echo -> return echo(value.coerceIn(0, 255)) }
        sendTilt(encodeTiltLockCommand(value))
    }

    fun sendTiltCancel() {
        replayTiltEcho?.let { echo -> return echo(null) }
        sendTilt(encodeTiltCancelCommand())
    }

    var replayTiltEcho: ((Int?) -> Unit)? = null

    private fun sendTilt(payload: ByteArray) {
        if (pendingTilt.getAndSet(payload) != null) return
        try {
            sends.execute { pendingTilt.getAndSet(null)?.let(::sendPayload) }
        } catch (rejected: RejectedExecutionException) {
            pendingTilt.set(null)
            Log.w("VescapeWear", "Tilt command dropped after shutdown", rejected)
        }
    }

    fun shutdown() {
        sends.shutdown()
    }
}
