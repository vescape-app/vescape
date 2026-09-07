package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.withTransaction

/** Android lifecycle adapter around the host-testable production Profile stats query. */
class ProfileStatsRepository private constructor(private val context: Context) {
  private val database = TelemetryDatabase.get(context)

  /** @parity /modules/vescape-core/src/index.ts `ProfileStatsSnapshot` */
  suspend fun getProfileStatsSnapshot(options: Map<String, Any?>): Map<String, Any?> {
    val minutes = AppDataRepository.get(context).getSettings()["rideSplitGapMinutes"] as? Number
    val gapMs = (minutes?.toLong() ?: DEFAULT_RIDE_SPLIT_GAP_MINUTES.toLong()) * 60_000L
    return database.withTransaction {
      readProfileStatsSnapshot(database.telemetryDao(), options, gapMs)
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
