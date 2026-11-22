package expo.modules.vescapecore.watch

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import expo.modules.vescapecore.notices.RideNotices
import expo.modules.vescapecore.service.CoreForegroundService
import androidx.annotation.WorkerThread

class WatchCommandListenerService : WearableListenerService() {
    @WorkerThread
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WATCH_COMMAND_PATH) return
        routeWatchCommand(event.data)
    }
}

/**
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
