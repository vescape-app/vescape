package expo.modules.vescapecore.watch

import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.runtime.Scheduler

internal class WatchLightsRelay(
    private val scheduler: Scheduler,
    private val currentLights: () -> BoardLightsState?,
    private val setLights: (Boolean, Boolean) -> Boolean,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private var pending: BoardLightsState? = null
    private var pendingBase: BoardLightsState? = null

    fun accept(switch: WatchLightsSwitch, on: Boolean) {
        scheduler.post { apply(switch, on) }
    }

    private fun apply(switch: WatchLightsSwitch, on: Boolean) {
        val truth = currentLights()
        val base = if (pending != null && truth == pendingBase) pending else truth
        val next = composeBoardLights(base, switch, on)
        if (next == null) {
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
