package expo.modules.vescapecore.telemetry

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject
import expo.modules.vescapecore.database.AppSettingEntity
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeDao

/**
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceJob`
 */
internal interface MaintenanceJob {
  val id: String
  val version: Int
  val requiresNetwork: Boolean
  val inputKeys: Set<String>

  fun inputs(settings: AppSettings): String

  suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome

  suspend fun hasWork(scope: MaintenanceJobScope, settings: AppSettings): Boolean =
    scope.chunk { it.storedMaintenanceFingerprint(id) } != fingerprint(settings)

  suspend fun begin(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.deleteAppSetting(maintenanceJobKey(id)) }
  }

  suspend fun complete(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.publishMaintenanceFingerprint(id, fingerprint(settings), scope.nowMs()) }
  }
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceJobOutcome` */
internal sealed class MaintenanceJobOutcome {
  data object Completed : MaintenanceJobOutcome()
  data class Deferred(val retryAtMs: Long) : MaintenanceJobOutcome()
}

internal class MaintenanceRunFenced : Exception("Database replaced during maintenance")

/**
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceHttpResponse`
 */
internal data class MaintenanceHttpResponse(val status: Int, val body: String?, val retryAfterSeconds: Long?)

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceHttp` */
internal fun interface MaintenanceHttp {
  suspend fun get(url: String): MaintenanceHttpResponse
}

/**
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceJobScope`
 */
