package expo.modules.vescapecore.watch

import expo.modules.vescapecore.telemetry.AppSettings

/**
 * Data Layer path carrying the rider's phone settings to the wrist. Cold data like the route: it
 * changes when the rider changes a setting, not per tick, so it rides the Data Layer and survives
 * disconnects instead of being dropped like an undelivered message.
 *
 * The payload is a `DataMap`, not a packed frame: settings arrive one at a time over the life of the
 * app, and a key-value bag is forward- and backward-compatible for free — an older wrist ignores
 * keys it does not know, and a newer wrist falls back to its own default for keys an older phone
 * never sends. That is why there is no version byte here and lanes are numbered in the Watch Frame.
 *
 * The wrist-side peer carries the same path and key names by convention.
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt
 */
internal const val WATCH_SETTINGS_PATH = "/settings"

/** Rider colour as the phone stores it: a `#RRGGBB` string, or blank for "no colour chosen". */
internal const val WATCH_SETTING_RIDER_COLOR = "riderColor"

/** Board Move strength as a percentage of full scale; the wrist displays it but never applies it. */
internal const val WATCH_SETTING_BOARD_MOVE_STRENGTH = "boardMoveStrengthPercent"

/** The wrist-relevant slice of [AppSettings]. Equality is what decides whether a push is needed. */
internal data class WatchSettings(
    val riderColor: String?,
    val boardMoveStrengthPercent: Int,
)

/**
 * Everything the wrist mirrors from the phone's settings. Adding a setting means adding a field
 * here, a key constant above, a `putX` in [WatchSettingsPusher], and a read on the wrist.
 */
internal fun AppSettings.toWatchSettings(): WatchSettings = WatchSettings(
    // Sent verbatim; the wrist is the one place that parses the colour, so garbage degrades there.
    riderColor = riderColor?.trim()?.takeIf { it.isNotEmpty() },
    boardMoveStrengthPercent = boardMoveStrengthPercent,
)
