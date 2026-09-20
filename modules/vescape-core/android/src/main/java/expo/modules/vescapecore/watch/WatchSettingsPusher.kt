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
 * Phone -> Wear OS settings transport. Pushed whenever the applied settings change, which is every
 * settings write the service reloads for — not per tick.
 *
 * A process-scoped publisher handles both service settings and writes made with no service.
 * The Data Layer retains the latest payload while the watch is disconnected.
 *
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
                            dataMap.putString(WATCH_SETTING_RIDER_COLOR, settings.riderColor ?: "")
                            dataMap.putInt(WATCH_SETTING_BOARD_MOVE_STRENGTH, settings.boardMoveStrengthPercent)
                            dataMap.putBoolean(WATCH_SETTING_NAV_ARROW, settings.navArrowEnabled)
                            dataMap.putString(WATCH_SETTING_UNIT_SYSTEM, settings.unitSystem)
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

    /**
     * Serializes writes. The Data Layer is last-value-wins per path, so two writes in flight can
     * land in either order and leave the wrist holding the settings the rider just replaced.
     */
    private val writes = Mutex()

    /** Last settings known to be on the wrist; cleared on failure so the next push retries. */
    @Volatile
    private var pushed: WatchSettings? = null

    fun push(settings: WatchSettings) {
        if (settings == pushed) return
        pushed = settings
        scope.launch {
            writes.withLock {
                // A value the rider has already replaced is not worth a round trip to the watch.
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
