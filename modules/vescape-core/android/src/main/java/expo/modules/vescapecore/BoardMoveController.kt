package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BOARD_MOVE_INPUT_MAX
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.protocol.buildBoardMoveCommand
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/** Both Refloat generations lapse a move request within ~1s of silence. */
private const val BOARD_MOVE_REPEAT_MS = 100L

/**
 * Streams Refloat's Board Move input: motor output while the board is
 * disengaged. This is not Remote Tilt — it never touches the tilt setpoint and
 * never writes config.
 *
 * The rider holds a direction button and the board keeps moving until release,
 * so the held input is repeated on a fixed [BOARD_MOVE_REPEAT_MS] tick (both
 * firmware generations drop the request after ~1s of silence). Releasing sends
 * an urgent neutral so the board stops immediately instead of coasting to the
 * firmware timeout.
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

        val sent = send(buildBoardMoveCommand(transport, generation(), clamped), false)
        scheduleRepeat()
        return sent
    }

    fun stop(): Boolean {
        val wasMoving = input != null
        clear()
        transport()?.let { send(buildBoardMoveCommand(it, generation(), 0), true) }
        return wasMoving
    }

    private fun scheduleRepeat() {
        repeat = scheduler.postDelayed(BOARD_MOVE_REPEAT_MS) {
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
            send(buildBoardMoveCommand(transport, generation(), input), false)
            scheduleRepeat()
        }
    }

    private fun clear() {
        input = null
        repeat?.cancel()
        repeat = null
    }
}
