package expo.modules.vescapecore.watch

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import expo.modules.vescapecore.notices.RideNotices
import expo.modules.vescapecore.service.CoreForegroundService

/**
 * Receives wrist commands (ADR-0033). Declared in the manifest rather than bound by an Activity so
 * a wrist press works with the phone in a pocket and the phone UI dead — the exact situation Board
 * Move from the wrist exists for.
 *
 * The service can wake a cold process, which is harmless: with no live Board Session there is
 * nothing to move and no lights to state, so the command is dropped by
 * [CoreForegroundService.watchMove] / [CoreForegroundService.watchLights].
 */
class WatchCommandListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WATCH_COMMAND_PATH) return
        routeWatchCommand(event.data)
    }
}

/**
 * Decode and route one wrist command. A notice dismiss skips the service: Ride Notices are
 * process-wide, so it goes straight into the same [RideNotices.dismiss] the phone card calls, Board
 * Session or not. [dismissNotice] is the seam tests drive with a bare engine.
 *
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `acceptWatchCommand`
 */
internal fun routeWatchCommand(
    bytes: ByteArray,
    dismissNotice: (id: Int, rev: Int) -> Unit = RideNotices::dismiss,
) {
    when (val command = WatchCommandDecoder.decode(bytes)) {
        is WatchCommand.Move -> CoreForegroundService.watchMove(command.direction)
        is WatchCommand.MirrorAwake -> CoreForegroundService.watchMirrorWakeLevel(command.level)
        is WatchCommand.Lights -> CoreForegroundService.watchLights(command.switch, command.on)
        is WatchCommand.TiltLock -> CoreForegroundService.watchTiltLock(command.value)
        WatchCommand.TiltCancel -> CoreForegroundService.watchTiltCancel()
        is WatchCommand.DismissNotice -> dismissNotice(command.id, command.rev)
        null -> Unit
    }
}
