package app.vescape.wear

import androidx.compose.runtime.mutableStateOf

/**
 * Data Layer path the phone publishes board state on. Must match the phone-side `WatchBoardPusher`.
 * Arrives when the board's lights change and then persists, so it is read on every start rather
 * than waited for — and it outlives the frame stream, which stops when the wrist sleeps.
 *
 * The payload is a `DataMap`, not Watch Frame flag bits: lights are tri-state, and a bag can leave
 * a key out to say "unknown" where a flags byte can only say true or false.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchBoard.kt
 */
const val BOARD_PATH = "/board"

/** LEDs on/off. Key absent means the board has never said — not that they are off. */
const val BOARD_LIGHTS_ENABLED = "lightsEnabled"

/** Headlights on/off. Key absent means the board has never said — not that they are off. */
const val BOARD_HEADLIGHTS_ENABLED = "headlightsEnabled"

/** Whether a light write would be accepted. The phone decides; the wrist only obeys the answer. */
const val BOARD_LIGHTS_CONTROLLABLE = "lightsControllable"

/**
 * Board light state as the phone last reported it. Null is the honest default: until an echo or a
 * config seed arrives the wrist has no business drawing a switch as on or off.
 */
data class WatchBoardLights(
    val lightsEnabled: Boolean? = null,
    val headlightsEnabled: Boolean? = null,
    /** False until the phone says otherwise, so a write is never offered on a guess. */
    val lightsControllable: Boolean = false,
)

/**
 * Decode a pushed `/board` payload, or a deletion when [payload] is null — deletion means the phone
 * has nothing to say, which is unknown, never off.
 *
 * Missing keys stay unknown, so "the board has never said" never becomes "the lights are off".
 * Pure payload decoder shared by Data Layer reception, replay and sequence tests.
 * @parity /modules/vescape-core/ios/watch/WatchBoard.swift `decode`
 */
internal fun decodeBoardLightsPayload(payload: Map<String, Any?>?): WatchBoardLights = WatchBoardLights(
    lightsEnabled = payload?.get(BOARD_LIGHTS_ENABLED) as? Boolean,
    headlightsEnabled = payload?.get(BOARD_HEADLIGHTS_ENABLED) as? Boolean,
    lightsControllable = payload?.get(BOARD_LIGHTS_CONTROLLABLE) as? Boolean ?: false,
)

/** Latest board state pushed from the phone. Unknown until the first push arrives. */
object BoardState {
    val lights = mutableStateOf(WatchBoardLights())

    fun accept(lights: WatchBoardLights) {
        this.lights.value = lights
    }
}
