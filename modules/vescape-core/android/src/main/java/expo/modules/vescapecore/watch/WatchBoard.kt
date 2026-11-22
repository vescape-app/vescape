package expo.modules.vescapecore.watch

/**
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt
 */
internal const val WATCH_BOARD_PATH = "/board"

internal const val WATCH_BOARD_LIGHTS_ENABLED = "lightsEnabled"

internal const val WATCH_BOARD_HEADLIGHTS_ENABLED = "headlightsEnabled"

internal const val WATCH_BOARD_LIGHTS_CONTROLLABLE = "lightsControllable"

internal data class WatchBoard(
    val lightsEnabled: Boolean?,
    val headlightsEnabled: Boolean?,
    val lightsControllable: Boolean,
)
