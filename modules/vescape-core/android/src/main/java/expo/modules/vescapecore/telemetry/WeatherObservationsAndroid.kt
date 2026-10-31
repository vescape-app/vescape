package expo.modules.vescapecore.telemetry

import android.content.Context
import expo.modules.vescapecore.database.VescapeDatabase

@Volatile private var processRecorder: WeatherObservationRecorder? = null

/**
 * The process's one observation writer. Resolves the DAO per write, so a restored database is the
 * one written after the fence.
 */
internal fun weatherObservationRecorder(context: Context): WeatherObservationRecorder =
  processRecorder ?: synchronized(WeatherObservationRecorder::class) {
    processRecorder ?: WeatherObservationRecorder({ VescapeDatabase.get(context.applicationContext).vescapeDao() })
      .also { processRecorder = it }
  }
