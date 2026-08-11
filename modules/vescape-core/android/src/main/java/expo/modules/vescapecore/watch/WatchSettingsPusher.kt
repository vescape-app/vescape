package expo.modules.vescapecore.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Phone -> Wear OS settings transport. Pushed whenever the applied settings change, which is every
 * settings write the service reloads for — not per tick.
 *
 * The service is the only publisher, so a settings change made while it is down lands on the watch
 * at the next service start, before the first frame.
 */
internal class WatchSettingsPusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    /**
     * Serializes writes. The Data Layer is last-value-wins per path, so two writes in flight can
     * land in either order and leave the wrist holding the settings the rider just replaced.
     */
    private val writes = Mutex()

    /** Last settings known to be on the wrist; cleared on failure so the next push retries. */
    @Volatile
    private var pushed: WatchSettings? = null

    fun push(settings: WatchSettings) {
        if (settings == pushed) return
        pushed = settings
        scope.launch {
            writes.withLock {
                // A value the rider has already replaced is not worth a round trip to the watch.
                if (settings != pushed) return@withLock
                try {
                    val request = PutDataMapRequest.create(WATCH_SETTINGS_PATH).apply {
                        // Blank, not absent: an absent key would leave a cleared colour looking
                        // like an older phone that never sent one, and the wrist could not tell.
                        dataMap.putString(WATCH_SETTING_RIDER_COLOR, settings.riderColor ?: "")
                        dataMap.putInt(WATCH_SETTING_BOARD_MOVE_STRENGTH, settings.boardMoveStrengthPercent)
                    }.asPutDataRequest().setUrgent()
                    Tasks.await(dataClient.putDataItem(request))
                } catch (error: Exception) {
                    Log.w(VESC_SESSION_TAG, "Watch settings push failed", error)
                    record("watch_settings_push_failed", mapOf("error" to error.message))
                    if (settings == pushed) pushed = null
                }
            }
        }
    }
}
