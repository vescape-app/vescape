package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.useReaderConnection
import androidx.room.deferredTransaction
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.database.VescapeDatabase

/** Android lifecycle adapter around the host-testable production Profile stats query. */
class ProfileStatsRepository private constructor(private val context: Context) {
  private val database = VescapeDatabase.get(context)

  /** @parity /modules/vescape-core/src/index.ts `ProfileStatsSnapshot` */
  suspend fun getProfileStatsSnapshot(options: Map<String, Any?>): Map<String, Any?> =
    read { dao, gapMs -> readProfileStatsSnapshot(dao, options, gapMs) }

  /** @parity /modules/vescape-core/src/index.ts `getDayStats` */
  suspend fun getDayStats(options: Map<String, Any?>): Map<String, Any?> =
    read { dao, gapMs -> readProfileDayStats(dao, options, gapMs) }

  private suspend fun read(block: suspend (VescapeDao, Long) -> Map<String, Any?>): Map<String, Any?> {
    val minutes = AppDataRepository.get(context).getSettings()["rideSplitGapMinutes"] as? Number
    val gapMs = (minutes?.toLong() ?: DEFAULT_RIDE_SPLIT_GAP_MINUTES.toLong()) * 60_000L
    return database.useReaderConnection { reader ->
      reader.deferredTransaction { block(database.vescapeDao(), gapMs) }
    }
  }

  companion object {
    @Volatile private var instance: ProfileStatsRepository? = null
    fun get(context: Context): ProfileStatsRepository = instance ?: synchronized(this) {
      instance ?: ProfileStatsRepository(context.applicationContext).also { instance = it }
    }
    fun resetForDatabaseSwap() = synchronized(this) { instance = null }
  }
}
