package expo.modules.vescapecore.telemetry

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import android.util.Log
import expo.modules.vescapecore.recording.RecordingStorageFailure
import io.sentry.Breadcrumb
import io.sentry.Sentry
import io.sentry.SentryLevel
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "MaintenanceRunner"
/** Startup settles before the first pass: JS, BLE and the first flushes go first. */
private const val LAUNCH_DELAY_MS = 10_000L
/** A Stepper fires one change per tap; the run restarts once the Rider stops. */
private const val INPUT_DEBOUNCE_MS = 3_000L
private const val PROGRESS_EMIT_INTERVAL_MS = 250L
/** Open history pages re-read at most this often while chunks commit. */
private const val HISTORY_REVISION_INTERVAL_MS = 3_000L

/**
 * Runs stale Maintenance Jobs one at a time, in declaration order, on one low-priority thread.
 * Every piece of state is confined to that thread; JS reads [snapshot] and the `onChange` sink.
 * Triggers: launch, network back, an input setting change, ride closure, Restore and Clear all.
 *
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `MaintenanceRunner`
 */
internal object MaintenanceRunner {
  private val dispatcher = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "vescape-maintenance").apply {
      priority = Thread.MIN_PRIORITY
      isDaemon = true
    }
  }.asCoroutineDispatcher()
  private val scope = CoroutineScope(SupervisorJob() + dispatcher)
  private val jobs: List<MaintenanceJob> = MAINTENANCE_JOBS

  private lateinit var appContext: Context
  private var started = false
  private var loop: Job? = null
  private var rerun = false
  private var debounce: Job? = null
  private var closureCheck: Job? = null
  private var closureCheckAtMs = Long.MAX_VALUE
  private val http = OkHttpMaintenanceHttp()
  @Volatile private var online = false

  private val states = jobs.associate { it.id to MaintenanceJobState(it.id) }.toMutableMap()
  private var runningId: String? = null
  private var historyRevision = 0
  private var lastRevisionAtMs = 0L
  private var revisionPending = false
  private var lastProgressEmitAtMs = 0L

  @Volatile private var published: Map<String, Any?> = buildSnapshot()

  /** JS-facing sink; called on the maintenance thread. */
  @Volatile var onChange: ((Map<String, Any?>) -> Unit)? = null

  fun snapshot(): Map<String, Any?> = published

  /** Idempotent per process: the first call arms network tracking and the launch pass. */
  fun start(context: Context) = scope.launch {
    if (started) return@launch
    started = true
    appContext = context.applicationContext
    watchNetwork()
    delay(LAUNCH_DELAY_MS)
    trigger("launch")
  }

  fun trigger(reason: String) = scope.launch {
    if (!started) return@launch
    if (loop?.isActive == true) {
      rerun = true
      return@launch
    }
    breadcrumb("pass", mapOf("reason" to reason))
    loop = scope.launch { runPasses() }
  }

  /** An input setting changed: restart any run with the new values once the Rider settles. */
  fun onSettingChanged(key: String) = scope.launch {
    if (jobs.none { key in it.inputKeys }) return@launch
    debounce?.cancel()
    debounce = scope.launch {
      delay(INPUT_DEBOUNCE_MS)
      loop?.cancelAndJoin()
      trigger("input:$key")
    }
  }

  /** Restore or Clear all finished, successfully or not: re-check against the resulting database. */
  fun onDatabaseReplaced() = trigger("database_replaced")

  private suspend fun runPasses() {
    do {
      rerun = false
      if (RecordingStorageFailure.value() != null) return
      val settings = AppDataRepository.get(appContext).getTypedSettings()
      for (job in jobs) runIfStale(job, settings)
    } while (rerun)
  }

  private suspend fun runIfStale(job: MaintenanceJob, settings: AppSettings) {
    val state = states.getValue(job.id)
    val fingerprint = job.fingerprint(settings)
    val fence = DatabaseReplacementFence.process
    val ticket = fence.ticket()
    val runScope = MaintenanceJobScope(
      dao = { VescapeDatabase.get(appContext).telemetryDao() },
      fence = fence,
      ticket = ticket,
      progress = { done, total -> progress(job.id, done, total) },
      committed = ::chunkCommitted,
      http = http,
    )
    val stale = try {
      job.hasWork(runScope, settings)
    } catch (fenced: MaintenanceRunFenced) {
      rerun = true
      return
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Throwable) {
      Log.e(TAG, "Maintenance Job ${job.id} check failed", error)
      Sentry.captureException(error)
      update(state.copy(status = MaintenanceJobStatus.FAILED, lastError = error.message ?: error.javaClass.simpleName))
      return
    }
    if (!stale) {
      update(state.copy(status = MaintenanceJobStatus.DONE, done = 0, total = 0))
      return
    }
    if (job.requiresNetwork && !online) {
      update(state.copy(status = MaintenanceJobStatus.WAITING_FOR_NETWORK))
      return
    }
    val startedAt = System.currentTimeMillis()
    val clock = SystemClock.elapsedRealtime()
    runningId = job.id
    update(state.copy(status = MaintenanceJobStatus.RUNNING, done = 0, total = 0, lastRunAtMs = startedAt, lastError = null))
    breadcrumb("start", mapOf("job" to job.id, "fingerprint" to fingerprint))
    var next: MaintenanceJobState
    try {
      job.begin(runScope, settings)
      val outcome = job.run(runScope, settings)
      next = when (outcome) {
        MaintenanceJobOutcome.Completed -> {
          job.complete(runScope, settings)
          breadcrumb("finish", mapOf("job" to job.id))
          states.getValue(job.id).copy(status = MaintenanceJobStatus.DONE)
        }
        is MaintenanceJobOutcome.Deferred -> {
          breadcrumb("deferred", mapOf("job" to job.id, "retryAtMs" to outcome.retryAtMs))
          scheduleClosureCheck(outcome.retryAtMs)
          // A fetch that failed because the network went away waits for it, with no warning.
          val waiting = job.requiresNetwork && !online
          states.getValue(job.id).copy(
            status = if (waiting) MaintenanceJobStatus.WAITING_FOR_NETWORK else MaintenanceJobStatus.PENDING,
          )
        }
      }
    } catch (fenced: MaintenanceRunFenced) {
      breadcrumb("cancel", mapOf("job" to job.id, "reason" to "database_replaced"))
      rerun = true
      next = states.getValue(job.id).copy(status = MaintenanceJobStatus.PENDING)
    } catch (cancelled: CancellationException) {
      breadcrumb("cancel", mapOf("job" to job.id, "reason" to "restart"))
      finishRun(states.getValue(job.id).copy(status = MaintenanceJobStatus.PENDING), clock)
      throw cancelled
    } catch (error: Throwable) {
      Log.e(TAG, "Maintenance Job ${job.id} failed", error)
      Sentry.withScope { sentryScope ->
        sentryScope.setTag("maintenance.job", job.id)
        sentryScope.setExtra("maintenance.fingerprint", fingerprint)
        Sentry.captureException(error)
      }
      next = states.getValue(job.id).copy(
        status = MaintenanceJobStatus.FAILED,
        lastError = error.message ?: error.javaClass.simpleName,
      )
    }
    finishRun(next, clock)
  }

  private fun finishRun(next: MaintenanceJobState, startedClock: Long) {
    runningId = null
    update(next.copy(lastDurationMs = SystemClock.elapsedRealtime() - startedClock))
    if (revisionPending) bumpHistoryRevision()
  }

  /** One pending check serves every job: an earlier retry is never pushed back by a later one. */
  private fun scheduleClosureCheck(retryAtMs: Long) {
    if (closureCheck?.isActive == true && closureCheckAtMs <= retryAtMs) return
    closureCheck?.cancel()
    closureCheckAtMs = retryAtMs
    closureCheck = scope.launch {
      delay((retryAtMs - System.currentTimeMillis()).coerceAtLeast(0) + 1_000L)
      trigger("ride_closure")
    }
  }

  private fun progress(id: String, done: Int, total: Int) {
    breadcrumb("chunk", mapOf("job" to id, "done" to done, "total" to total), log = false)
    val state = states.getValue(id)
    states[id] = state.copy(done = done, total = total)
    val now = SystemClock.elapsedRealtime()
    if (now - lastProgressEmitAtMs < PROGRESS_EMIT_INTERVAL_MS && done < total) return
    lastProgressEmitAtMs = now
    publish()
  }

  private fun chunkCommitted() {
    revisionPending = true
    if (SystemClock.elapsedRealtime() - lastRevisionAtMs >= HISTORY_REVISION_INTERVAL_MS) bumpHistoryRevision()
  }

  private fun bumpHistoryRevision() {
    revisionPending = false
    lastRevisionAtMs = SystemClock.elapsedRealtime()
    historyRevision++
    publish()
  }

  private fun update(state: MaintenanceJobState) {
    states[state.id] = state
    publish()
  }

  private fun publish() {
    published = buildSnapshot()
    onChange?.invoke(published)
  }

  /**
   * @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `buildSnapshot`
   * @parity /modules/vescape-core/src/index.ts `MaintenanceState`
   */
  private fun buildSnapshot(): Map<String, Any?> = mapOf(
    "running" to (runningId != null),
    "historyRevision" to historyRevision,
    "jobs" to jobs.map { states.getValue(it.id).toMap() },
  )

  private fun watchNetwork() {
    val manager = appContext.getSystemService(ConnectivityManager::class.java) ?: return
    online = manager.getNetworkCapabilities(manager.activeNetwork)
      ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        val wasOnline = online
        online = true
        if (!wasOnline && jobs.any { it.requiresNetwork }) trigger("network")
      }

      override fun onLost(network: Network) {
        online = false
      }
    })
  }

  private fun breadcrumb(event: String, data: Map<String, Any>, log: Boolean = true) {
    if (log) Log.i(TAG, "$event $data") else Log.d(TAG, "$event $data")
    Sentry.addBreadcrumb(Breadcrumb().apply {
      category = "maintenance"
      message = event
      level = SentryLevel.INFO
      data.forEach { (key, value) -> setData(key, value) }
    })
  }
}

