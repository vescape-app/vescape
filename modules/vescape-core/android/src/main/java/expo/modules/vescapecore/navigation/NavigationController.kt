package expo.modules.vescapecore.navigation

import android.content.Context
import expo.modules.vescapecore.api.VescapeApi
import expo.modules.vescapecore.appstatus.AppStatusCoordinator
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.telemetry.AppDataRepository
import expo.modules.vescapecore.watch.WatchRouteMirror
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationStatus`
 * @parity /modules/vescape-core/src/index.ts `NavigationStatus`
 */
enum class NavigationStatus(val wire: String) {
  READY("ready"),

  FETCH_FAILED("fetchFailed"),

  NO_PATH_FOUND("noPathFound");

  companion object {
    fun fromWire(wire: String?): NavigationStatus =
      entries.firstOrNull { it.wire == wire } ?: READY
  }
}

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationProfile`
 * @parity /modules/vescape-core/src/index.ts `NavigationProfile`
 */
enum class NavigationProfile(val wire: String) {
  WALKING("walking"),

  CYCLING("cycling"),

  DRIVING("driving");

  companion object {
    val DEFAULT = WALKING

    fun fromWire(wire: String?): NavigationProfile =
      entries.firstOrNull { it.wire == wire } ?: DEFAULT
  }
}

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `Navigation`
 * @parity /modules/vescape-core/src/index.ts `Navigation`
 */
data class Navigation(
  val targetLatitude: Double,
  val targetLongitude: Double,
  val profile: NavigationProfile,
  val computedAtMs: Long,
  val status: NavigationStatus,
  val distanceMeters: Double,
  val durationSeconds: Double,
  val points: List<Pair<Double, Double>>,
  val revision: Long = 0,
  val automatic: Boolean = false,
) {

  fun toMap(): Map<String, Any?> = mapOf(
    "target" to mapOf("latitude" to targetLatitude, "longitude" to targetLongitude),
    "profile" to profile.wire,
    "computedAtMs" to computedAtMs,
    "revision" to revision,
    "automatic" to automatic,
    "status" to status.wire,
    "distanceMeters" to distanceMeters,
    "durationSeconds" to durationSeconds,
    "coordinates" to points.map { (latitude, longitude) -> listOf(longitude, latitude) },
  )
}

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift
 */
/**
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `DirectionsRoutes`
 */
fun interface DirectionsRoutes {
  suspend fun route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String,
  ): DirectionsResult
}

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `DirectionsResult`
 */
sealed interface DirectionsResult {
  data class Path(
    val points: List<Pair<Double, Double>>,
    val distanceMeters: Double,
    val durationSeconds: Double,
  ) : DirectionsResult

  object NoPath : DirectionsResult

  object Failed : DirectionsResult
}

