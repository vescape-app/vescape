package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/**
 * @parity /modules/vescape-core/ios/watch/GroupRideFrameTick.swift `GROUP_RIDE_FRAME_INTERVAL_MS`
 */
internal const val GROUP_RIDE_FRAME_INTERVAL_MS = 1_000L

/**
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
    private var running = false
    private var generation = 0L

    fun start() {
        if (running) return
        running = true
        generation++
        schedule()
    }

    fun stop() {
        running = false
        generation++
        handle?.cancel()
        handle = null
    }

    private fun schedule() {
        val currentGeneration = generation
        handle = scheduler.postDelayed(GROUP_RIDE_FRAME_INTERVAL_MS) {
            if (!running || generation != currentGeneration) return@postDelayed
            if (wakeLevel() == WatchMirrorWakeLevel.ACTIVE && canPushWatchFrame()) {
                frame()?.let { push(GroupRideFrameCodec.encode(it)) }
            }
            if (running && generation == currentGeneration) schedule()
        }
    }
}
