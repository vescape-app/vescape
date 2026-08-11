package expo.modules.vescapecore.watch

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import expo.modules.vescapecore.service.CoreForegroundService

/**
 * Receives wrist commands (ADR-0033). Declared in the manifest rather than bound by an Activity so
 * a wrist press works with the phone in a pocket and the phone UI dead — the exact situation Board
 * Move from the wrist exists for.
 *
 * The service can wake a cold process, which is harmless: with no live Board Session there is
 * nothing to move and the command is dropped by [CoreForegroundService.watchMove].
 */
class WatchCommandListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WATCH_COMMAND_PATH) return
        when (val command = WatchCommandDecoder.decode(event.data)) {
            is WatchCommand.Move -> CoreForegroundService.watchMove(command.direction)
            null -> Unit
        }
    }
}
