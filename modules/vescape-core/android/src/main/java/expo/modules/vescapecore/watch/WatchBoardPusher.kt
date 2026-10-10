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
 * Phone -> Wear OS board state transport. Pushed wherever the Board Session's lights change: the
 * board's echo, the config-derived seed, and session teardown, which clears them back to unknown.
 *
 * Shaped like [WatchWeatherPusher] and for the same reasons: the Data Layer is last-value-wins per
 * path, so concurrent writes are serialized, and a failed write clears the cache so the next push
 * retries rather than assuming the wrist has state it never received.
 */
internal class WatchBoardPusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    private val writes = Mutex()

    /** Last board state known to be on the wrist; cleared on failure so the next push retries. */
    @Volatile
    private var pushed: WatchBoard? = null

    fun push(board: WatchBoard) {
        if (board == pushed) return
        pushed = board
        scope.launch {
            writes.withLock {
                // A state already superseded by a newer one is not worth a round trip.
                if (board != pushed) return@withLock
                try {
                    val request = PutDataMapRequest.create(WATCH_BOARD_PATH).apply {
                        // Omitted rather than sent as a sentinel: absence is how the wrist reads
                        // "the board has never said", and false would render off as fact.
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
