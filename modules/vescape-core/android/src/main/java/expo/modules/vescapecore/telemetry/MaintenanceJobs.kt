package expo.modules.vescapecore.telemetry

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject
import expo.modules.vescapecore.database.AppSettingEntity
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.VescapeDao

/**
 * A Maintenance Job: app-owned work that brings stored data up to date with the current app.
 *
 * By default a job is done when its `app_settings` fingerprint equals `version|inputs`. A mismatch
 * makes it stale and the runner runs it. There is no progress cursor: a run that stops early
 * restarts from zero, so [run] must be idempotent, and a run that could not handle everything
 * simply does not publish its fingerprint. A job may own its done state instead by overriding
 * [hasWork], [begin] and [complete], as the Ride weather watermark does.
 *
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceJob`
 */
internal interface MaintenanceJob {
  /** Stable id: the `app_settings` key suffix and the bridge `MaintenanceJobId`. */
  val id: String
  /** Bump to make every stored fingerprint stale, so the job runs again after the update. */
  val version: Int
  /** The runner does not start the job while offline; it waits instead of failing. */
  val requiresNetwork: Boolean
  /** Setting keys whose change can change [inputs]; a change re-runs the job after a debounce. */
  val inputKeys: Set<String>

  /** Normalized settings the output depends on, e.g. `moving=300|freeSpinDelta=1200`. */
  fun inputs(settings: AppSettings): String

  /** One run over the whole data set. Writes only through [MaintenanceJobScope.chunk]. */
  suspend fun run(scope: MaintenanceJobScope, settings: AppSettings): MaintenanceJobOutcome

  /** Whether the job is stale. Runs on every trigger, so it must stay a small bounded check. */
  suspend fun hasWork(scope: MaintenanceJobScope, settings: AppSettings): Boolean =
    scope.chunk { it.storedMaintenanceFingerprint(id) } != fingerprint(settings)

  /**
   * Before the first chunk. The old fingerprint goes first: a run that ends partway must leave the
   * job stale, even if the inputs change back to the ones the old fingerprint names.
   */
  suspend fun begin(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.deleteAppSetting(maintenanceJobKey(id)) }
  }

  /** After a [MaintenanceJobOutcome.Completed] run. */
  suspend fun complete(scope: MaintenanceJobScope, settings: AppSettings) {
    scope.chunk { it.publishMaintenanceFingerprint(id, fingerprint(settings), scope.nowMs()) }
  }
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceJobOutcome` */
internal sealed class MaintenanceJobOutcome {
  /** Everything handled: the runner publishes the run's fingerprint. */
  data object Completed : MaintenanceJobOutcome()
  /** Some data is still being recorded or a fetch must be retried; stay stale and check again at [retryAtMs]. */
  data class Deferred(val retryAtMs: Long) : MaintenanceJobOutcome()
}

/** Restore or Clear all replaced the database under the run; nothing more may be written. */
internal class MaintenanceRunFenced : Exception("Database replaced during maintenance")

/**
 * One HTTP GET as a network job sees it. [body] is null when the response carried none; a transport
 * failure (offline, timeout) throws `java.io.IOException` instead.
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceHttpResponse`
 */
internal data class MaintenanceHttpResponse(val status: Int, val body: String?, val retryAfterSeconds: Long?)

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceHttp` */
internal fun interface MaintenanceHttp {
  suspend fun get(url: String): MaintenanceHttpResponse
}

/**
 * What a running job may touch. Every write goes through [chunk], one short transaction under the
 * [DatabaseReplacementFence] ticket the run started with.
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `MaintenanceJobScope`
 */
internal class MaintenanceJobScope(
  private val dao: () -> VescapeDao,
  private val fence: DatabaseReplacementFence,
  private val ticket: Long,
  val nowMs: () -> Long = System::currentTimeMillis,
  /** Items handled so far and the current total, in the job's own unit. */
  val progress: (done: Int, total: Int) -> Unit = { _, _ -> },
  /** A chunk that changed Ride History committed. */
  val committed: () -> Unit = {},
  /** Network access for jobs with [MaintenanceJob.requiresNetwork]; off the main thread, cancellable. */
  val http: MaintenanceHttp = MaintenanceHttp { throw java.io.IOException("No network transport") },
) {
  /** Run [block] under the fence; throws [MaintenanceRunFenced] once the database was replaced. */
  suspend fun <T> chunk(block: suspend (VescapeDao) -> T): T {
    currentCoroutineContext().ensureActive()
    // Boxed, so a block that legitimately returns null is not mistaken for a fenced write.
    val box = fence.write(ticket) { listOf(block(dao())) } ?: throw MaintenanceRunFenced()
    return box.single()
  }
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceFingerprint` */
internal fun MaintenanceJob.fingerprint(settings: AppSettings): String = "$version|${inputs(settings)}"

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceJobKey` */
internal fun maintenanceJobKey(id: String) = "$MAINTENANCE_JOB_KEY_PREFIX$id"

/** Prefix of the native-owned `app_settings` rows holding done fingerprints; never a JS setting. */
internal const val MAINTENANCE_JOB_KEY_PREFIX = "maintenanceJob."

// intentional-suppression: an unreadable fingerprint is a stale job, which re-runs and rewrites it.
internal suspend fun VescapeDao.storedMaintenanceFingerprint(id: String): String? =
  getAppSetting(maintenanceJobKey(id))?.let { runCatching { decodeSettingJson(it.valueJson) as? String }.getOrNull() }

internal suspend fun VescapeDao.publishMaintenanceFingerprint(id: String, fingerprint: String, nowMs: Long) =
  upsertAppSetting(AppSettingEntity(maintenanceJobKey(id), JSONObject.quote(fingerprint), nowMs))

/**
 * Every Maintenance Job, in run order. A new job is declared here and nowhere else.
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceJobs`
 */
internal val MAINTENANCE_JOBS: List<MaintenanceJob> = listOf(RideSummariesJob, RideWeatherJob)

/**
 * Ride summaries: minute buckets, exclusion ranges and route previews rebuilt from the raw frames
 * and Ride Track, one owned hour per transaction, oldest first. History stays complete throughout:
 * a mix of old and new hours, never a missing ride. The potentially active ride is never owned.
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `RideSummariesJob`
 */
internal object RideSummariesJob : MaintenanceJob {
  override val id = "rideSummaries"
  override val version = 1
  override val requiresNetwork = false
  override val inputKeys = setOf(
    "movingSpeedThresholdKmh",
    "avgSpeedCutoffKmh",
    "movingAvgSpeedThresholdKmh",
    "freeSpinMaxSpeedDeltaKmh",
    "freeSpinStationaryBoardCapKmh",
  )

  override fun inputs(settings: AppSettings): String = settings.toMetricSanitizerConfig().let {
    "moving=${it.movingSpeedThresholdCentiKmh}|freeSpinDelta=${it.freeSpinMaxSpeedDeltaCentiKmh}" +
      "|freeSpinCap=${it.freeSpinStationaryBoardCapCentiKmh}"
  }

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
