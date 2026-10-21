package expo.modules.vescapecore.runtime

// @parity /modules/vescape-core/ios/runtime/Scheduler.swift `TestScheduler`

class TestScheduler : Scheduler {
    private data class Task(
        val dueAt: Long,
        val seq: Long,
        val block: () -> Unit,
        var cancelled: Boolean = false,
    )

    private val tasks = ArrayList<Task>()
    private var seqCounter = 0L
    private var now = 0L

    val currentTimeMs: Long get() = now
    val pendingCount: Int get() = tasks.count { !it.cancelled }

    override fun post(block: () -> Unit): Cancellable = postDelayed(0L, block)

    override fun postDelayed(delayMs: Long, block: () -> Unit): Cancellable {
        val task = Task(dueAt = now + delayMs, seq = seqCounter++, block = block)
        tasks.add(task)
        return Cancellable { task.cancelled = true }
    }

    fun advance(ms: Long) {
        val target = now + ms
        while (true) {
            tasks.removeAll { it.cancelled }
            val next = tasks
                .filter { it.dueAt <= target }
                .minWithOrNull(compareBy({ it.dueAt }, { it.seq })) ?: break
            tasks.remove(next)
            now = next.dueAt
            next.block()
        }
        now = target
    }

    fun runPending() {
        while (true) {
            tasks.removeAll { it.cancelled }
            val next = tasks.minWithOrNull(compareBy({ it.dueAt }, { it.seq })) ?: break
            tasks.remove(next)
            now = next.dueAt
            next.block()
        }
    }
}
