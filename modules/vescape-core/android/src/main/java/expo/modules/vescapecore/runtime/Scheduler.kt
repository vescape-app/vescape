package expo.modules.vescapecore.runtime

// @parity /modules/vescape-core/ios/runtime/Scheduler.swift `Cancellable`
fun interface Cancellable {
    fun cancel()
}

// @parity /modules/vescape-core/ios/runtime/Scheduler.swift `Scheduler`
interface Scheduler {
    fun post(block: () -> Unit): Cancellable
    fun postDelayed(delayMs: Long, block: () -> Unit): Cancellable
}
