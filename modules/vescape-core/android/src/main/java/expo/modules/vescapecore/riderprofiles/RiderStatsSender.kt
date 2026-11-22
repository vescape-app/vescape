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

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderStatsSender.swift
 */
class RiderStatsSender private constructor(private val context: Context) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val sends = Mutex()
  private val store = DeviceCredentialStore(context)
  private val preferences = context.getSharedPreferences("vescape_rider_stats", Context.MODE_PRIVATE)
  private val policy = RiderStatsUploadPolicy(
    isBackfilled = { preferences.getBoolean("backfilled:$it", false) },
    markBackfilled = { preferences.edit().putBoolean("backfilled:$it", true).apply() },
    lastForeground = { preferences.getLong("foreground:$it", 0) },
    markForeground = { account, now -> preferences.edit().putLong("foreground:$account", now).apply() },
    initialAccountId = store.read()?.accountId,
  )

  init {
    DeviceCredentialStore.addChangeListener {
      if (policy.accountChanged(store.read()?.accountId)) trigger(foreground = false)
    }
  }

  fun foreground() = trigger(foreground = true)

  fun recordingEnded(boardId: String, sinceMs: Long) = trigger(
    foreground = false, recording = Triple(boardId, sinceMs, System.currentTimeMillis()),
  )

  private fun trigger(foreground: Boolean, recording: Triple<String, Long, Long>? = null) {
    scope.launch {
      sends.withLock {
        try { send(foreground, recording) }
        catch (error: CancellationException) { throw error }
        catch (error: Exception) {
          UnexpectedNativeError.report("rider_stats_send", "monthly_stats", error)
        }
      }
    }
  }

  private suspend fun send(foreground: Boolean, recording: Triple<String, Long, Long>?) {
    val credential = store.read() ?: return
    val origin = AppStatusCoordinator.serverBaseUrl(context)
    if (credential.serverUrl.trimEnd('/') != origin || AppStatusCoordinator.get(context).onlineBlocked) return
    val account = "$origin/${credential.accountId}"
    val backfill = policy.needsBackfill(account)
    if (!policy.begin(account, foreground, System.currentTimeMillis())) return
    val repository = ProfileStatsRepository.get(context)
    val rideMonths = recording?.let { (board, since, through) ->
      repository.getRecordingMonths(board, since, through).map { YearMonth.of(it.year, it.month) }.toSet()
    } ?: emptySet()
    val available = if (backfill) {
      @Suppress("UNCHECKED_CAST")
      val months = repository.getProfileStatsSnapshot(emptyMap())["months"] as List<Map<String, Number>>
      months.map { YearMonth.of(it.getValue("year").toInt(), it.getValue("month").toInt()) }.toSet()
    } else emptySet()
    val months = policy.months(YearMonth.now(), foreground, rideMonths, if (backfill) available else null)
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
      val payload = normalizedRiderStats(stats)
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
    if (backfill) policy.finished(account, complete)
  }

  companion object {
    /** @parity /modules/vescape-core/src/index.ts `RiderStats` */
    internal val FIELDS = listOf("distanceM", "rideCount", "rideTimeMs", "topSpeedKmh", "avgSpeedKmh", "longestRideM", "batteryUsedWh", "batteryRegenWh")
    @Volatile private var instance: RiderStatsSender? = null
    fun get(context: Context): RiderStatsSender = instance ?: synchronized(this) {
      instance ?: RiderStatsSender(context.applicationContext).also { instance = it }
    }
  }
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderStatsSender.swift `RiderStatsUploadPolicy`
 */
internal class RiderStatsUploadPolicy(
  private val isBackfilled: (String) -> Boolean,
  private val markBackfilled: (String) -> Unit,
  private val lastForeground: (String) -> Long,
  private val markForeground: (String, Long) -> Unit,
  initialAccountId: String? = null,
) {
  private var accountId = initialAccountId
  @Synchronized fun accountChanged(next: String?): Boolean {
    if (accountId == next) return false
    accountId = next
    return next != null
  }
  fun needsBackfill(account: String) = !isBackfilled(account)
  fun begin(account: String, foreground: Boolean, now: Long): Boolean {
    val last = lastForeground(account)
    if (foreground && !needsBackfill(account) && now >= last && now - last < 3_600_000L) return false
    if (foreground) markForeground(account, now)
    return true
  }
  fun months(current: YearMonth, foreground: Boolean, rideMonths: Set<YearMonth>, backfill: Set<YearMonth>?): Set<YearMonth> =
    if (backfill != null) backfill
    else if (foreground) setOf(current, current.minusMonths(1)) else rideMonths
  fun finished(account: String, complete: Boolean) { if (complete) markBackfilled(account) }
}

/**
 * @parity /modules/vescape-core/ios/riderprofiles/RiderStatsSender.swift `normalizedRiderStats`
 */
internal fun normalizedRiderStats(stats: Map<String, Any?>): JSONObject = JSONObject().also { payload ->
  RiderStatsSender.FIELDS.forEach { field ->
    val nullable = field in setOf("distanceM", "longestRideM", "batteryUsedWh", "batteryRegenWh")
    val number = (stats[field] as? Number)?.toDouble()?.takeIf { it.isFinite() }
    val max = when (field) {
      "rideCount" -> 100_000.0
      "rideTimeMs" -> 2_678_400_000.0
      "topSpeedKmh", "avgSpeedKmh" -> 1000.0
      else -> 1e8
    }
    val bounded = number?.coerceIn(0.0, max)
    payload.put(field, when {
      bounded == null -> if (nullable) JSONObject.NULL else 0
      field == "rideCount" || field == "rideTimeMs" -> kotlin.math.floor(bounded + 0.5).toLong()
      else -> bounded
    })
  }
}