/** @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `MaintenanceJobStatus` */
internal enum class MaintenanceJobStatus(val wire: String) {
  /** Not checked yet this process, or stale and waiting for a ride to close or a restart. */
  PENDING("pending"),
  RUNNING("running"),
  DONE("done"),
  WAITING_FOR_NETWORK("waitingForNetwork"),
  FAILED("failed"),
}

/**
 * One job's line on the Database screen. Run history is per process; the durable truth is the
 * fingerprint alone.
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `MaintenanceJobState`
 * @parity /modules/vescape-core/src/index.ts `MaintenanceJobState`
 */
internal data class MaintenanceJobState(
  val id: String,
  val status: MaintenanceJobStatus = MaintenanceJobStatus.PENDING,
  val done: Int = 0,
  val total: Int = 0,
  val lastRunAtMs: Long? = null,
  val lastDurationMs: Long? = null,
  val lastError: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "status" to status.wire,
    "done" to done,
    "total" to total,
    "lastRunAtMs" to lastRunAtMs,
    "lastDurationMs" to lastDurationMs,
    "lastError" to lastError,
  )
}

/**
 * OkHttp GET for network Maintenance Jobs. Asynchronous, so the maintenance thread is never blocked,
 * and cancelling the run cancels the call: a late response cannot reach the database.
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceRunner.swift `urlSessionMaintenanceHttp`
 */
private class OkHttpMaintenanceHttp : MaintenanceHttp {
  private val client = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()

  override suspend fun get(url: String): MaintenanceHttpResponse = suspendCancellableCoroutine { continuation ->
    val call = client.newCall(Request.Builder().url(url).build())
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        if (continuation.isActive) continuation.resumeWithException(e)
      }

      override fun onResponse(call: Call, response: Response) {
        val result = try {
          response.use {
            MaintenanceHttpResponse(it.code, it.body?.string(), retryAfterSeconds(it))
          }
        } catch (error: IOException) {
          if (continuation.isActive) continuation.resumeWithException(error)
          return
        }
        if (continuation.isActive) continuation.resume(result)
      }
    })
  }

  /** Retry-After as delay seconds or an HTTP-date (RFC 9110), as seconds from now. */
  private fun retryAfterSeconds(response: Response): Long? {
    val value = response.header("Retry-After")?.trim() ?: return null
    value.toLongOrNull()?.let { return it }
    val date = response.headers.getDate("Retry-After") ?: return null
    return ((date.time - System.currentTimeMillis()) / 1_000).coerceAtLeast(0)
  }
}
