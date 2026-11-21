package app.vescape.wear

import androidx.compose.runtime.mutableStateOf

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchBoard.kt
 */
const val BOARD_PATH = "/board"

const val BOARD_LIGHTS_ENABLED = "lightsEnabled"

const val BOARD_HEADLIGHTS_ENABLED = "headlightsEnabled"

const val BOARD_LIGHTS_CONTROLLABLE = "lightsControllable"

data class WatchBoardLights(
    val lightsEnabled: Boolean? = null,
    val headlightsEnabled: Boolean? = null,
    val lightsControllable: Boolean = false,
)

/**
 * @parity /modules/vescape-core/ios/watch/WatchBoard.swift `decode`
 */
internal fun decodeBoardLightsPayload(payload: Map<String, Any?>?): WatchBoardLights = WatchBoardLights(
    lightsEnabled = payload?.get(BOARD_LIGHTS_ENABLED) as? Boolean,
    headlightsEnabled = payload?.get(BOARD_HEADLIGHTS_ENABLED) as? Boolean,
    lightsControllable = payload?.get(BOARD_LIGHTS_CONTROLLABLE) as? Boolean ?: false,
)

object BoardState {
    val lights = mutableStateOf(WatchBoardLights())

    fun accept(lights: WatchBoardLights) {
        this.lights.value = lights
    }
}
