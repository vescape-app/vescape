package expo.modules.vescapecore.runtime

import android.os.Handler

// @parity /modules/vescape-core/ios/runtime/Scheduler.swift `MainQueueScheduler`
class HandlerScheduler(private val handler: Handler) : Scheduler {
    override fun post(block: () -> Unit): Cancellable {
        val runnable = Runnable { block() }
        handler.post(runnable)
        return Cancellable { handler.removeCallbacks(runnable) }
    }

    override fun postDelayed(delayMs: Long, block: () -> Unit): Cancellable {
        val runnable = Runnable { block() }
        handler.postDelayed(runnable, delayMs)
        return Cancellable { handler.removeCallbacks(runnable) }
    }
}
