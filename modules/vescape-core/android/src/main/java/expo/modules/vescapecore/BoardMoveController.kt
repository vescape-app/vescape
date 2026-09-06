package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BOARD_MOVE_INPUT_MAX
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.protocol.buildBoardMoveCommand
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/**
 * Refresh interval for the 1.3+ `REMOTE` input byte, which firmware lapses after
 * ~1s of silence. The packet only carries a value, so re-sending it often is
 * free.
 */
private const val BOARD_MOVE_REMOTE_REPEAT_MS = 100L

/**
 * Refresh interval for the 1.0–1.2 `RC_MOVE` command. That packet is a
 * *duration* request carrying `RC_MOVE_TIME_STEPS` (~1s of run time), and
 * firmware zeroes its move current and ramps it back to the target on every
 * request. So both extremes stutter: repeating on the 1.3+ cadence restarts the
 * ramp ten times a second, and repeating slower than the request's own life
 * leaves silent gaps. Re-send inside that life, rarely enough that the ramp
 * restart stays a dip rather than the signal.
 */
private const val BOARD_MOVE_RC_MOVE_REPEAT_MS = 700L

private fun boardMoveRepeatMs(generation: BoardMoveGeneration): Long = when (generation) {
    BoardMoveGeneration.Remote -> BOARD_MOVE_REMOTE_REPEAT_MS
    BoardMoveGeneration.RcMove -> BOARD_MOVE_RC_MOVE_REPEAT_MS
}

/**
 * Streams Refloat's Board Move input: motor output while the board is
 * disengaged. This is not Remote Tilt — it never touches the tilt setpoint and
 * never writes config.
 *
 * The rider holds a direction button and the board keeps moving until release,
 * so the held input is repeated on a tick chosen per generation (both firmware
 * generations drop the request after ~1s of silence, but only the 1.3+ packet
 * tolerates a fast refresh — see [boardMoveRepeatMs]). Releasing sends an urgent
 * neutral so the board stops immediately instead of coasting to the firmware
 * timeout.
 *
 * Firmware owns the safety envelope: 1.0–1.2 `cmd_rc_move` and 1.3+
 * `remote_command_input` both apply output only from the ready (disengaged)
 * state, and 1.3+ additionally holds a 2s grace after disengaging.
 *
 * @parity /modules/vescape-core/ios/BoardMoveController.swift
 * @param transport supplies the active transport only while the session can talk to the board;
 *   `null` otherwise.
 * @param canMove whether move commands are allowed at all (trusted link). Re-checked every tick,
 *   so a link that loses trust mid-hold is stopped with a neutral rather than left streaming.
 * @param generation picks the wire format from the linked Refloat version.
 * @param send writes a framed payload. `urgent` means the stop input, which must
 *   pass normal traffic at the next write boundary.
 */
internal class BoardMoveController(
    private val scheduler: Scheduler,
    private val transport: () -> BoardTransport?,
    private val canMove: () -> Boolean,
    private val generation: () -> BoardMoveGeneration,
    private val send: (payload: ByteArray, urgent: Boolean) -> Boolean,
) {
    private var input: Int? = null
    private var repeat: Cancellable? = null

    /** The input currently being streamed (`-127..127`), or `null` when idle. */
    val currentInput: Int?
        get() = input

    val isMoving: Boolean
        get() = input != null

    /**
     * Hold a constant move input until [stop]. [input] is `-127..127`; `0` is
     * treated as a stop.
     */
    fun hold(input: Int): Boolean {
        val clamped = input.coerceIn(-BOARD_MOVE_INPUT_MAX, BOARD_MOVE_INPUT_MAX)
        if (clamped == 0) return stop()
        if (!canMove()) return false
        val transport = transport() ?: return false

        // A running loop picks the new input up on its next tick; changing
        // direction mid-hold must not schedule an extra write.
        val alreadyStreaming = repeat != null
        this.input = clamped
        if (alreadyStreaming) return true

        val generation = generation()
        val sent = send(buildBoardMoveCommand(transport, generation, clamped), false)
        scheduleRepeat(generation)
        return sent
    }

    fun stop(): Boolean {
        val wasMoving = input != null
        clear()
        transport()?.let { send(buildBoardMoveCommand(it, generation(), 0), true) }
        return wasMoving
    }

    private fun scheduleRepeat(generation: BoardMoveGeneration) {
        repeat = scheduler.postDelayed(boardMoveRepeatMs(generation)) {
            val input = input
            val transport = transport()
            if (input == null || transport == null) {
                clear()
                return@postDelayed
            }
            if (!canMove()) {
                stop()
                return@postDelayed
            }
            val generation = generation()
            send(buildBoardMoveCommand(transport, generation, input), false)
            scheduleRepeat(generation)
        }
    }

    private fun clear() {
        input = null
        repeat?.cancel()
        repeat = null
    }
}
