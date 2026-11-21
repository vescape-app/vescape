package expo.modules.vescapecore

import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift `RemoteInputOwner`
 * @parity /modules/vescape-core/src/index.ts `RemoteTiltOwner`
 */
internal enum class RemoteInputOwner(val wire: String) {
    NONE("none"),

    MANUAL("manual"),

    SENSOR("sensor"),

    MOVE("move"),
}

/**
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift `SENSOR_TILT_SLEW_FULL_RANGE_MS`
 */
private const val SENSOR_TILT_SLEW_FULL_RANGE_MS = REMOTE_TILT_CANCEL_FULL_RANGE_MS

/**
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift
 */
internal class RemoteInputArbiter(
    private val tilt: RemoteTiltController,
    private val move: BoardMoveController,
    private val nowMs: () -> Long,
    private val sensorBound: () -> Boolean = { false },
) {
    private var tiltOwner = RemoteInputOwner.NONE

    private var sensorEngaged = false

    private var sensorValue = REMOTE_TILT_CENTER
    private var sensorAtMs = 0L

    val owner: RemoteInputOwner
        get() = when {
            move.isMoving -> RemoteInputOwner.MOVE
            tilt.phase == RemoteTiltPhase.Idle -> RemoteInputOwner.NONE
            else -> tiltOwner
        }

    val sensorCommand: Int
        get() = if (sensorEngaged) sensorValue else REMOTE_TILT_CENTER

    fun manualHold(value: Int): Boolean = claimManual { tilt.hold(value) }

    fun manualLock(value: Int): Boolean = claimManual { tilt.lock(value) }

    fun manualRelease(value: Int, durationMs: Long): Boolean =
        claimManual { tilt.release(value, durationMs) }

    /**
     * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift `manualBlocker`
     */
    val manualBlocker: RemoteInputOwner?
        get() = when {
            sensorBound() -> RemoteInputOwner.SENSOR
            owner == RemoteInputOwner.SENSOR || owner == RemoteInputOwner.MOVE -> owner
            else -> null
        }

    private inline fun claimManual(start: () -> Boolean): Boolean {
        if (manualBlocker != null) return false
        val started = start()
        if (started) tiltOwner = RemoteInputOwner.MANUAL
        return started
    }

    fun cancelTilt(): Boolean {
        releaseSensor()
        return tilt.cancel()
    }

    fun releaseManual(): Boolean {
        if (owner != RemoteInputOwner.MANUAL) return false
        if (tilt.phase == RemoteTiltPhase.Decaying) return false
        return tilt.cancel()
    }

    fun sensorDrive(target: Int): Boolean {
        when (owner) {
            RemoteInputOwner.MOVE, RemoteInputOwner.MANUAL -> {
                sensorEngaged = false
                return false
            }

            RemoteInputOwner.NONE, RemoteInputOwner.SENSOR -> Unit
        }
        val now = nowMs()
        val from = when {
            sensorEngaged -> sensorValue
            tilt.phase != RemoteTiltPhase.Idle -> tilt.currentValue
            else -> REMOTE_TILT_CENTER
        }
        val elapsed = if (sensorEngaged) max(0L, now - sensorAtMs) else 0L
        val next = slew(from, target.coerceIn(0, 255), elapsed)
        sensorEngaged = true
        sensorValue = next
        sensorAtMs = now
        tiltOwner = RemoteInputOwner.SENSOR
        return tilt.hold(next)
    }

    fun sensorRelease(): Boolean {
        if (!releaseSensor()) return false
        if (owner != RemoteInputOwner.SENSOR) return false
        return tilt.cancel()
    }

    private fun releaseSensor(): Boolean {
        if (!sensorEngaged) return false
        sensorEngaged = false
        sensorValue = REMOTE_TILT_CENTER
        return true
    }

    fun startMove(input: Int): Boolean {
        if (sensorEngaged) return false
        if (tilt.phase != RemoteTiltPhase.Idle) tilt.stop()
        releaseSensor()
        tiltOwner = RemoteInputOwner.NONE
        return move.hold(input)
    }

    fun stopMove(): Boolean = move.stop()

    fun reset() {
        releaseSensor()
        tiltOwner = RemoteInputOwner.NONE
        tilt.stop()
        move.stop()
    }

    private fun slew(from: Int, target: Int, elapsedMs: Long): Int {
        val distance = abs(target - from)
        if (distance == 0) return target
        val fullRange = (255 - REMOTE_TILT_CENTER).toLong()
        val allowed = (fullRange * elapsedMs / SENSOR_TILT_SLEW_FULL_RANGE_MS).toInt()
        val step = min(distance, max(1, allowed))
        return if (target > from) from + step else from - step
    }
}
