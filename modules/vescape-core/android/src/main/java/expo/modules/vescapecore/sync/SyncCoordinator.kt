package expo.modules.vescapecore.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import expo.modules.vescapecore.api.HttpMethod
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.auth.DeviceCredentialStore
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.telemetry.DatabaseBackupManager
import expo.modules.vescapecore.telemetry.TelemetryDatabase
import expo.modules.vescapecore.telemetry.TelemetryRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val TAG = "SyncCoordinator"

/** What JS renders. Native owns every transition; JS only asks and shows. */
data class SyncStatus(
  val accountId: String?,
  val pendingRows: Int,
  val activity: SyncActivity,
  val pause: SyncPauseReason?,
  val lastUploadAtMs: Long?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "accountId" to accountId,
    "pendingRows" to pendingRows,
    "activity" to activity.slug,
    "pause" to pause?.slug,
    "lastUploadAtMs" to lastUploadAtMs,
  )
}

/**
 * The uploader's lifecycle: the loop, the kicks, and the Account binding it runs under.
 *
 * Runs inside the window the app already keeps alive — the foreground service during a Board Session
 * or GPS, the existing background modes on iOS. Deliberately no `WorkManager`: a ride that ends
 * offline on a phone that is never reopened waits for the next app open or the next ride.
 *
 * @parity /modules/vescape-core/ios/sync/SyncCoordinator.swift
 */
class SyncCoordinator private constructor(private val context: Context) {
  /** Resolved per call: an Account reset replaces the whole database file under this object. */
  private val dao get() = TelemetryDatabase.get(context).telemetryDao()
  private val credentials = DeviceCredentialStore(context)
  private val scope = CoroutineScope(SupervisorJob())

  /** Bumped by an Account reset; a response captured under an older value cannot commit. */
  @Volatile private var generation = 0L

  @Volatile private var lastSamplePersistedAtMs = 0L
  @Volatile private var lastUploadAtMs: Long? = null
  @Volatile private var wifiOnly = false

  /** The master switch. Off by default: nothing uploads until the Rider turns backup on. */
  @Volatile private var enabled = false

  /** Failure keys already recorded this process, so a wedged batch writes one event, not a stream. */
  private val recordedFailures = HashSet<String>()

  private var loop: Job? = null

  /** Kicks in flight, so [stop] leaves nothing running against a database about to be replaced. */
  private val kicks = java.util.concurrent.CopyOnWriteArrayList<Job>()

  /** Serializes passes against each other and against [resetForAccount]. */
  private val passLock = Mutex()

  /**
   * Last reachability the callback below reported, so a kick fires on the transition rather than on
   * every capability change a network publishes while it is already up.
   *
   * Starts true: a phone that has been online all along must not read its first callback as a
   * regain, which would kick on nothing.
   */
  @Volatile private var online = true

