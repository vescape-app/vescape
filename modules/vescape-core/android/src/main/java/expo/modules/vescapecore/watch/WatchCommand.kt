package expo.modules.vescapecore.watch

/**
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchCommand.kt
 * @parity /modules/vescape-core/ios/watch/WatchCommand.swift
 */
internal const val WATCH_COMMAND_PATH = "/command"

internal const val WATCH_COMMAND_KIND_MOVE = 1
internal const val WATCH_COMMAND_KIND_MIRROR_AWAKE = 2
internal const val WATCH_COMMAND_KIND_LIGHTS = 3
internal const val WATCH_COMMAND_KIND_TILT_LOCK = 4
internal const val WATCH_COMMAND_KIND_TILT_CANCEL = 5
internal const val WATCH_COMMAND_KIND_DISMISS_NOTICE = 6

internal const val WATCH_MIRROR_AWAKE_TIMEOUT_MS = 45_000L

internal const val WATCH_MOVE_DEADMAN_MS = 900L

internal enum class WatchMirrorWakeLevel(val wire: Int) {
    ASLEEP(0),

    ACTIVE(1),

    AMBIENT(2),
    ;

    internal companion object {
        fun fromWire(wire: Int): WatchMirrorWakeLevel? = entries.firstOrNull { it.wire == wire }
    }
}

internal enum class WatchLightsSwitch(val selector: Int) {
    LEDS(0),
    HEADLIGHT(1),
    ;

    internal companion object {
        fun fromSelector(selector: Int): WatchLightsSwitch? = entries.firstOrNull { it.selector == selector }
    }
}

internal sealed interface WatchCommand {
    data class Move(val direction: Int) : WatchCommand

    data class MirrorAwake(val level: WatchMirrorWakeLevel) : WatchCommand

    data class Lights(val switch: WatchLightsSwitch, val on: Boolean) : WatchCommand

    data class TiltLock(val value: Int) : WatchCommand

    data object TiltCancel : WatchCommand

    data class DismissNotice(val id: Int, val rev: Int) : WatchCommand
}

internal object WatchCommandDecoder {
    fun decode(bytes: ByteArray): WatchCommand? {
        if (bytes.size < 2) return null
        return when (bytes[0].toInt()) {
            WATCH_COMMAND_KIND_MOVE -> WatchCommand.Move(bytes[1].toInt().coerceIn(-1, 1))
            WATCH_COMMAND_KIND_MIRROR_AWAKE ->
                WatchMirrorWakeLevel.fromWire(bytes[1].toInt())?.let(WatchCommand::MirrorAwake)
            WATCH_COMMAND_KIND_LIGHTS -> {
                val value = bytes[1].toInt() and 0xff
                WatchLightsSwitch.fromSelector((value shr 1) and 0x1)
                    ?.takeIf { value and 0x3.inv() == 0 }
                    ?.let { WatchCommand.Lights(it, value and 0x1 == 1) }
            }
            WATCH_COMMAND_KIND_TILT_LOCK -> WatchCommand.TiltLock(bytes[1].toInt() and 0xff)
            WATCH_COMMAND_KIND_TILT_CANCEL -> WatchCommand.TiltCancel
            WATCH_COMMAND_KIND_DISMISS_NOTICE -> bytes.takeIf { it.size >= 3 }
                ?.let { WatchCommand.DismissNotice(it[1].toInt() and 0xff, it[2].toInt() and 0xff) }
            else -> null
        }
    }
}
