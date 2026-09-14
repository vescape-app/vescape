package expo.modules.vescapecore

import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Who is allowed to write the board's remote-input slot.
 *
 * Refloat has one temporary remote input and three things in this app want it: the rider's tilt pad,
 * Board Move, and a ground-clearance Accessory. Before this existed they were three writers with no
 * referee, which is fine only for as long as no two of them are active at once.
 *
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift `RemoteInputOwner`
 * @parity /modules/vescape-core/src/index.ts `RemoteTiltOwner`
 */
internal enum class RemoteInputOwner(val wire: String) {
    /** Nothing is streaming. The board's input lapses on its own ~1s after the last write. */
    NONE("none"),

    /** The rider's pad, through the bridge. */
    MANUAL("manual"),

    /** A calibrated ground-clearance Accessory, through the Board Session's own tick. */
    SENSOR("sensor"),

    /** Board Move: motor output on a disengaged board, which shares the same slot. */
    MOVE("move"),
}

/**
 * How fast a sensor-driven correction is allowed to move.
 *
 * The same bound [RemoteTiltController] eases a cancel at, and for the same reason: a self-balancing
 * board answers a step change in commanded tilt with a surge. Nothing about the source makes the
 * step safer — a pothole under the sensor produces a full-range swing in one 20 Hz sample, and a
 * binding arming mid-ride produces one in a single tick.
 *
 * Steady state is unaffected: the commanded value converges on the reading and then follows it. Only
 * the rate of change is bounded, so "linear, clamped, direction-aware correction that follows the
 * readings" is still exactly what the board is told.
 *
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift `SENSOR_TILT_SLEW_FULL_RANGE_MS`
 */
private const val SENSOR_TILT_SLEW_FULL_RANGE_MS = REMOTE_TILT_CANCEL_FULL_RANGE_MS

/**
 * The one writer of the Board's remote-input slot.
 *
 * Every path that commands tilt or movement goes through here, so the question "who is driving the
 * board right now" has one answer held in one place instead of being inferred from three
 * controllers' private state. [BoardSessionController] owns the instance; nothing else constructs
 * one.
 *
 * Two rules carry the safety of this slice:
 *
 * - **Board Move displaces a tilt stream, a sensor does not yield to Board Move.** Jogging a board
 *   is a parked-board command, so a sensor actively correcting a ridden board refuses it outright;
 *   anything else holding the slot (a rider's tilt, or a sensor release still easing down) is
 *   dropped to neutral first. Letting a pending decay keep writing while a move streams is the two
 *   of them fighting over one byte.
 * - **A sensor never steps.** [sensorDrive] eases toward its target at
 *   [SENSOR_TILT_SLEW_FULL_RANGE_MS], so neither arming nor a discontinuous reading can hand the
 *   firmware an instant full-range angle error.
 *
 * Releasing is deliberately the existing [RemoteTiltController.cancel] — the smooth return the pad
 * already uses — and it is invoked exactly once per engaged→released transition. Calling it every
 * tick would restart the ease from a smaller value each time and never arrive.
 *
 * @parity /modules/vescape-core/ios/RemoteInputArbiter.swift
 */
