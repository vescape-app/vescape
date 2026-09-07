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
 * Phone -> Wear OS forecast transport. Pushed whenever the forecast changes, which is at most once
 * per [expo.modules.vescapecore.weather.WeatherCoordinator.FORECAST_TTL_MS] — not per tick.
 *
 * Shaped like [WatchSettingsPusher] and for the same reasons: the Data Layer is last-value-wins per
 * path, so concurrent writes are serialized, and a failed write clears the cache so the next push
 * retries rather than assuming the wrist has data it never received.
 */
internal class WatchWeatherPusher(
    private val context: Context,
    private val scope: CoroutineScope,
    private val record: (String, Map<String, Any?>) -> Unit,
) {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    private val writes = Mutex()

    /** Last forecast known to be on the wrist; cleared on failure so the next push retries. */
    @Volatile
    private var pushed: WatchWeather? = null

    fun push(weather: WatchWeather) {
        if (weather == pushed) return
        pushed = weather
        scope.launch {
            writes.withLock {
                // A forecast already superseded by a newer one is not worth a round trip.
                if (weather != pushed) return@withLock
                try {
                    val request = PutDataMapRequest.create(WATCH_WEATHER_PATH).apply {
                        dataMap.putInt(WATCH_WEATHER_TEMP_C, weather.temperatureC)
                        dataMap.putString(WATCH_WEATHER_ICON, weather.icon)
                        dataMap.putString(WATCH_WEATHER_LABEL, weather.label)
                        dataMap.putInt(WATCH_WEATHER_PRECIP, weather.precipitationProbability)
                        dataMap.putIntegerArrayList(
                            WATCH_WEATHER_HOUR_MINUTES,
                            ArrayList(weather.hourMinutes.toList()),
                        )
                        dataMap.putIntegerArrayList(
                            WATCH_WEATHER_HOUR_TEMPS,
                            ArrayList(weather.hourTemps.toList()),
                        )
                        dataMap.putStringArray(WATCH_WEATHER_HOUR_ICONS, weather.hourIcons.toTypedArray())
                        dataMap.putIntegerArrayList(
                            WATCH_WEATHER_HOUR_PRECIPS,
                            ArrayList(weather.hourPrecips.toList()),
                        )
                        // Omitted rather than sent as a sentinel: the wrist reads absence directly.
                        weather.sunriseMinuteOfDay?.let { dataMap.putInt(WATCH_WEATHER_SUNRISE, it) }
                        weather.sunsetMinuteOfDay?.let { dataMap.putInt(WATCH_WEATHER_SUNSET, it) }
                        dataMap.putDouble(WATCH_WEATHER_LATITUDE, weather.latitude)
                        dataMap.putDouble(WATCH_WEATHER_LONGITUDE, weather.longitude)
                        dataMap.putLong(WATCH_WEATHER_FETCHED_AT, weather.fetchedAtMs)
                    }.asPutDataRequest().setUrgent()
                    Tasks.await(dataClient.putDataItem(request))
                } catch (error: Exception) {
                    Log.w(VESC_SESSION_TAG, "Watch weather push failed", error)
                    record("watch_weather_push_failed", mapOf("error" to error.message))
                    if (weather == pushed) pushed = null
                }
            }
        }
    }
}
