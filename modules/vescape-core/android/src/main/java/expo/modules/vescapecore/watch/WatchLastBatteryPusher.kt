package expo.modules.vescapecore.watch

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.telemetry.AppDataRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Latest committed storage, serialized with selection pushes so an older write cannot win. */
internal object WatchLastBatteryPusher {
    private val writes = Mutex()
    suspend fun pushStored(context: Context) = writes.withLock {
        val repo = AppDataRepository.get(context)
        val id = repo.getTypedSettings().selectedBoardId
        val board = id?.let { repo.getBoard(it) }
        val stored = board?.get("lastBattery") as? Map<*, *>
        val value = if (id != null && board != null) WatchLastBattery(
            id, board["name"] as? String ?: "Board",
            (stored?.get("percent") as? Number)?.toDouble(), (stored?.get("at") as? Number)?.toLong(),
        ) else null
        val request = PutDataMapRequest.create("/last-battery").apply {
            // Explicit empty item clears the channel and remains available to a cold watch app.
            dataMap.putBoolean("present", value != null)
            value?.payload()?.forEach { (key, entry) ->
                when (entry) {
                    is String -> dataMap.putString(key, entry)
                    is Double -> dataMap.putDouble(key, entry)
                    is Long -> dataMap.putLong(key, entry)
                }
            }
        }.asPutDataRequest().setUrgent()
        Tasks.await(Wearable.getDataClient(context).putDataItem(request))
        Unit
    }
}
