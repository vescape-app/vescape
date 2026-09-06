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
 * are known. Edits that arrive before the board echoes compose on top of each other, so a quick
 * second tap cannot undo the first.
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
    /** The pair last written from a wrist edit, and the phone truth it was composed against. */
    private var pending: BoardLightsState? = null
    private var pendingBase: BoardLightsState? = null

    fun accept(switch: WatchLightsSwitch, on: Boolean) {
        scheduler.post { apply(switch, on) }
    }

    private fun apply(switch: WatchLightsSwitch, on: Boolean) {
        val truth = currentLights()
        // A second edit before the first echo must build on the first, or it states the pre-edit
        // value of the other switch and reverts it. The moment the phone's own truth moves — echo,
        // config seed, session end — that truth wins again and the pending pair is forgotten, which
        // is what keeps a wrist edit from reverting a switch the phone changed meanwhile.
        val base = if (pending != null && truth == pendingBase) pending else truth
        val next = composeBoardLights(base, switch, on)
        if (next == null) {
            // The board has never said what its lights are, so there is no second value to state.
            pending = null
            pendingBase = null
            record("watch_lights_dropped", mapOf("switch" to switch.name, "on" to on))
            return
        }
        val accepted = setLights(next.enabled, next.headlightsEnabled)
        pending = if (accepted) next else null
        pendingBase = if (accepted) truth else null
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