internal class RemoteInputArbiter(
    private val tilt: RemoteTiltController,
    private val move: BoardMoveController,
    private val nowMs: () -> Long,
    /**
     * Whether a configured ground-clearance Accessory is connected.
     *
     * Not the same question as "is the sensor commanding right now". A binding that is bound but
     * waiting — parked, or between readings — owns nothing, and without this the slot would look
     * free to a manual command that arrives in that window. A manual *lock* taken there never ends
     * on its own and the pad is read-only, so the rider has no way to give it back: the binding
     * would be refused for the rest of the session.
     */
    private val sensorBound: () -> Boolean = { false },
) {
    /**
     * Who started the tilt stream that is currently running. Meaningless once it ends, which is why
     * [owner] consults the stream itself rather than trusting this.
     */
    private var tiltOwner = RemoteInputOwner.NONE

    /** Whether the sensor is currently commanding, as opposed to having been released. */
    private var sensorEngaged = false

    /** Last commanded sensor value and when it was commanded, for the slew limit. */
    private var sensorValue = REMOTE_TILT_CENTER
    private var sensorAtMs = 0L

    /**
     * Who holds the slot.
     *
     * Derived, never remembered: a tilt stream that reached neutral has released the slot whether or
     * not anyone told this class about it, and a Board Move that stopped has done the same. A
     * remembered owner would survive its own stream and lock the slot against everything else.
     */
    val owner: RemoteInputOwner
        get() = when {
            move.isMoving -> RemoteInputOwner.MOVE
            tilt.phase == RemoteTiltPhase.Idle -> RemoteInputOwner.NONE
            else -> tiltOwner
        }

    /** The value the sensor is currently commanding, for tests and for what JS renders. */
    val sensorCommand: Int
        get() = if (sensorEngaged) sensorValue else REMOTE_TILT_CENTER

    // MARK: - The rider's pad

    /**
     * Manual tilt is refused while anything else holds the slot.
     *
     * The pad is also made read-only in JS while a ground-clearance binding is bound, but that is
     * presentation. This is the rule: a bridge call that arrives anyway — a stale render, a
     * mid-flight gesture, a JS bundle that disagrees — commands nothing.
     */
    fun manualHold(value: Int): Boolean = claimManual { tilt.hold(value) }

    fun manualLock(value: Int): Boolean = claimManual { tilt.lock(value) }

    fun manualRelease(value: Int, durationMs: Long): Boolean =
        claimManual { tilt.release(value, durationMs) }

    private inline fun claimManual(start: () -> Boolean): Boolean {
        // Asked before ownership, because a bound binding that is not currently driving leaves the
        // slot unowned and would otherwise let a manual command in.
        if (sensorBound()) return false
        when (owner) {
            RemoteInputOwner.SENSOR, RemoteInputOwner.MOVE -> return false
            RemoteInputOwner.NONE, RemoteInputOwner.MANUAL -> Unit
        }
        val started = start()
        if (started) tiltOwner = RemoteInputOwner.MANUAL
        return started
    }

    /**
     * Ease whatever is commanded back to neutral, whoever commanded it.
     *
     * Ungated on purpose. Cancel is the rider's way out and must survive a link that lost trust
     * mid-hold; that has always been true of the pad's cancel and stays true with a sensor in the
     * picture. A sensor still holding valid readings simply re-engages on its next tick, ramped —
     * the cancel is not an off switch for the binding, and does not pretend to be one.
     */
    fun cancelTilt(): Boolean {
        releaseSensor()
        return tilt.cancel()
    }

    /**
     * Hand the slot back from the rider so a binding that just armed can take it.
     *
     * A manual lock never ends on its own, so a binding arming under one would wait forever. Arming
     * is exactly the moment the pad stops being the rider's, so the held value stops being theirs
     * too — eased down, never snapped.
     *
     * Safe to call on every tick, which is how the binding calls it: an ease already running is left
     * alone. Re-cancelling a decay would restart it from a smaller value each time and never arrive,
     * and one failed cancel — a transport that blinked — must not strand the lock forever.
     */
    fun releaseManual(): Boolean {
        if (owner != RemoteInputOwner.MANUAL) return false
        if (tilt.phase == RemoteTiltPhase.Decaying) return false
        return tilt.cancel()
    }

    // MARK: - Ground-clearance sensor

    /**
     * Command one sensor-derived tilt value, rate-limited.
     *
     * Returns false when the slot belongs to something else, so the caller can say which reason the
     * rider is looking at. A refusal leaves the sensor disengaged: it does not queue.
     */
    fun sensorDrive(target: Int): Boolean {
        when (owner) {
            RemoteInputOwner.MOVE, RemoteInputOwner.MANUAL -> {
                sensorEngaged = false
                return false
            }

            RemoteInputOwner.NONE, RemoteInputOwner.SENSOR -> Unit
        }
        val now = nowMs()
        // The ramp is measured from what the board is actually being told, which is not always
        // neutral at a fresh engage: a release still easing down — this binding's own, or the
        // rider's cancel — is a live stream holding a real value. Starting from neutral there would
        // step the commanded tilt by the whole of the unfinished decay in one write, which is
        // exactly the snap the slew limit exists to prevent.
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

    /**
     * Let go of a sensor-driven tilt through the pad's own smooth return.
     *
     * Idempotent by design: the Board Session calls this on every tick it has no valid reading, and
     * only the first one after an engagement actually cancels.
     */
    fun sensorRelease(): Boolean {
        if (!releaseSensor()) return false
        if (owner != RemoteInputOwner.SENSOR) return false
        return tilt.cancel()
    }

    /** Clears the engaged flag and says whether it had been set. */
    private fun releaseSensor(): Boolean {
        if (!sensorEngaged) return false
        sensorEngaged = false
        sensorValue = REMOTE_TILT_CENTER
        return true
    }

    // MARK: - Board Move

    /**
     * Start a Board Move, taking the slot from any tilt stream that still holds it.
     *
     * The displaced stream is dropped to neutral rather than eased, because the board a Move is
     * meant for is a disengaged one: there is no rider on it for a step to throw, and easing would
     * mean up to [REMOTE_TILT_CANCEL_FULL_RANGE_MS] of tilt packets interleaved with move packets.
     * A sensor actively correcting says the board *is* being ridden, so that case refuses instead.
     */
    fun startMove(input: Int): Boolean {
        // A sensor that is *still correcting* says the board is being ridden. One that has already
        // let go leaves only the decay tail — and that tail outliving the move is the exact failure
        // this is here to prevent, so it gets dropped rather than deferred to.
        if (sensorEngaged) return false
        if (tilt.phase != RemoteTiltPhase.Idle) tilt.stop()
        releaseSensor()
        tiltOwner = RemoteInputOwner.NONE
        return move.hold(input)
    }

    /** Deliberately ungated, exactly as before: a stop must reach the board whatever else is true. */
    fun stopMove(): Boolean = move.stop()

    // MARK: - Teardown

    /** Immediate neutral on both channels. Session teardown only. */
    fun reset() {
        releaseSensor()
        tiltOwner = RemoteInputOwner.NONE
        tilt.stop()
        move.stop()
    }

    /**
     * One step of the slew limit: at most a full range per [SENSOR_TILT_SLEW_FULL_RANGE_MS].
     *
     * `elapsed` is the real gap since the last command rather than an assumed tick, so a tick that
     * ran late is allowed the movement it was owed instead of stretching the ramp.
     */
    private fun slew(from: Int, target: Int, elapsedMs: Long): Int {
        val distance = abs(target - from)
        if (distance == 0) return target
        val fullRange = (255 - REMOTE_TILT_CENTER).toLong()
        val allowed = (fullRange * elapsedMs / SENSOR_TILT_SLEW_FULL_RANGE_MS).toInt()
        // Never zero: a tick short enough to round the allowance away would freeze the command
        // rather than slow it, and the binding would sit at whatever it first commanded.
        val step = min(distance, max(1, allowed))
        return if (target > from) from + step else from - step
    }
}
