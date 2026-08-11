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
internal const val WATCH_COMMAND_KIND_MIRROR_AWAKE = 2

/**
 * How long the phone keeps pushing frames after the last wrist wake-level tick. The Mirror re-sends
 * every `WATCH_MIRROR_AWAKE_HEARTBEAT_MS` (15 s) while it is on screen, so this is three missed
 * ticks. An explicit `ASLEEP` on `onStop` is the fast path; this dead-man is what stops the push
 * when that message is lost, the watch leaves Bluetooth range, or the wrist app is killed outright.
 */
internal const val WATCH_MIRROR_AWAKE_TIMEOUT_MS = 45_000L

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

/**
 * How awake the wrist is, and therefore how fast frames are worth sending. Capability presence only
 * proves the Mirror is *installed*; without this the phone pushes 4 Hz into a stopped activity for
 * as long as the service lives, which is the single biggest avoidable drain on both devices.
 *
 * Wire values — append, never renumber.
 */
internal enum class WatchMirrorWakeLevel(val wire: Int) {
    /** Mirror stopped (or presumed stopped after [WATCH_MIRROR_AWAKE_TIMEOUT_MS]). Push nothing. */
    ASLEEP(0),

    /** Mirror on screen and interactive. Full cadence. */
    ACTIVE(1),

    /** Mirror in ambient/AOD. The wrist redraws about once a minute, so trickle. */
    AMBIENT(2),
    ;

    internal companion object {
        fun fromWire(wire: Int): WatchMirrorWakeLevel? = entries.firstOrNull { it.wire == wire }
    }
}

/** A decoded wrist command. */
internal sealed interface WatchCommand {
    /** Hold the board rolling in [direction] (`-1` back, `0` stop, `1` forward) until the next tick. */
    data class Move(val direction: Int) : WatchCommand

    /** The Mirror reporting how awake it is; re-sent on a heartbeat so its absence is meaningful. */
    data class MirrorAwake(val level: WatchMirrorWakeLevel) : WatchCommand
}

/** Pure bytes -> [WatchCommand] decoder. Returns null for a short buffer or an unknown kind. */
internal object WatchCommandDecoder {
    fun decode(bytes: ByteArray): WatchCommand? {
        if (bytes.size < 2) return null
        return when (bytes[0].toInt()) {
            WATCH_COMMAND_KIND_MOVE -> WatchCommand.Move(bytes[1].toInt().coerceIn(-1, 1))
            WATCH_COMMAND_KIND_MIRROR_AWAKE ->
                WatchMirrorWakeLevel.fromWire(bytes[1].toInt())?.let(WatchCommand::MirrorAwake)
            else -> null
        }
    }
}
