package expo.modules.vescapecore.database

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import androidx.annotation.AnyThread

/**
 * @parity /modules/vescape-core/ios/database/DatabaseReplacementFence.swift `DatabaseReplacementFence`
 */
@AnyThread
internal class DatabaseReplacementFence {
  private val mutex = Mutex()

  @Volatile private var generation = 0L

  fun ticket(): Long = generation

  suspend fun <T> write(ticket: Long, block: suspend () -> T): T? =
    mutex.withLock { if (ticket != generation) null else block() }

  suspend fun <T> fence(block: suspend () -> T): T = mutex.withLock {
    generation++
    block()
  }

  companion object {
    val process = DatabaseReplacementFence()
  }
}
