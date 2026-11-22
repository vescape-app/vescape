package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BOARD_MOVE_INPUT_MAX
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.protocol.buildBoardMoveCommand
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

private const val BOARD_MOVE_REMOTE_REPEAT_MS = 100L

private const val BOARD_MOVE_RC_MOVE_REPEAT_MS = 700L

private fun boardMoveRepeatMs(generation: BoardMoveGeneration): Long = when (generation) {
    BoardMoveGeneration.Remote -> BOARD_MOVE_REMOTE_REPEAT_MS
    BoardMoveGeneration.RcMove -> BOARD_MOVE_RC_MOVE_REPEAT_MS
}

/**
 * @parity /modules/vescape-core/ios/BoardMoveController.swift
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

    val currentInput: Int?
        get() = input

    val isMoving: Boolean
        get() = input != null

    fun hold(input: Int): Boolean {
        val clamped = input.coerceIn(-BOARD_MOVE_INPUT_MAX, BOARD_MOVE_INPUT_MAX)
        if (clamped == 0) return stop()
        if (!canMove()) return false
        val transport = transport() ?: return false

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
