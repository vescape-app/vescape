package expo.modules.vescapecore.watch

import expo.modules.vescapecore.protocol.BOARD_MOVE_INPUT_MAX
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/**
 * @parity /modules/vescape-core/ios/watch/WatchMoveRelay.swift
 */
internal class WatchMoveRelay(
    private val scheduler: Scheduler,
    private val strengthPercent: () -> Int,
    private val startMove: (Int) -> Boolean,
    private val stopMove: () -> Boolean,
    private val record: (String, Map<String, Any?>) -> Unit,
    private val deadManMs: Long = WATCH_MOVE_DEADMAN_MS,
) {
    private var direction = 0
    private var deadMan: Cancellable? = null

    fun accept(direction: Int) {
        scheduler.post { apply(direction.coerceIn(-1, 1)) }
    }

    fun cancel() {
        scheduler.post { apply(0) }
    }

    private fun apply(next: Int) {
        deadMan?.cancel()
        deadMan = null

        if (next == 0) {
            if (direction != 0) {
                direction = 0
                stopMove()
                record("watch_move_released", emptyMap())
            }
            return
        }

        val input = next * (BOARD_MOVE_INPUT_MAX * strengthPercent().coerceIn(0, 100) / 100)
        val accepted = startMove(input)
        if (direction != next) {
            direction = next
            record("watch_move_held", mapOf("direction" to next, "input" to input, "accepted" to accepted))
        }
        deadMan = scheduler.postDelayed(deadManMs) { deadManStop() }
    }

    private fun deadManStop() {
        deadMan = null
        if (direction == 0) return
        direction = 0
        stopMove()
        record("watch_move_deadman_stop", emptyMap())
    }
}
