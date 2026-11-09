package expo.modules.vescapecore.notices

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide owner of the Ride Notice table. Process-level rather than on the Board Session, so a
 * notice outlives the foreground service and has one owner for every surface (JS card, watch,
 * ride notification). All mutations run on the main looper; expiry is scheduled for the earliest
 * `expiresAt`.
 *
 * Sources call [post] / [clear]; surfaces call [dismiss] and observe the ordered list with
 * [addListener], which fires only when the visible list changes.
 *
 * @parity /modules/vescape-core/ios/notices/RideNotices.swift `RideNotices`
 */
object RideNotices {
    private const val TAG = "RideNotices"

    private val handler = Handler(Looper.getMainLooper())
    private val engine = RideNoticeEngine()
    private val listeners = CopyOnWriteArrayList<(List<RideNotice>) -> Unit>()
    private val expiryTick = Runnable { mutate { engine.tick(System.currentTimeMillis()) } }

    /** The visible notices, most urgent first. Safe to read from any thread. */
    @Volatile
    var current: List<RideNotice> = emptyList()
        private set

    fun post(key: String, content: RideNoticeContent, revision: String) = mutate {
        when (engine.post(key, content, revision, System.currentTimeMillis())) {
            RideNoticeEngine.PostResult.CHANGED -> true
            RideNoticeEngine.PostResult.UNCHANGED -> false
            RideNoticeEngine.PostResult.DROPPED -> {
                Log.w(TAG, "Dropped Ride Notice $key: all ${RideNoticeEngine.MAX_ID} ids are active")
                false
            }
        }
    }

    fun clear(key: String) = mutate { engine.clear(key) }

    fun dismiss(id: Int) = mutate { engine.dismiss(id) }

    /** Listen for the ordered visible list. Returns the unsubscribe. */
    fun addListener(listener: (List<RideNotice>) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    private fun mutate(block: () -> Boolean) {
        handler.post {
            val changed = block()
            scheduleExpiry()
            if (!changed) return@post
            val notices = engine.active
            current = notices
            listeners.forEach { it(notices) }
        }
    }

    private fun scheduleExpiry() {
        handler.removeCallbacks(expiryTick)
        val next = engine.nextExpiryAt() ?: return
        handler.postDelayed(expiryTick, (next - System.currentTimeMillis()).coerceAtLeast(0))
    }
}
