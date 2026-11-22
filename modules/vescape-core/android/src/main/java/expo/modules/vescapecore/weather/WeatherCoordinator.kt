package expo.modules.vescapecore.weather

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import androidx.annotation.WorkerThread
import androidx.annotation.AnyThread
import androidx.annotation.MainThread

private const val TAG = "WeatherCoordinator"

fun interface WeatherTransport {
    fun fetch(url: String, onResult: (String?) -> Unit)
}

/**
 * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift
 */
@MainThread
class WeatherCoordinator internal constructor(
    private val transport: WeatherTransport,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    @get:AnyThread
    @Volatile
    var current: Weather? = null
        private set

    private val listeners = CopyOnWriteArrayList<(Weather?) -> Unit>()

    private var fetching = false

    private var pendingPosition: Pair<Double, Double>? = null

    private var lastPosition: Pair<Double, Double>? = null

    fun addChangeListener(listener: (Weather?) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun onPosition(latitude: Double, longitude: Double) {
        if (!latitude.isFinite() || !longitude.isFinite()) return
        lastPosition = latitude to longitude
        val known = current
        val stale = known == null ||
            nowMs() - known.fetchedAtMs >= FORECAST_TTL_MS ||
            kotlin.math.abs(known.latitude - latitude) >= REFETCH_DELTA_DEG ||
            kotlin.math.abs(known.longitude - longitude) >= REFETCH_DELTA_DEG
        if (!stale) return
        refresh(latitude, longitude)
    }

    /**
     * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `refresh`
     */
    fun refresh() {
        val (latitude, longitude) = lastPosition ?: return
        refresh(latitude, longitude)
    }

    fun refresh(latitude: Double, longitude: Double) {
        if (fetching) {
            pendingPosition = latitude to longitude
            return
        }
        fetching = true
        transport.fetch(forecastUrl(latitude, longitude)) { body ->
            onFetched(body, latitude, longitude)
        }
    }

    private fun onFetched(body: String?, latitude: Double, longitude: Double) {
        fetching = false
        val weather = body?.let { parseOpenMeteoWeather(it, latitude, longitude, nowMs()) }
        if (weather != null) {
            current = weather
            listeners.forEach { it(weather) }
        }
        val pending = pendingPosition ?: return
        pendingPosition = null
        onPosition(pending.first, pending.second)
    }

    companion object {
        /**
         * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `forecastTtlMs`
         */
        const val FORECAST_TTL_MS = 10 * 60 * 1_000L

        /**
         * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `refetchDeltaDeg`
         */
        const val REFETCH_DELTA_DEG = 0.01

        const val FORECAST_HOURS = 12

        const val FORECAST_QUARTER_HOURS = 12

        /**
         * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `forecastUrl`
         */
        fun forecastUrl(latitude: Double, longitude: Double): String =
            "https://api.open-meteo.com/v1/forecast" +
                "?latitude=$latitude&longitude=$longitude" +
                "&current=temperature_2m,weather_code,precipitation_probability,wind_gusts_10m,is_day" +
                "&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_gusts_10m" +
                "&minutely_15=precipitation,weather_code,wind_gusts_10m" +
                "&forecast_minutely_15=$FORECAST_QUARTER_HOURS" +
                "&daily=sunrise,sunset" +
                "&forecast_hours=$FORECAST_HOURS&forecast_days=1" +
                "&timezone=auto"

        @Volatile
        private var instance: WeatherCoordinator? = null

        @AnyThread

        fun get(): WeatherCoordinator =
            instance ?: synchronized(this) {
                instance ?: WeatherCoordinator(
                    transport = OkHttpWeatherTransport(Handler(Looper.getMainLooper())),
                ).also { instance = it }
            }
    }
}

internal class OkHttpWeatherTransport(private val handler: Handler) : WeatherTransport {
    private val client = OkHttpClient.Builder()
        .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    override fun fetch(url: String, onResult: (String?) -> Unit) {
        val request = try {
            Request.Builder().url(url).build()
        } catch (_: IllegalArgumentException) {
            handler.post { onResult(null) }
            return
        }
        client.newCall(request).enqueue(object : Callback {
            @WorkerThread
            override fun onFailure(call: Call, e: IOException) {
                Log.d(TAG, "Weather fetch failed: ${e.message}")
                handler.post { onResult(null) }
            }

            @WorkerThread
            override fun onResponse(call: Call, response: Response) {
                val body = response.use { if (it.isSuccessful) it.body?.string() else null }
                handler.post { onResult(body) }
            }
        })
    }

    private companion object {
        const val CALL_TIMEOUT_SECONDS = 10L
    }
}
