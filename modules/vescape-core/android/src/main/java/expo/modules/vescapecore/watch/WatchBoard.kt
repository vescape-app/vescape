package expo.modules.vescapecore.watch

/**
 * Data Layer path carrying board state the wrist needs but cannot derive. Cold data like the
 * settings: it changes on a board echo or a config seed, not per tick, and it must outlive the
 * frame stream, which stops at wake level `ASLEEP`.
 *
 * The payload is a `DataMap` rather than spare Watch Frame flag bits, and deliberately so. Lights
 * are tri-state — a key is absent while this Board Session has never heard the board say — and a
 * flags byte has no "unknown" to encode that with. A bag is also forward- and backward-compatible
 * for free: an older wrist ignores keys it does not know, and a newer wrist falls back to unknown
 * for keys an older phone never sends, where a mis-ordered frame lane would silently misread.
 *
 * The wrist-side peer carries the same path and key names by convention.
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchBoard.kt
 */
internal const val WATCH_BOARD_PATH = "/board"

/** LEDs on/off. Absent means the board has never said, which is not the same as off. */
internal const val WATCH_BOARD_LIGHTS_ENABLED = "lightsEnabled"

/** Headlights on/off. Absent means the board has never said, which is not the same as off. */
internal const val WATCH_BOARD_HEADLIGHTS_ENABLED = "headlightsEnabled"

/**
 * Whether a light write would be accepted at all. Computed phone-side from the same conditions the
 * phone UI and native already use, so the wrist duplicates no policy and stays a dumb surface.
 */
internal const val WATCH_BOARD_LIGHTS_CONTROLLABLE = "lightsControllable"

/**
 * The wrist-relevant slice of the Board Session's light state. Nulls are what the phone's
 * `BoardLightsState?` means: this session has never heard an echo. Equality is what decides
 * whether a push is needed.
 */
internal data class WatchBoard(
    val lightsEnabled: Boolean?,
    val headlightsEnabled: Boolean?,
    val lightsControllable: Boolean,
)
