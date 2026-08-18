package expo.modules.vescapecore.watch

import expo.modules.vescapecore.protocol.BOARD_MOVE_INPUT_MAX
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/**
 * Turns wrist [WatchCommand.Move] ticks into the same Board Move stream the phone UI drives, so a
 * wrist press and a phone press are literally the same action (ADR-0033). Strength stays a phone
 * setting: the wrist sends a direction, never an input value.
 *
 * A held button arrives as a repeated tick rather than a press/release pair, and every tick re-arms
 * a dead-man. Nothing about the wrist link is trustworthy enough for press/release: the release is
 * the one message that must not be lost, and it is exactly the message a Bluetooth drop eats.
 *
 * Re-issuing the hold each tick is deliberate — it costs nothing (the controller's repeat loop is
 * already running and only swaps its input) and it self-heals a hold that was refused when it
 * started, e.g. a board that finished connecting mid-press.
 *
 * Commands arrive on a Wear binder thread; every mutation hops to [scheduler], the one thread
 * allowed to touch Board Session state.
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

    /**
     * Session teardown. Posted like [accept] so a command already in flight from the wrist cannot
     * land after it and re-arm a dead-man nobody is left to answer, and it stops an active hold
     * rather than trusting teardown order to have done it.
     */
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
