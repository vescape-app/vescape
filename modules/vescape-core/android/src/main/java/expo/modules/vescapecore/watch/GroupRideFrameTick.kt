package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/**
 * About once a second: Rider Presence itself moves no faster (ADR-0039).
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameTick.swift `GROUP_RIDE_FRAME_INTERVAL_MS`
 */
internal const val GROUP_RIDE_FRAME_INTERVAL_MS = 1_000L

/**
 * The Group Ride Frame's own 1 Hz tick, beside the Watch Frame's [WatchTick] rather than inside it:
 * the two streams have their own sources and cadences (ADR-0039).
 *
 * It pushes only while all three hold: the Watch Frame could be pushed at all ([canPushWatchFrame]),
 * the wrist says it is awake and not in ambient, and the Rider is joined ([frame] non-null). A wrist
 * that never reports its wake level is too old to know this path, so it gets nothing.
 *
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameTick.swift `GroupRideFrameTick`
 */
internal class GroupRideFrameTick(
    private val scheduler: Scheduler,
    private val canPushWatchFrame: () -> Boolean,
    private val wakeLevel: () -> WatchMirrorWakeLevel,
    private val frame: () -> GroupRideFrame?,
    private val push: (ByteArray) -> Unit,
) {
    private var handle: Cancellable? = null

    fun start() {
        if (handle == null) schedule()
    }

    fun stop() {
        handle?.cancel()
        handle = null
    }

    private fun schedule() {
        handle = scheduler.postDelayed(GROUP_RIDE_FRAME_INTERVAL_MS) {
            if (wakeLevel() == WatchMirrorWakeLevel.ACTIVE && canPushWatchFrame()) {
                frame()?.let { push(GroupRideFrameCodec.encode(it)) }
            }
            schedule()
        }
    }
}
