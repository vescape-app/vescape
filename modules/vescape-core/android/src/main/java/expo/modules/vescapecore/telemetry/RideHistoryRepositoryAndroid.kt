package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.withTransaction

/** Android lifecycle adapter around the host-testable production Ride History query. */
internal class RideHistoryRepository private constructor(private val context: Context) {
  private val database = TelemetryDatabase.get(context)

  /** @parity /modules/vescape-core/src/index.ts `RideHistoryPage` */
  suspend fun getPage(options: Map<String, Any?>): Map<String, Any?> {
    val minutes = AppDataRepository.get(context).getSettings()["rideSplitGapMinutes"] as? Number
    val gapMs = (minutes?.toLong() ?: DEFAULT_RIDE_SPLIT_GAP_MINUTES.toLong()) * 60_000L
    return database.withTransaction {
      readRideHistoryPage(database.telemetryDao(), options, gapMs)
    }
  }

  companion object {
    @Volatile private var instance: RideHistoryRepository? = null

    fun get(context: Context): RideHistoryRepository = instance ?: synchronized(this) {
      instance ?: RideHistoryRepository(context.applicationContext).also { instance = it }
    }

    fun resetForDatabaseSwap() = synchronized(this) { instance = null }
  }
}
