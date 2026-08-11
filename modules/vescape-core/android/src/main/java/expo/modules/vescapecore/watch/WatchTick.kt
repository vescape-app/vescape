package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/**
 * Dedicated watch tick (ADR-0013/0019): a service-scoped scheduler, independent of the board
 * session and poll rate, that reads the latest cold-path [WatchSnapshot] and pushes an encoded
 * Watch Frame at a configurable cadence (`wearMirrorIntervalMs` App Setting). Board lanes may be
 * empty while GPS/navigation lanes stay live.
 *
 * Capability-gated: [canPush] is a cached flag ([WatchMirrorPresence]) checked before building the
 * frame, so when no Mirror is reachable the tick keeps spinning but skips both encode and send.
 */
internal class WatchTick(
    private val scheduler: Scheduler,
    private val snapshot: () -> WatchSnapshot,
    private val isStale: () -> Boolean,
    private val canPush: () -> Boolean,
    private val push: (ByteArray) -> Unit,
    intervalMs: Long,
) {
    private var handle: Cancellable? = null
    private var intervalMs: Long = intervalMs

    fun start() {
        if (handle == null) schedule()
    }

    fun stop() {
        handle?.cancel()
        handle = null
    }

    /**
     * Live-update the push cadence. Re-arms the active tick (cancel + reschedule) so a lowered
     * interval takes effect immediately instead of waiting out the current, possibly longer, delay.
     */
    fun setIntervalMs(intervalMs: Long) {
        if (intervalMs == this.intervalMs) return
        this.intervalMs = intervalMs
        if (handle != null) {
            handle?.cancel()
            handle = null
            schedule()
        }
    }

    private fun schedule() {
        handle = scheduler.postDelayed(intervalMs) {
            if (canPush()) {
                val snap = snapshot()
                val frame = WatchFrameBuilder.build(snap, isStale())
                push(WatchFrameBuilder.encode(frame))
            }
            schedule()
        }
    }
}
