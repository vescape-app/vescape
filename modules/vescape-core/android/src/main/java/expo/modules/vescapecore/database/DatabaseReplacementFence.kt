package expo.modules.vescapecore.database

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Serializes background database writers against Restore and Clear all. A writer takes a [ticket]
 * when its work starts; a fence bumps the generation, so a write whose ticket predates a restore or
 * a clear is dropped instead of reaching the replacement database. Weather Observation writes and
 * every Maintenance Job chunk go through it, so a fence waits for at most one in-flight write.
 * @parity /modules/vescape-core/ios/database/DatabaseReplacementFence.swift `DatabaseReplacementFence`
 */
internal class DatabaseReplacementFence {
  private val mutex = Mutex()

  @Volatile private var generation = 0L

  fun ticket(): Long = generation

  /** Run [block] only if nothing fenced since [ticket]; null when the write was fenced off. */
  suspend fun <T> write(ticket: Long, block: suspend () -> T): T? =
    mutex.withLock { if (ticket != generation) null else block() }

  suspend fun <T> fence(block: suspend () -> T): T = mutex.withLock {
    generation++
    block()
  }

  companion object {
    /** The one fence every production writer, Restore and Clear all share. */
    val process = DatabaseReplacementFence()
  }
}