class NavigationController(
  private val api: DirectionsRoutes,
  private val store: NavigationStore,
  private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
  private val loadRerouteDistanceMeters: suspend () -> Double = { DEFAULT_REROUTE_DISTANCE_METERS },
  private val nowMillis: () -> Long = { android.os.SystemClock.elapsedRealtime() },
) {
  private val lock = Any()

  private var state: Navigation? = null
  private var revision = 0L

  private var profile: NavigationProfile = NavigationProfile.DEFAULT

  private var profileChosen = false

  val current: Navigation? get() = synchronized(lock) { state }

  private var computingRequest: Int? = null

  val computing: Boolean get() = synchronized(lock) { computingRequest != null }

  var onChange: ((Navigation?) -> Unit)? = null

  /**
   * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `onWatchChange`
   */
  var onWatchChange: (() -> Unit)? = null

  /**
   * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `onPathChange`
   */
  var onPathChange: ((List<Pair<Double, Double>>?) -> Unit)? = null

  private var progress: RouteProgress? = null
  private data class Fix(val latitude: Double, val longitude: Double, val speedMps: Double?)
  private var latestFix: Fix? = null

  private fun progressAtLatestFix(): RouteProgress? {
    val fix = latestFix ?: return null
    val points = ridePath(state) ?: return null
    val navigation = state ?: return null
    return RouteProgress.compute(points, fix.latitude, fix.longitude, fix.speedMps,
      navigationRevision = navigation.revision,
      routeDistanceMeters = navigation.distanceMeters,
      routeDurationSeconds = navigation.durationSeconds)
  }

  val currentProgress: RouteProgress? get() = synchronized(lock) { progress }

  var onProgressChange: ((RouteProgress?) -> Unit)? = null

  // @parity /modules/vescape-core/ios/navigation/NavigationController.swift `onFix`
  private var rerouteDistanceMeters = DEFAULT_REROUTE_DISTANCE_METERS
  private var automaticRequest: Int? = null
  private var nextAutomaticAtMs = 0L
  private var automaticBackoffMs = AUTOMATIC_MIN_BACKOFF_MS

  private var rerouteDistanceRead = 0

  fun reloadRerouteDistance() {
    val read = synchronized(lock) { ++rerouteDistanceRead }
    scope.launch {
      val distance = loadRerouteDistanceMeters()
      synchronized(lock) { if (read == rerouteDistanceRead) rerouteDistanceMeters = distance }
    }
  }

  fun onFix(latitude: Double, longitude: Double, speedMps: Double?) {
    val work = synchronized(lock) {
      latestFix = Fix(latitude, longitude, speedMps)
      val next = progressAtLatestFix()
      if (progress != next) {
        progress = next
        onProgressChange?.invoke(next)
      }
      val navigation = state
      if (next == null || navigation == null || computingRequest != null || automaticRequest != null ||
        next.deviationMeters <= rerouteDistanceMeters || nowMillis() < nextAutomaticAtMs) return
      val request = claimRequestLocked()
      automaticRequest = request
      beginComputingLocked(request)
      Triple(request, navigation, profile)
    }
    val (request, navigation, requested) = work
    scope.launch {
      var found = false
      try {
        val replacement = compute(navigation.targetLatitude, navigation.targetLongitude,
          latitude, longitude, requested)
        found = replacement.status == NavigationStatus.READY
        publish(request, replacement, keepUsablePath = true, automatic = true)
      } finally {
        synchronized(lock) {
          if (automaticRequest == request) automaticRequest = null
          nextAutomaticAtMs = nowMillis() + automaticBackoffMs
          automaticBackoffMs = if (found) AUTOMATIC_MIN_BACKOFF_MS
          else minOf(automaticBackoffMs * 2, AUTOMATIC_MAX_BACKOFF_MS)
        }
        endComputing(request)
      }
    }
  }

  private var generation = 0

  fun restore() {
    val request = claimRequest()
    reloadRerouteDistance()
    scope.launch {
      store.loadProfile()?.let { stored ->
        synchronized(lock) { if (!profileChosen) profile = stored }
      }
      val stored = store.load() ?: return@launch
      val directionPoint = try {
        store.directionPoint()
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        RecordingStorageFailure.reportRead("direction_point_read", error)
        return@launch
      }
      val usable = stored.takeIf {
        directionPoint != null &&
          it.targetLatitude == directionPoint.first &&
          it.targetLongitude == directionPoint.second
      }
      publish(request, usable)
      if (usable == null) persist(request)
    }
  }

  fun setTarget(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?,
  ) {
    val request = claimRequest()
    publish(request, null)

    if (fromLatitude == null || fromLongitude == null) {
      publish(request, failed(toLatitude, toLongitude, currentProfile, NavigationStatus.FETCH_FAILED))
      return
    }

    val requested = currentProfile
    beginComputing(request)
    scope.launch {
      try {
        publish(request, compute(toLatitude, toLongitude, fromLatitude, fromLongitude, requested))
      } finally {
        endComputing(request)
      }
    }
  }

  val currentProfile: NavigationProfile get() = synchronized(lock) { profile }

  fun selectProfile(next: NavigationProfile) {
    synchronized(lock) {
      if (profile == next && profileChosen) return
      profile = next
      claimRequestLocked()
      profileChosen = true
    }
    scope.launch {
      writes.withLock { store.saveProfile(currentProfile) }
    }
  }

  fun recompute(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?,
  ) {
    val request = claimRequest()
    val requested = currentProfile

    if (fromLatitude == null || fromLongitude == null) {
      publish(request, failed(toLatitude, toLongitude, requested, NavigationStatus.FETCH_FAILED), keepUsablePath = true)
      return
    }

    beginComputing(request)
    scope.launch {
      try {
        publish(
          request,
          compute(toLatitude, toLongitude, fromLatitude, fromLongitude, requested),
          keepUsablePath = true,
        )
      } finally {
        endComputing(request)
      }
    }
  }

  private fun beginComputing(request: Int) = synchronized(lock) { beginComputingLocked(request) }

  private fun beginComputingLocked(request: Int) {
    if (request != generation) return
    computingRequest = request
    onChange?.invoke(state)
    onWatchChange?.invoke()
  }

  private fun endComputing(request: Int) {
    synchronized(lock) {
      if (computingRequest != request) return
      computingRequest = null
      onChange?.invoke(state)
      onWatchChange?.invoke()
    }
  }

  private suspend fun compute(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double,
    fromLongitude: Double,
    profile: NavigationProfile,
  ): Navigation =
    when (val result = api.route(fromLatitude, fromLongitude, toLatitude, toLongitude, profile.wire)) {
      is DirectionsResult.Failed -> failed(toLatitude, toLongitude, profile, NavigationStatus.FETCH_FAILED)
      is DirectionsResult.NoPath -> failed(toLatitude, toLongitude, profile, NavigationStatus.NO_PATH_FOUND)
      is DirectionsResult.Path ->
        if (NavigationUsability.isUsable(result.points, toLatitude, toLongitude)) {
          Navigation(
            targetLatitude = toLatitude,
            targetLongitude = toLongitude,
            profile = profile,
            computedAtMs = System.currentTimeMillis(),
            distanceMeters = result.distanceMeters,
            durationSeconds = result.durationSeconds,
            status = NavigationStatus.READY,
            points = result.points,
          )
        } else {
          failed(toLatitude, toLongitude, profile, NavigationStatus.NO_PATH_FOUND)
        }
    }

  private fun failed(
    toLatitude: Double,
    toLongitude: Double,
    profile: NavigationProfile,
    status: NavigationStatus,
  ) = Navigation(
    targetLatitude = toLatitude,
    targetLongitude = toLongitude,
    profile = profile,
    computedAtMs = System.currentTimeMillis(),
    status = status,
    distanceMeters = 0.0,
    durationSeconds = 0.0,
    points = emptyList(),
  )

  fun clear() = publish(claimRequest(), null)

  private fun claimRequest(): Int = synchronized(lock) { claimRequestLocked() }

  private fun claimRequestLocked(): Int {
    val wasComputing = computingRequest != null
    computingRequest = null
    ++generation
    if (wasComputing) {
      onChange?.invoke(state)
      onWatchChange?.invoke()
    }
    return generation
  }

  private fun ridePath(navigation: Navigation?): List<Pair<Double, Double>>? =
    navigation?.points?.takeIf { navigation.status == NavigationStatus.READY && it.isNotEmpty() }

  private fun publish(request: Int, navigation: Navigation?, keepUsablePath: Boolean = false, automatic: Boolean = false) {
    synchronized(lock) {
      if (request != generation || state?.copy(revision = 0, automatic = false) == navigation) return
      if (keepUsablePath &&
        navigation?.status != NavigationStatus.READY &&
        state?.status == NavigationStatus.READY
      ) {
        return
      }
      val previousPath = ridePath(state)
      state = navigation?.copy(revision = ++revision, automatic = automatic)
      val previousProgress = progress
      progress = progressAtLatestFix()
      onChange?.invoke(state)
      if (previousProgress != progress) onProgressChange?.invoke(progress)
      val nextPath = ridePath(state)
      if (previousPath != nextPath) onPathChange?.invoke(nextPath)
      onWatchChange?.invoke()
    }
    persist(request)
  }

  private fun persist(request: Int) {
    scope.launch {
      writes.withLock {
        val navigation = synchronized(lock) { if (request != generation) return@withLock else state }
        store.save(navigation)
      }
    }
  }

  private val writes = Mutex()

  companion object {
    private const val AUTOMATIC_MIN_BACKOFF_MS = 30_000L
    private const val AUTOMATIC_MAX_BACKOFF_MS = 300_000L

    @Volatile
    private var instance: NavigationController? = null

    fun get(context: Context): NavigationController = instance ?: synchronized(this) {
      instance ?: NavigationController(
        MapboxDirectionsApi(
          VescapeApi.forOrigin(context, AppStatusCoordinator.serverBaseUrl(context)),
        ),
        AppDataNavigationStore(context.applicationContext),
        loadRerouteDistanceMeters = {
          try {
            AppDataRepository.get(context.applicationContext).getTypedSettings().navigationRerouteDistanceMeters
          } catch (error: CancellationException) {
            throw error
          } catch (error: Exception) {
            RecordingStorageFailure.reportRead("navigation_threshold_read", error)
            DEFAULT_REROUTE_DISTANCE_METERS
          }
        },
      ).also {
        WatchRouteMirror.attach(it, context.applicationContext)
        instance = it
        it.restore()
      }
    }
  }
}
