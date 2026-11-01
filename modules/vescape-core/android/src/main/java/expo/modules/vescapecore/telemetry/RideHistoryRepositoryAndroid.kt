package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.useReaderConnection
import androidx.room.deferredTransaction
import expo.modules.vescapecore.database.VescapeDatabase

/** Android lifecycle adapter around the host-testable production Ride History query. */
internal class RideHistoryRepository private constructor(private val context: Context) {
  private val database = VescapeDatabase.get(context)

  /** @parity /modules/vescape-core/src/index.ts `RideHistoryPage` */
  suspend fun getPage(options: Map<String, Any?>): Map<String, Any?> {
    val gapMs = gapMs()
    return database.useReaderConnection { reader ->
      reader.deferredTransaction {
        readRideHistoryPage(database.vescapeDao(), options, gapMs)
      }
    }
  }

  suspend fun countRides(options: Map<String, Any?>): Int {
    val gapMs = gapMs()
    return database.useReaderConnection { reader ->
      reader.deferredTransaction { countRideHistory(database.vescapeDao(), options, gapMs) }
    }
  }

  suspend fun selectedRides(selection: Map<String, Any?>): List<RideBatch.Item> {
    val gapMs = gapMs()
    return database.useReaderConnection { reader ->
      reader.deferredTransaction { selectedRides(database.vescapeDao(), selection, gapMs) }
    }
  }

  suspend fun getSession(id: String): Map<String, Any?>? {
    val gapMs = gapMs()
    return database.useReaderConnection { reader ->
      reader.deferredTransaction { readRideSession(database.vescapeDao(), id, gapMs) }
    }
  }

  private suspend fun gapMs(): Long {
    val minutes = AppDataRepository.get(context).getSettings()["rideSplitGapMinutes"] as? Number
    return (minutes?.toLong() ?: DEFAULT_RIDE_SPLIT_GAP_MINUTES.toLong()) * 60_000L
  }

  companion object {
    @Volatile private var instance: RideHistoryRepository? = null

    fun get(context: Context): RideHistoryRepository = instance ?: synchronized(this) {
      instance ?: RideHistoryRepository(context.applicationContext).also { instance = it }
    }

    fun resetForDatabaseSwap() = synchronized(this) { instance = null }
  }
}
