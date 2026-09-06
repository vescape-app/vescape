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

private const val TAG = "WeatherCoordinator"

/** One forecast fetch attempt. `null` body means "no usable response" (transport or HTTP error). */
fun interface WeatherTransport {
    fun fetch(url: String, onResult: (String?) -> Unit)
}

/**
 * Process-owned weather truth. Every GPS Fix offers the coordinator a position; it refetches only
 * when the rider has moved far enough or the forecast has aged out, and keeps the last **successful**
 * result for the life of the process.
 *
 * It lives native rather than in JS because the two consumers that matter outlive the JS runtime:
 * the wrist mirror keeps rendering through a backgrounded phone, and Weather Alerts (a later slice)
 * have to fire while nobody is looking at a screen.
 *
 * Failure semantics match App Status: a failed refresh never clears a known forecast, and nothing is
 * persisted, so a fresh process starts empty.
 *
 * Main-thread affine: GPS Fixes arrive on the main looper and the transport posts its result back
 * there before touching state.
 *
 * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift
 */
class WeatherCoordinator internal constructor(
    private val transport: WeatherTransport,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    /** Last successful forecast for this process, or `null` while none has landed. */
    @Volatile
    var current: Weather? = null
        private set

    private val listeners = CopyOnWriteArrayList<(Weather?) -> Unit>()

    private var fetching = false

    /**
     * Where the rider was when a Fix arrived mid-fetch. A ride moves during the seconds a request
     * takes, and dropping those Fixes outright would leave the forecast pinned to wherever the ride
     * started if GPS then stops. Re-evaluated once the in-flight request lands.
     */
    private var pendingPosition: Pair<Double, Double>? = null

    /** Register a change listener (the JS mirror and the wrist pusher); returns a remover. */
    fun addChangeListener(listener: (Weather?) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    /**
     * Offer the rider's current position. Cheap to call per GPS Fix: it refetches only when nothing
     * is known yet, when the forecast has aged past [FORECAST_TTL_MS], or when the rider has left
     * the area the current forecast was fetched for.
     */
    fun onPosition(latitude: Double, longitude: Double) {
        if (!latitude.isFinite() || !longitude.isFinite()) return
        val known = current
        val stale = known == null ||
            nowMs() - known.fetchedAtMs >= FORECAST_TTL_MS ||
            kotlin.math.abs(known.latitude - latitude) >= REFETCH_DELTA_DEG ||
            kotlin.math.abs(known.longitude - longitude) >= REFETCH_DELTA_DEG
        if (!stale) return
        refresh(latitude, longitude)
    }

    /**
     * Refetch where the last forecast was fetched, ignoring the freshness gate — the rider asking
     * for fresh weather. A no-op before the first fetch: there is no position to ask about, and the
     * next GPS Fix will bring one.
     */
    fun refresh() {
        val known = current ?: return
        refresh(known.latitude, known.longitude)
    }

    /**
     * Fetch now for an explicit position, ignoring the freshness gate. A refresh asked for while one
     * is already in flight is dropped: the in-flight request answers it.
     */
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
        // Silent on failure by design: expected offline, and it must never clear a known forecast.
        val weather = body?.let { parseOpenMeteoWeather(it, latitude, longitude, nowMs()) }
        if (weather != null) {
            current = weather
            listeners.forEach { it(weather) }
        }
        // The ride moved while this request was in flight. Re-offer the newest position through the
        // normal gate, so it refetches only if it actually left the area this forecast describes.
        val pending = pendingPosition ?: return
        pendingPosition = null
        onPosition(pending.first, pending.second)
    }

    companion object {
        /**
         * How long a forecast stays good. Open-Meteo publishes hourly; ten minutes keeps the wrist
         * honest without spending a request per GPS Fix on a free API.
         * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `forecastTtlMs`
         */
        const val FORECAST_TTL_MS = 10 * 60 * 1_000L

        /**
         * How far the rider must move before the cached forecast stops describing where they are.
         * ~1.1 km at the equator — under a single Open-Meteo grid cell, so a shorter hop would
         * refetch the same numbers.
         * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `refetchDeltaDeg`
         */
        const val REFETCH_DELTA_DEG = 0.01

        /** Hours of forecast requested — one wrist page plus the phone's hourly strip. */
        const val FORECAST_HOURS = 12

        /**
         * Open-Meteo forecast endpoint. Public and keyless, which is why it is called directly
         * rather than through [expo.modules.vescapecore.api.VescapeApi].
         *
         * `timezone=auto` resolves the zone of the **forecast location**, which is what the hour
         * labels claim to be. The device zone would be a different thing the moment a rider crosses
         * a border or turns automatic time off.
         * @parity /modules/vescape-core/ios/weather/WeatherCoordinator.swift `forecastUrl`
         */
        fun forecastUrl(latitude: Double, longitude: Double): String =
            "https://api.open-meteo.com/v1/forecast" +
                "?latitude=$latitude&longitude=$longitude" +
                "&current=temperature_2m,weather_code,precipitation_probability" +
                "&hourly=temperature_2m,weather_code,precipitation_probability" +
                "&daily=sunrise,sunset" +
                "&forecast_hours=$FORECAST_HOURS&forecast_days=1" +
                "&timezone=auto"

        @Volatile
        private var instance: WeatherCoordinator? = null

        /** Process singleton — its in-memory forecast must outlive JS runtime reloads. */
        fun get(): WeatherCoordinator =
            instance ?: synchronized(this) {
                instance ?: WeatherCoordinator(
                    transport = OkHttpWeatherTransport(Handler(Looper.getMainLooper())),
                ).also { instance = it }
            }
    }
}

/** Default transport: one short-timeout GET, result handed back on the main thread. */
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
            override fun onFailure(call: Call, e: IOException) {
                Log.d(TAG, "Weather fetch failed: ${e.message}")
                handler.post { onResult(null) }
            }

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
