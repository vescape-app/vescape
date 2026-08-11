package expo.modules.vescapecore.watch

/**
 * Wrist -> phone command channel (ADR-0033). The only direction the Watch Mirror ever talks back in:
 * a rider intent, never state. State stays one-way (phone -> wrist) as ADR-0019 set out.
 *
 * [com.google.android.gms.wearable.MessageClient], not the Data Layer: a command is worthless once
 * stale, so fire-and-forget with no delivery guarantee is exactly right — a dropped tick is covered
 * by the next one, and a dropped release is covered by the dead-man in [WatchMoveRelay].
 *
 * The payload is two bytes — `[kind, value]` — read leniently so a wrist newer than the phone
 * degrades to "unknown kind, ignored" rather than to a misread command that moves the board.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt
 */
internal const val WATCH_COMMAND_PATH = "/command"

/** Command kinds. Values are wire constants — append, never renumber. */
internal const val WATCH_COMMAND_KIND_MOVE = 1

/**
 * How long a held Board Move survives without a fresh wrist tick before the phone stops the board.
 * The wrist re-sends every `WATCH_MOVE_REPEAT_MS` (300 ms) while a button is held, so this is three
 * missed ticks.
 *
 * This is the safety property of the whole feature: press/release alone is not enough, because a
 * release lost to a Bluetooth drop would leave the phone streaming motor output at 100 ms forever —
 * the firmware's own ~1 s lapse never fires while the phone keeps talking.
 */
internal const val WATCH_MOVE_DEADMAN_MS = 900L

/** A decoded wrist command. */
internal sealed interface WatchCommand {
    /** Hold the board rolling in [direction] (`-1` back, `0` stop, `1` forward) until the next tick. */
    data class Move(val direction: Int) : WatchCommand
}

/** Pure bytes -> [WatchCommand] decoder. Returns null for a short buffer or an unknown kind. */
internal object WatchCommandDecoder {
    fun decode(bytes: ByteArray): WatchCommand? {
        if (bytes.size < 2) return null
        return when (bytes[0].toInt()) {
            WATCH_COMMAND_KIND_MOVE -> WatchCommand.Move(bytes[1].toInt().coerceIn(-1, 1))
            else -> null
        }
    }
}
