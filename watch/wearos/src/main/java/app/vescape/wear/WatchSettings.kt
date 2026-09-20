package app.vescape.wear

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.Color

/**
 * Data Layer path the phone publishes rider settings on. Must match the phone-side
 * `WatchSettingsPusher`. Arrives once per settings change and then persists, so it is read on every
 * start rather than waited for.
 *
 * The payload is a `DataMap`: a key-value bag rather than a packed frame, so phone and watch builds
 * of different ages still agree — an unknown key is ignored, and a key an older phone never sends
 * falls back to the wrist default below.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
 * @parity /modules/vescape-core/ios/watch/WatchSettings.swift
 */
const val SETTINGS_PATH = "/settings"

/** Rider colour as a `#RRGGBB` string; blank means the rider has not chosen one. */
const val SETTING_RIDER_COLOR = "riderColor"

/** Board Move strength, percent of full scale. Displayed on the wrist; the phone applies it. */
const val SETTING_BOARD_MOVE_STRENGTH = "boardMoveStrengthPercent"

/** Whether to draw the direction arrow over the route. The route itself is never affected. */
const val SETTING_NAV_ARROW = "navArrowEnabled"

/** App-wide speed and distance preference; older phones default to metric. */
const val SETTING_UNIT_SYSTEM = "unitSystem"

/** Phone settings the wrist mirrors. Every field defaults to the wrist's own look. */
data class WatchSettings(
    val riderColor: Color? = null,
    val unitSystem: String = "metric",
    /** Off by default: an older phone never sends the key, and the arrow is opt-in until it works. */
    val navArrowEnabled: Boolean = false,
    /** Null until a phone new enough to send it has pushed; the wrist then shows no number. */
    val boardMoveStrengthPercent: Int? = null,
) {
    companion object {
        /** Missing or unknown preference values from older/newer phones always mean metric. */
        fun decode(payload: Map<String, Any?>): WatchSettings = WatchSettings(
            riderColor = parseRiderColor(payload[SETTING_RIDER_COLOR] as? String),
            navArrowEnabled = payload[SETTING_NAV_ARROW] as? Boolean ?: false,
            boardMoveStrengthPercent = payload[SETTING_BOARD_MOVE_STRENGTH] as? Int,
            unitSystem = if (payload[SETTING_UNIT_SYSTEM] == "imperial") "imperial" else "metric",
        )
    }
}

/** Latest settings pushed from the phone. Defaults apply until the first push arrives. */
object SettingsState {
    val settings = mutableStateOf(WatchSettings())

    fun accept(settings: WatchSettings) {
        this.settings.value = settings
    }
}

/**
 * `#RRGGBB` / `#AARRGGBB` (the form the phone's rider palette stores) into a [Color]. Anything else
 * — blank, a colour name, a future format — is null, which leaves the wrist on its own palette
 * rather than drawing a route in a colour nobody picked.
 */
fun parseRiderColor(value: String?): Color? {
    val hex = value?.trim()?.removePrefix("#") ?: return null
    if (hex.length != 6 && hex.length != 8) return null
    val rgb = hex.toLongOrNull(radix = 16) ?: return null
    return Color(if (hex.length == 6) rgb or 0xFF000000L else rgb)
}
