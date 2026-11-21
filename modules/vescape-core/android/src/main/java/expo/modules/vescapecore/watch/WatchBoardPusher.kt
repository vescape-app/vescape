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

internal class WatchBoardPusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    private val writes = Mutex()

    @Volatile
    private var pushed: WatchBoard? = null

    fun push(board: WatchBoard) {
        if (board == pushed) return
        pushed = board
        scope.launch {
            writes.withLock {
                if (board != pushed) return@withLock
                try {
                    val request = PutDataMapRequest.create(WATCH_BOARD_PATH).apply {
                        board.lightsEnabled?.let {
                            dataMap.putBoolean(WATCH_BOARD_LIGHTS_ENABLED, it)
                        }
                        board.headlightsEnabled?.let {
                            dataMap.putBoolean(WATCH_BOARD_HEADLIGHTS_ENABLED, it)
                        }
                        dataMap.putBoolean(WATCH_BOARD_LIGHTS_CONTROLLABLE, board.lightsControllable)
                    }.asPutDataRequest().setUrgent()
                    Tasks.await(dataClient.putDataItem(request))
                } catch (error: Exception) {
                    Log.w(VESC_SESSION_TAG, "Watch board push failed", error)
                    record("watch_board_push_failed", mapOf("error" to error.message))
                    if (board == pushed) pushed = null
                }
            }
        }
    }
}
