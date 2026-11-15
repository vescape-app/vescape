package expo.modules.vescapecore.riderprofiles

import android.content.Context
import expo.modules.vescapecore.api.ApiResult
import expo.modules.vescapecore.api.AuthMode
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.auth.DeviceCredentialStore
import expo.modules.vescapecore.diagnostics.UnexpectedNativeError
import expo.modules.vescapecore.telemetry.ProfileStatsRepository
import java.time.YearMonth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/** Native-owned monthly uploads. Failed months remain eligible on the next lifecycle trigger.
 * @parity /modules/vescape-core/ios/riderprofiles/RiderStatsSender.swift
 */
class RiderStatsSender private constructor(private val context: Context) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val sends = Mutex()
  private val store = DeviceCredentialStore(context)
  private val preferences = context.getSharedPreferences("vescape_rider_stats", Context.MODE_PRIVATE)
  private var backfilledAccount: String? = null

  init {
    DeviceCredentialStore.addChangeListener { trigger(history = true, foreground = false) }
  }

  fun foreground() = trigger(history = false, foreground = true)

  // Ride boundaries are derived from history. Checking its months also catches a continuing ride
  // that began before this Board Session, including a ride across a month boundary.
  fun recordingEnded() = trigger(history = true, foreground = false)

  private fun trigger(history: Boolean, foreground: Boolean) {
    scope.launch {
      sends.withLock {
        try { send(history, foreground) }
        catch (error: CancellationException) { throw error }
        catch (error: Exception) {
          UnexpectedNativeError.report("rider_stats_send", "monthly_stats", error)
        }
      }
    }
  }

  private suspend fun send(history: Boolean, foreground: Boolean) {
    if (history) backfilledAccount = null
    val credential = store.read()
    if (credential == null) { backfilledAccount = null; return }
    val origin = AppStatusCoordinator.serverBaseUrl(context)
    if (credential.serverUrl.trimEnd('/') != origin || AppStatusCoordinator.get(context).onlineBlocked) return
    val account = "$origin/${credential.accountId}"
    val backfill = backfilledAccount != account
    val now = System.currentTimeMillis()
    if (foreground && !history) {
      val last = preferences.getLong("foreground:$account", 0)
      if (now >= last && now - last < 3_600_000L) return
    }
    if (foreground) preferences.edit().putLong("foreground:$account", now).apply()
    backfilledAccount = null
    val repository = ProfileStatsRepository.get(context)
    val current = YearMonth.now()
    val months = linkedSetOf(current, current.minusMonths(1))
    if (history || backfill) {
      val snapshot = repository.getProfileStatsSnapshot(emptyMap())
      @Suppress("UNCHECKED_CAST")
      val available = snapshot["months"] as List<Map<String, Number>>
      available.forEach { months += YearMonth.of(it.getValue("year").toInt(), it.getValue("month").toInt()) }
    }
    // Pin this run to its credential: an account change must never upload A's payload as B.
    val api = VescapeApi(
      baseUrl = origin,
      appVersion = AppStatusCoordinator.get(context).appVersion,
      credentialProvider = { store.read()?.takeIf { it.accountId == credential.accountId && it.token == credential.token } },
      onUnauthorized = {
        if (store.read()?.token == credential.token) store.reject()
        AppStatusCoordinator.get(context).refresh()
      },
    )
    var complete = true
    for (month in months.sortedDescending()) {
      if (store.read()?.token != credential.token || AppStatusCoordinator.get(context).onlineBlocked) return
      val snapshot = repository.getProfileStatsSnapshot(mapOf("year" to month.year, "month" to month.monthValue))
      @Suppress("UNCHECKED_CAST")
      val stats = snapshot["monthly"] as Map<String, Any?>
      val payload = JSONObject()
      FIELDS.forEach { payload.put(it, stats[it] ?: JSONObject.NULL) }
      val key = "payload:$account/$month"
      val encoded = payload.toString()
      if (preferences.getString(key, null) == encoded) continue
      val result = api.request(HttpMethod.PUT, "/api/rider-stats/$month", body = payload, auth = AuthMode.Required) { }
      if (result is ApiResult.Ok && store.read()?.token == credential.token) {
        preferences.edit().putString(key, encoded).apply()
      } else {
        complete = false
      }
    }
    if (complete) backfilledAccount = account
  }

  companion object {
    /** @parity /modules/vescape-core/src/index.ts `RiderStats` */
    private val FIELDS = listOf("distanceM", "rideCount", "rideTimeMs", "topSpeedKmh", "avgSpeedKmh", "longestRideM", "batteryUsedWh", "batteryRegenWh")
    @Volatile private var instance: RiderStatsSender? = null
    fun get(context: Context): RiderStatsSender = instance ?: synchronized(this) {
      instance ?: RiderStatsSender(context.applicationContext).also { instance = it }
    }
  }
}
