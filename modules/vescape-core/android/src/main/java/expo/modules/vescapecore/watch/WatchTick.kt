package expo.modules.vescapecore.watch

import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

internal class WatchTick(
    private val scheduler: Scheduler,
    private val snapshot: () -> WatchSnapshot,
    private val isStale: () -> Boolean,
    private val canPush: () -> Boolean,
    private val push: (ByteArray) -> Unit,
    intervalMs: Long,
) {
    private var handle: Cancellable? = null
    private var running = false
    private var generation = 0L
    private var intervalMs: Long = intervalMs

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

    fun setIntervalMs(intervalMs: Long) {
        if (intervalMs == this.intervalMs) return
        this.intervalMs = intervalMs
        if (running) {
            generation++
            handle?.cancel()
            handle = null
            schedule()
        }
    }

    private fun schedule() {
        val currentGeneration = generation
        handle = scheduler.postDelayed(intervalMs) {
            if (!running || generation != currentGeneration) return@postDelayed
            if (canPush()) {
                val snap = snapshot()
                val frame = WatchFrameBuilder.build(snap, isStale())
                push(WatchFrameBuilder.encode(frame))
            }
            if (running && generation == currentGeneration) schedule()
        }
    }
}