internal class MaintenanceJobScope(
  private val dao: () -> VescapeDao,
  private val fence: DatabaseReplacementFence,
  val ticket: Long,
  val nowMs: () -> Long = System::currentTimeMillis,
  val progress: (done: Int, total: Int) -> Unit = { _, _ -> },
  val committed: () -> Unit = {},
  val sealFailure: (TelemetryMinuteKey, Exception) -> Unit = { _, _ -> },
  val diagnostic: (String, Map<String, Any?>) -> Unit = { _, _ -> },
  val http: MaintenanceHttp = MaintenanceHttp { throw java.io.IOException("No network transport") },
) {
  suspend fun <T> chunk(block: suspend (VescapeDao) -> T): T {
    currentCoroutineContext().ensureActive()
    val box = fence.write(ticket) { listOf(block(dao())) } ?: throw MaintenanceRunFenced()
    return box.single()
  }
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceFingerprint` */
internal fun MaintenanceJob.fingerprint(settings: AppSettings): String = "$version|${inputs(settings)}"

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceJobKey` */
internal fun maintenanceJobKey(id: String) = "$MAINTENANCE_JOB_KEY_PREFIX$id"

internal const val MAINTENANCE_JOB_KEY_PREFIX = "maintenanceJob."

// intentional-suppression: an unreadable fingerprint is a stale job, which re-runs and rewrites it.
internal suspend fun VescapeDao.storedMaintenanceFingerprint(id: String): String? =
  getAppSetting(maintenanceJobKey(id))?.let { runCatching { decodeSettingJson(it.valueJson) as? String }.getOrNull() }

internal suspend fun VescapeDao.publishMaintenanceFingerprint(id: String, fingerprint: String, nowMs: Long) =
  upsertAppSetting(AppSettingEntity(maintenanceJobKey(id), JSONObject.quote(fingerprint), nowMs))

/**
 * @parity /src/modules/settings/lib/maintenance.ts `MaintenanceJobId`
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceJobs`
 */
internal val MAINTENANCE_JOBS: List<MaintenanceJob> = listOf(TelemetryStorageJob(), RideSummariesJob, RideWeatherJob, CleanupJob())

/**
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `RideSummariesJob`
 */
internal object RideSummariesJob : MaintenanceJob {
  override val id = "rideSummaries"
  override val version = 2
  override val requiresNetwork = false
  override val inputKeys = setOf(
    "movingSpeedThresholdKmh",
    "avgSpeedCutoffKmh",
    "movingAvgSpeedThresholdKmh",
  )

  override fun inputs(settings: AppSettings): String =
    "moving=${settings.toMetricSanitizerConfig().movingSpeedThresholdCentiKmh}"

  override suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome {
    val config = settings.toMetricSanitizerConfig()
    val gapMs = settings.rideSplitGapMinutes * 60_000L
    val start = scope.chunk { it.rideSummariesStartMs() } ?: return MaintenanceJobOutcome.Completed
    val context = RideSummariesContext()
    var from = start
    while (true) {
      when (val result = scope.chunk { it.rebuildRideSummariesChunk(from, context, config, gapMs, scope.nowMs()) }) {
        RideSummariesChunkResult.Finished -> return MaintenanceJobOutcome.Completed
        is RideSummariesChunkResult.ActiveRide -> return MaintenanceJobOutcome.Deferred(result.retryAtMs)
        is RideSummariesChunkResult.Rebuilt -> {
          scope.committed()
          scope.progress(hours(result.toMs - start), hours(result.endMs - start))
          from = result.toMs
        }
      }
    }
  }

  private fun hours(spanMs: Long): Int = ((spanMs + RIDE_SUMMARIES_CHUNK_MS - 1) / RIDE_SUMMARIES_CHUNK_MS).toInt()
}

/**
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `TelemetryStorageJob`
 * @parity /src/modules/settings/lib/maintenance.ts `MaintenanceJobId`
 */
internal class TelemetryStorageJob : MaintenanceJob {
  override val id = "telemetryStorage"
  override val version = 1
  override val requiresNetwork = false
  override val inputKeys = emptySet<String>()
  private val completion = LaunchMaintenanceCompletion()
  override fun inputs(settings: AppSettings) = ""

  override suspend fun hasWork(scope: MaintenanceJobScope, settings: AppSettings): Boolean = scope.chunk {
    it.deleteAppSetting("maintenanceJob.telemetryBacklogDrain")
    it.storedMaintenanceFingerprint(id) != completion(scope) &&
      it.hasClosedTelemetryMinute(telemetryDrainCutoffMs(scope.nowMs()))
  }

  override suspend fun begin(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.deleteAppSetting(maintenanceJobKey(id)) }
  }

  override suspend fun complete(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.publishMaintenanceFingerprint(id, completion(scope), scope.nowMs()) }
  }

  override suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome {
    val started = System.nanoTime()
    val gapMs = settings.rideSplitGapMinutes * 60_000L
    val result = drainTelemetryBuffer(scope, gapMs, onFailure = scope.sealFailure)
    if (result.minutes > 0) scope.diagnostic("telemetry_drain", mapOf(
      "operation" to "telemetry_drain", "minutes" to result.minutes,
      "sealed_minutes" to result.sealedMinutes, "failures" to result.failures,
      "yielded" to result.yielded, "duration_ms" to (System.nanoTime() - started) / 1_000_000,
    ))
    return if (result.yielded) MaintenanceJobOutcome.Deferred(scope.nowMs() + gapMs) else MaintenanceJobOutcome.Completed
  }
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `LaunchMaintenanceCompletion` */
private class LaunchMaintenanceCompletion {
  private val launch = java.util.UUID.randomUUID().toString()
  operator fun invoke(scope: MaintenanceJobScope) = "$launch|${scope.ticket}"
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `CLEANUP_STEPS` */
private val CLEANUP_STEPS: List<suspend (MaintenanceJobScope, Long) -> MaintenanceJobOutcome> = listOf(
  { scope, gapMs ->
    val result = pruneDiagnosticEvents(scope, gapMs)
    if (result.deleted > 0) scope.diagnostic("diagnostic_prune", mapOf("deleted" to result.deleted))
    if (result.yielded) MaintenanceJobOutcome.Deferred(scope.nowMs() + gapMs) else MaintenanceJobOutcome.Completed
  },
  { scope, gapMs ->
    val result = pruneBoardConfigRevisions(scope, gapMs)
    if (result.deletedRevisions > 0 || result.deletedSchemas > 0) {
      scope.diagnostic(
        "board_config_revision_prune",
        mapOf("deleted_revisions" to result.deletedRevisions, "deleted_schemas" to result.deletedSchemas),
      )
    }
    if (result.yielded) MaintenanceJobOutcome.Deferred(scope.nowMs() + gapMs) else MaintenanceJobOutcome.Completed
  },
)

/**
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `CleanupJob`
 * @parity /src/modules/settings/lib/maintenance.ts `MaintenanceJobId`
 */
internal class CleanupJob : MaintenanceJob {
  override val id = "cleanup"
  override val version = 1
  override val requiresNetwork = false
  override val inputKeys = emptySet<String>()
  private val completion = LaunchMaintenanceCompletion()
  override fun inputs(settings: AppSettings) = ""

  override suspend fun hasWork(scope: MaintenanceJobScope, settings: AppSettings): Boolean =
    scope.chunk { it.storedMaintenanceFingerprint(id) } != completion(scope)

  override suspend fun complete(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.publishMaintenanceFingerprint(id, completion(scope), scope.nowMs()) }
  }

  override suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome {
    val gapMs = settings.rideSplitGapMinutes * 60_000L
    var failure: Exception? = null
    for ((index, step) in CLEANUP_STEPS.withIndex()) {
      try {
        val outcome = step(scope, gapMs)
        if (outcome is MaintenanceJobOutcome.Deferred) return outcome
      } catch (error: Exception) {
        if (error is MaintenanceRunFenced || error is kotlinx.coroutines.CancellationException ||
          error is androidx.sqlite.SQLiteException) throw error
        scope.diagnostic("cleanup_step_failed", mapOf("step" to index, "message" to error.message))
        if (failure == null) failure = error
      }
    }
    failure?.let { throw it }
    return MaintenanceJobOutcome.Completed
  }
}