  /**
   * Connectivity regained is one of the immediate kicks, next to the ride ending and sign-in. Without
   * it a phone that comes back online waits out the idle interval with a full backlog in hand.
   *
   * Registered for the process lifetime, not per pass: the callback is what makes the regain
   * observable at all, and [kick] is a no-op whenever the switch is off or the loop is not running.
   *
   * @parity /modules/vescape-core/ios/sync/SyncCoordinator.swift `pathUpdateHandler`
   */
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
      val reachable = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      val regained = reachable && !online
      online = reachable
      if (regained) kick()
    }

    override fun onLost(network: Network) {
      online = false
    }
  }

  private val store = SyncStore(
    database = { dao },
    generation = { generation },
    onPermanentFailure = ::recordPermanentFailure,
  )

  private val engine = SyncEngine(
    source = store,
    transport = ::post,
    environment = ::environment,
  )

  init {
    runCatching {
      context.getSystemService(ConnectivityManager::class.java)
        ?.registerDefaultNetworkCallback(networkCallback)
    }
  }

  val pauseReason: SyncPauseReason? get() = engine.pauseReason

  /**
   * Wired by the module: every status transition, pushed to JS. Native owns the state; JS renders it
   * and never derives one of its own.
   */
  @Volatile var onStatusChanged: ((Map<String, Any?>) -> Unit)? = null

  /** Last map handed out, so an unchanged status emits nothing and raises no second notification. */
  @Volatile private var publishedStatus: Map<String, Any?>? = null

  /** Recording persisted samples: the ride cadence follows sample production, not session presence. */
  fun notifySamplesPersisted(atMs: Long = System.currentTimeMillis()) {
    lastSamplePersistedAtMs = atMs
  }

  /**
   * The ride ended and its last samples are on disk. Called after the final flush, so the kick scans
   * a complete ride rather than one missing its tail.
   *
   * This is the moment with the largest fresh backlog and the moment a Rider is most likely to open
   * the app and look at the status line, which is why it does not wait for the next tick.
   *
   * @parity /modules/vescape-core/ios/sync/SyncCoordinator.swift `notifyRecordingStopped`
   */
  fun notifyRecordingStopped() {
    kick()
  }

  /**
   * A Rider changed something durable and small — a Favorite pinned, renamed or unpinned. One row,
   * created by hand, and the Rider is looking at the screen that says whether it is backed up, so a
   * five-minute wait reads as the backup not working.
   *
   * Deliberately not wired to telemetry writes: those arrive at 2 Hz and already have the ride
   * cadence. This is for edits a Rider makes, which are rare and individually visible.
   *
   * @parity /modules/vescape-core/ios/sync/SyncCoordinator.swift `notifyRiderEdit`
   */
  fun notifyRiderEdit() {
    kick()
  }

  /**
   * The master switch, from the App Setting native owns. Off stops the loop outright — no scan, no
   * request, no backoff, no pause notification — rather than leaving a loop that decides to do
   * nothing every five minutes.
   */
  fun setEnabled(value: Boolean) {
    if (enabled == value) return
    enabled = value
    if (value) {
      start()
    } else {
      stop()
      // A switched-off uploader asks the Rider for nothing: an earlier pause is no longer theirs to
      // act on until they turn backup back on.
      SyncNotifier.get(context).update(null)
    }
    scope.launch { publishStatus() }
  }

  /**
   * The "Back up over Wi-Fi only" App Setting, pushed by [AppDataRepository] on every write and read
   * back on launch. Native reads the setting itself — JS never carries the switch to the uploader.
   */
  fun setWifiOnly(enabled: Boolean) {
    if (wifiOnly == enabled) return
    wifiOnly = enabled
    kick()
    scope.launch { publishStatus() }
  }

  suspend fun status(): SyncStatus {
    val environment = environment()
    val pending = store.pendingCount()
    val pause = engine.pauseReason
    return SyncStatus(
      accountId = dao.getBoundAccountId(),
      pendingRows = pending,
      activity = SyncPolicy.describe(
        SyncState(
          nowMs = System.currentTimeMillis(),
          pendingRows = pending,
          ridingSamples = environment.ridingSamples,
          enabled = environment.enabled,
          online = environment.online,
          wifiOnly = environment.wifiOnly,
          onWifi = environment.onWifi,
          credentialReady = environment.credentialReady,
          onlineBlocked = environment.onlineBlocked,
          pause = pause,
          // Backoff is invisible to the Rider: a batch waiting to be retried is still syncing.
          retryAtMs = 0,
        ),
      ),
      pause = pause,
      lastUploadAtMs = lastUploadAtMs,
    )
  }

  /**
   * Emit the current status when it differs from the last one, and raise the notification a pause
   * needs: a permanent failure does not resolve through ordinary retry, so a backup that stopped
   * weeks ago must not wait for the Rider to open the social sheet.
   */
  private suspend fun publishStatus() {
    val status = runCatching { status() }.getOrNull() ?: return
    val map = status.toMap()
    if (map == publishedStatus) return
    val previousPause = publishedStatus?.get("pause") as? String
    publishedStatus = map
    if (status.pause?.slug != previousPause) SyncNotifier.get(context).update(status.pause)
    onStatusChanged?.invoke(map)
  }

  /**
   * Pick the uploader back up on a cold launch: the credential outlives the process, so a phone that
   * was signed in stays signed in, and nothing else would ever start the loop again. Binding the
   * stored Account is a no-op when this database already belongs to it, and cannot claim a database
   * that belongs to another one.
   */
  fun resumeIfBound() {
    scope.launch {
      // The switch is a durable App Setting, so the uploader restores it before the first pass of
      // this process — otherwise a cold launch on mobile data would upload once before JS loaded.
      val settings = runCatching { AppDataRepository.get(context).getTypedSettings() }.getOrNull()
      wifiOnly = settings?.syncWifiOnly ?: false
      enabled = settings?.syncEnabled ?: false
      val credential = credentials.read()
      // Binding still happens with the switch off — it is what makes this database's Account known,
      // and `start()` below is the only thing the switch gates.
      if (credential != null && bindAccount(credential.accountId) && enabled) start()
      publishStatus()
    }
  }

  fun start() {
    if (!enabled) return
    if (loop?.isActive == true) return
    loop = scope.launch {
      while (isActive) {
        val waitMs = try {
          pass()
        } catch (e: Exception) {
          Log.w(TAG, "Sync pass failed: ${e.message}")
          SyncPolicy.IDLE_INTERVAL_MS
        }
        publishStatus()
        delay(waitMs)
      }
    }
  }

  /** Stops the loop and every kick in flight, so nothing is left running over a replaced database. */
  fun stop() {
    loop?.cancel()
    loop = null
    kicks.forEach { it.cancel() }
    kicks.clear()
  }

  /** Connectivity regained, ride ended, sign-in: send now rather than waiting for the next tick. */
  fun kick() {
    if (!enabled) return
    if (loop?.isActive != true) return start()
    val job = scope.launch {
      runCatching { pass() }
      publishStatus()
    }
    kicks.add(job)
    job.invokeOnCompletion { kicks.remove(job) }
  }

  /**
   * One pass, draining while the server keeps accepting: a `200` with rows still pending sends again
   * straight away, so a long backlog drains instead of trickling.
   *
   * Serialized against every other pass and against an Account reset: the whole scan → send →
   * commit sequence holds the lock, so a reset can never land between reading a previous Account's
   * rows and checkpointing them onto the fresh database.
   */
  private suspend fun pass(): Long = passLock.withLock {
    var drains = 0
    while (drains < MAX_DRAIN_STEPS) {
      when (val outcome = engine.runOnce()) {
        is SyncPass.Sent -> {
          lastUploadAtMs = System.currentTimeMillis()
          if (!outcome.morePending) return interval()
          drains += 1
        }
        // Nothing was accepted, but the next attempt differs — a narrowed byte target.
        SyncPass.Retry -> drains += 1
        is SyncPass.Waiting ->
          return (outcome.untilMs - System.currentTimeMillis()).coerceIn(0, SyncPolicy.BACKOFF_MAX_MS)
        is SyncPass.Paused -> return SyncPolicy.IDLE_INTERVAL_MS
        SyncPass.Idle -> return interval()
      }
    }
    // A drain that never finishes yields rather than spinning; the next tick resumes it.
    return SyncPolicy.RIDE_INTERVAL_MS
  }

  private fun interval(): Long =
    if (samplesProducing()) SyncPolicy.RIDE_INTERVAL_MS else SyncPolicy.IDLE_INTERVAL_MS

  private fun samplesProducing(): Boolean =
    System.currentTimeMillis() - lastSamplePersistedAtMs < SAMPLE_ACTIVITY_WINDOW_MS

  private fun environment(): SyncEnvironment {
    val capabilities = runCatching {
      val manager = context.getSystemService(ConnectivityManager::class.java)
      manager?.getNetworkCapabilities(manager.activeNetwork)
    }.getOrNull()
    return SyncEnvironment(
      ridingSamples = samplesProducing(),
      enabled = enabled,
      online = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
      wifiOnly = wifiOnly,
      onWifi = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
      credentialReady = credentials.read() != null,
      onlineBlocked = AppStatusCoordinator.get(context).onlineBlocked,
    )
  }

  /**
   * The Sync endpoints are Online Capabilities behind the App Status gate, and they authenticate with
   * the shared Device Token, so the whole call goes through [VescapeApi].
   */
  private suspend fun post(body: String): SyncResponse {
    val api = VescapeApi.forOrigin(context, AppStatusCoordinator.serverBaseUrl(context))
    val response = api.exchange(HttpMethod.POST, SYNC_PATH, body)
      ?: return SyncResponse.Transient("network")
    return when {
      response.status == 200 -> SyncResponse.Accepted(response.body)
      response.status == 401 -> SyncResponse.Unauthorized
      response.status == 413 -> SyncResponse.TooLarge
      response.status == 429 -> SyncResponse.RateLimited(retryAfterMs(response.headers))
      response.status >= 500 -> SyncResponse.Transient("http ${response.status}")
      response.status >= 400 -> SyncResponse.Invalid(response.status, errorSlug(response.body))
      // A `2xx` that is not the accepted map is a protocol failure, not a success to interpret.
      else -> SyncResponse.Invalid(response.status, "unexpected-success")
    }
  }

  /** The server's own delay in seconds, or the first backoff step when it named none. */
  private fun retryAfterMs(headers: Map<String, String>): Long =
    headers["retry-after"]?.trim()?.toLongOrNull()?.times(1_000L) ?: SyncPolicy.BACKOFF_START_MS

  private fun errorSlug(body: String): String =
    Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1) ?: "invalid-request"

  // Account binding — the Device Token exchange returns a stable server Account id, and the first
  // Account claims this database.

  /**
   * Claim the local database for [accountId] when it is unbound or already belongs to it.
   *
   * False means a different Account: cursors are deliberately not reset over the existing rows,
   * because that would upload the previous Account's Boards, Ride History, locations and settings to
   * the new one. The Rider has to confirm the destructive reset first.
   */
  suspend fun bindAccount(accountId: String): Boolean {
    val bound = dao.bindAccount(accountId)
    if (bound) {
      engine.resume()
      kick()
    }
    return bound
  }

  /**
   * The Account change transition, in the one order that cannot leak data between Accounts: stop the
   * loop, invalidate in-flight work, replace the database, clear cursors and pending actions, bind
   * the new Account, then start again.
   *
   * The wipe is local maintenance and emits no Sync Actions to either Account — replacing the file
   * removes the log with everything else.
   */
  suspend fun resetForAccount(accountId: String) {
    stop()
    // Held across the whole transition: a pass that started before `stop()` finishes its scan, send
    // and commit against the old database before the file is replaced, and none can start midway.
    passLock.withLock {
      // Every in-flight response now belongs to a previous Account and can no longer commit.
      generation += 1
      recordedFailures.clear()
      DatabaseBackupManager.replaceWithFreshDatabase(context)
      check(dao.bindAccount(accountId)) { "Fresh database did not accept the new Account" }
      engine.resume()
      lastUploadAtMs = null
    }
    // Deliberately not started here: the caller installs the new Device Token first, so the loop
    // never runs with the previous Account's credential against the new Account's database.
    publishStatus()
  }

  /**
   * One coalesced Diagnostic Event per failure class, table and cursor. Metadata only: an error
   * code, a table, a cursor and the app version — never row contents, coordinates, the Device Token,
   * the server body or an opaque database error.
   */
  private fun recordPermanentFailure(reason: SyncPauseReason, detail: String) {
    val key = "${reason.slug}:$detail"
    synchronized(recordedFailures) {
      if (!recordedFailures.add(key)) return
    }
    TelemetryRepository.get(context).recordDiagnosticEvent(
      "sync_upload_paused",
      mapOf(
        "operation" to "sync",
        "phase" to reason.slug,
        "message" to "Sync upload paused",
        "sync_failure" to reason.slug,
        "sync_detail" to detail,
        "app_version" to AppStatusCoordinator.get(context).appVersion,
      ),
    )
  }

  companion object {
    internal const val SYNC_PATH = "/api/sync"

    /** Samples persisted this recently mean a ride is producing, Idle Pause included. */
    private const val SAMPLE_ACTIVITY_WINDOW_MS = 60_000L

    /** A drain is a burst, not a loop that can never yield to the rest of the process. */
    private const val MAX_DRAIN_STEPS = 50

    @Volatile private var instance: SyncCoordinator? = null

    fun get(context: Context): SyncCoordinator =
      instance ?: synchronized(this) {
        instance ?: SyncCoordinator(context.applicationContext).also { instance = it }
      }
  }
}
