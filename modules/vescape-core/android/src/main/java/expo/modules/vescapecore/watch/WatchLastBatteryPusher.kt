package expo.modules.vescapecore.watch

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.service.CoreForegroundService
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.TelemetryRepository
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Publishes the selected Board's committed battery to the wrist. Fire-and-forget like the iOS
 * Application Context push; each write rereads storage under the mutex, so an older one cannot win.
 *
 * @parity /modules/vescape-core/ios/connection/BoardSessionController.swift `pushWatchLastBattery`
 */
internal object WatchLastBatteryPusher {
    private val writes = Mutex()

    fun push(context: Context) {
        val appCtx = context.applicationContext
        CoreForegroundService.appDataScope.launch { writes.withLock { write(appCtx) } }
    }

    private suspend fun write(context: Context) {
        val battery = try {
            val repo = AppDataRepository.get(context)
            val id = repo.getTypedSettings().selectedBoardId
            WatchLastBattery.selected(id, id?.let { repo.getBoard(it) })
        } catch (error: Exception) {
            RecordingStorageFailure.reportRead("watch_last_battery_read", error)
            return
        }
        try {
            val dataClient = Wearable.getDataClient(context)
            if (battery == null) {
                Tasks.await(dataClient.deleteDataItems(PutDataRequest.create(WATCH_LAST_BATTERY_PATH).uri))
                return
            }
            val request = PutDataMapRequest.create(WATCH_LAST_BATTERY_PATH).apply {
                dataMap.putString("boardId", battery.boardId)
                dataMap.putString("boardName", battery.boardName)
                battery.percent?.let { dataMap.putDouble("percent", it) }
                battery.at?.let { dataMap.putLong("at", it) }
            }.asPutDataRequest().setUrgent()
            Tasks.await(dataClient.putDataItem(request))
        } catch (error: Exception) {
            TelemetryRepository.get(context).recordDiagnosticEvent("watch_last_battery_push_failed", mapOf("error" to error.message))
        }
    }
}
