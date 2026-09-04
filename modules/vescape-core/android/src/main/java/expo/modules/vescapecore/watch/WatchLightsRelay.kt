package expo.modules.vescapecore.watch

import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.runtime.Scheduler

/**
 * Turns a wrist light edit into the same `setBoardLights` write the phone UI makes (ADR-0033), so a
 * wrist tap and a phone tap are literally the same action and land in the same echo handling —
 * including the legacy config rebase, which the wrist therefore needs to know nothing about.
 *
 * The wrist sends one switch; the write states both. Composing the pair here rather than on the
 * wrist is what keeps a slightly stale `/board` push from reverting a switch the phone changed a
 * moment earlier, and it mirrors `useBoardLights`, which also refuses to write until both values
 * are known.
 *
 * Commands arrive on a Wear binder thread; every read of Board Session light state and the write
 * itself hop to [scheduler], the one thread allowed to touch that state.
 *
 * No dead-man, unlike [WatchMoveRelay]: a light write is idempotent state, not motor output, so a
 * lost message leaves the board exactly where it was and nothing has to be undone.
 */
internal class WatchLightsRelay(
    private val scheduler: Scheduler,
    private val currentLights: () -> BoardLightsState?,
    private val setLights: (Boolean, Boolean) -> Boolean,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    fun accept(switch: WatchLightsSwitch, on: Boolean) {
        scheduler.post { apply(switch, on) }
    }

    private fun apply(switch: WatchLightsSwitch, on: Boolean) {
        val next = composeBoardLights(currentLights(), switch, on)
        if (next == null) {
            // The board has never said what its lights are, so there is no second value to state.
            record("watch_lights_dropped", mapOf("switch" to switch.name, "on" to on))
            return
        }
        val accepted = setLights(next.enabled, next.headlightsEnabled)
        record(
            "watch_lights_set",
            mapOf(
                "switch" to switch.name,
                "on" to on,
                "enabled" to next.enabled,
                "headlightsEnabled" to next.headlightsEnabled,
                "accepted" to accepted,
            ),
        )
    }
}

/**
 * Apply a wrist edit to the phone's own light truth. Null [current] means this session has never
 * heard the board — with only one of the two values in hand, a write would assert a guess about the
 * other, so there is nothing honest to send.
 */
internal fun composeBoardLights(
    current: BoardLightsState?,
    switch: WatchLightsSwitch,
    on: Boolean,
): BoardLightsState? {
    if (current == null) return null
    return when (switch) {
        WatchLightsSwitch.LEDS -> current.copy(enabled = on)
        WatchLightsSwitch.HEADLIGHT -> current.copy(headlightsEnabled = on)
    }
}
