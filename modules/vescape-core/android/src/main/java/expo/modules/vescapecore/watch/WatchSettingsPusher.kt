package expo.modules.vescapecore.watch

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * @parity /modules/vescape-core/ios/watch/WatchColdState.swift
 */
internal class WatchSettingsPusher(
    private val write: (WatchSettings) -> Unit,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    companion object {
        @Volatile private var instance: WatchSettingsPusher? = null

        fun get(context: Context, scope: CoroutineScope): WatchSettingsPusher =
            instance ?: synchronized(this) {
                val appContext = context.applicationContext
                instance ?: WatchSettingsPusher(
                    write = { settings ->
                        val request = PutDataMapRequest.create(WATCH_SETTINGS_PATH).apply {
                            dataMap.putInt(WATCH_SETTING_BOARD_MOVE_STRENGTH, settings.boardMoveStrengthPercent)
                            dataMap.putBoolean(WATCH_SETTING_NAV_ARROW, settings.navArrowEnabled)
                            dataMap.putBoolean(WATCH_SETTING_TELEMETRY_TRAIL, settings.telemetryTrailEnabled)
                            dataMap.putBoolean(WATCH_SETTING_TELEMETRY_GROUP, settings.telemetryGroupEnabled)
                            dataMap.putBoolean(WATCH_SETTING_TELEMETRY_ROUTE, settings.telemetryRouteEnabled)
                            dataMap.putBoolean(WATCH_SETTING_STREET_MAP, settings.streetMapEnabled)
                            dataMap.putInt(WATCH_SETTING_MAP_GAUGES, settings.mapGaugesPercent)
                            dataMap.putString(WATCH_SETTING_DISTANCE_UNIT, settings.distanceUnit)
                            dataMap.putString(WATCH_SETTING_TIME_FORMAT, settings.timeFormat)
                            dataMap.putInt(WATCH_SETTING_TILT_RATE, settings.tiltRatePercent)
                        }.asPutDataRequest().setUrgent()
                        Tasks.await(Wearable.getDataClient(appContext).putDataItem(request))
                    },
                    scope = scope,
                    record = { name, properties ->
                        Log.w(VESC_SESSION_TAG, "$name: $properties")
                        expo.modules.vescapecore.diagnostics.DiagnosticReporter.get(appContext)
                            .capture(name, properties + ("operation" to "watch"))
                    },
                ).also { instance = it }
            }
    }

    private val writes = Mutex()

    @Volatile
    private var pushed: WatchSettings? = null

    fun push(settings: WatchSettings) {
        if (settings == pushed) return
        pushed = settings
        scope.launch {
            writes.withLock {
                if (settings != pushed) return@withLock
                try {
                    write(settings)
                } catch (error: Exception) {
                    record("watch_settings_push_failed", mapOf("error" to error.message))
                    if (settings == pushed) pushed = null
                }
            }
        }
    }
}
