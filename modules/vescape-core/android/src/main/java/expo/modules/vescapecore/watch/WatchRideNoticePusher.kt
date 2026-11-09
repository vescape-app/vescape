package expo.modules.vescapecore.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.notices.RideNotice
import expo.modules.vescapecore.notices.RideNoticeSeverity
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Phone -> Wear OS Ride Notice transport: the full visible list as one retained Data Layer item at
 * [WATCH_RIDE_NOTICES_PATH], written urgent because "Rider down" cannot wait for the next batched
 * sync. Shaped like [WatchWeatherPusher]: serialized writes, and a failed write clears the cache so
 * the next push retries.
 *
 * The first push of a process always writes, so a list left on the wrist by a phone process that
 * died is replaced on the next start.
 *
 * @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift `pushRideNotices`
 */
internal class WatchRideNoticePusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    private val writes = Mutex()

    /** Last list known to be on the wrist; cleared on failure so the next push retries. */
    @Volatile
    private var pushed: List<RideNotice>? = null

    fun push(notices: List<RideNotice>) {
        if (notices == pushed) return
        pushed = notices
        scope.launch {
            writes.withLock {
                // A list already superseded by a newer one is not worth a round trip.
                if (notices != pushed) return@withLock
                try {
                    val bytes = RideNoticeFrameCodec.encode(notices.toRideNoticeFrame(System.currentTimeMillis()))
                    val request = PutDataRequest.create(WATCH_RIDE_NOTICES_PATH).setData(bytes).setUrgent()
                    Tasks.await(dataClient.putDataItem(request))
                } catch (error: Exception) {
                    Log.w(VESC_SESSION_TAG, "Watch ride notices push failed", error)
                    record("watch_ride_notices_push_failed", mapOf("error" to error.message))
                    if (notices == pushed) pushed = null
                }
            }
        }
    }
}

/**
 * The wrist's slice of the visible list: no key, location or post time, which the wrist never shows.
 *
 * @parity /modules/vescape-core/ios/watch/WatchTelemetryPusher.swift `rideNoticeFrame`
 */
internal fun List<RideNotice>.toRideNoticeFrame(sentAtMs: Long) = RideNoticeFrame(
    sentAtMs = sentAtMs,
    notices = map { notice ->
        RideNoticeFrameItem(
            id = notice.id,
            rev = notice.rev,
            severity = when (notice.content.severity) {
                RideNoticeSeverity.CRITICAL -> RideNoticeFrameSeverity.CRITICAL
                RideNoticeSeverity.WARNING -> RideNoticeFrameSeverity.WARNING
                RideNoticeSeverity.INFO -> RideNoticeFrameSeverity.INFO
            },
            title = notice.content.title,
            details = notice.content.details,
            expiresAtMs = notice.content.expiresAt,
        )
    },
)
