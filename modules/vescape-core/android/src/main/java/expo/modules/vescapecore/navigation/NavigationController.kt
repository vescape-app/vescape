package expo.modules.vescapecore.navigation

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * How a Navigation ended up. A Navigation exists for as long as its Direction Point does, so a
 * request that produced no path is still a Navigation — one that says why instead of drawing a line.
 * JS must never have to infer failure from an empty coordinate array.
 *
 * The two failures are told apart because they are different rider situations, and will likely want
 * different copy: [FETCH_FAILED] is worth retrying once the signal comes back, [NO_PATH_FOUND] is
 * not going to change by trying again from the same spot.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationStatus`
 * @parity /modules/vescape-core/src/index.ts `NavigationStatus`
 */
enum class NavigationStatus(val wire: String) {
  /** A usable path was computed and is in `points`. */
  READY("ready"),

  /** Could not ask: no signal, timeout, HTTP error, missing token. `points` is empty. */
  FETCH_FAILED("fetchFailed"),

  /** Asked and answered, but nothing rideable leads there. `points` is empty. */
  NO_PATH_FOUND("noPathFound");

  companion object {
    fun fromWire(wire: String?): NavigationStatus =
      entries.firstOrNull { it.wire == wire } ?: READY
  }
}

/**
 * The kind of ways a Navigation may follow. The rider picks it while looking at a path, and the
 * choice sticks as the default for the next one.
 *
 * The wire strings are Mapbox Directions profile names and go into the request path unchanged, so
 * they are a contract with the routing service as much as with JS.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `NavigationProfile`
 * @parity /modules/vescape-core/src/index.ts `NavigationProfile`
 */
enum class NavigationProfile(val wire: String) {
  /** Reaches footpaths and forest tracks, which is where Direction Points usually are. */
  WALKING("walking"),

  /** Cycleways and roads; refuses footpaths. */
  CYCLING("cycling"),

  /** Roads only. */
  DRIVING("driving");

  companion object {
    /**
     * What a rider who has never chosen gets. `CYCLING` would refuse footpaths and hit the no-path
     * state constantly, so the widest-reaching profile leads.
     */
    val DEFAULT = WALKING

    fun fromWire(wire: String?): NavigationProfile =
      entries.firstOrNull { it.wire == wire } ?: DEFAULT
  }
}

/**
 * A rideable path from the rider to their Direction Point, following real ways. Computed once and
 * then fixed: nothing here recomputes, reroutes, or reacts to the rider moving.
 *
 * It is a plain value with no behaviour on it, because a later slice shares it over Group Ride.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `Navigation`
 * @parity /modules/vescape-core/src/index.ts `Navigation`
 */
data class Navigation(
  val targetLatitude: Double,
  val targetLongitude: Double,
  /** The Navigation Profile this path was produced under; it never changes for this Navigation. */
  val profile: NavigationProfile,
  val computedAtMs: Long,
  val status: NavigationStatus,
  /**
   * How far the path runs, in metres, and how long the routing service thinks it takes, in seconds.
   * Both are `0.0` unless [status] is READY — a Navigation with no path has no length to report.
   *
   * The duration is the profile's own estimate (a walking path is timed at walking pace), so it is
   * the shape of the ride ahead rather than an EUC arrival time.
   */
  val distanceMeters: Double,
  val durationSeconds: Double,
  /** Path points in encoding order, each `(latitude, longitude)`. Empty unless [status] is READY. */
  val points: List<Pair<Double, Double>>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "target" to mapOf("latitude" to targetLatitude, "longitude" to targetLongitude),
    "profile" to profile.wire,
    "computedAtMs" to computedAtMs,
    "status" to status.wire,
    "distanceMeters" to distanceMeters,
    "durationSeconds" to durationSeconds,
    // GeoJSON order, which is what the JS `ShapeSource` expects — flipped from the pairs above.
    "coordinates" to points.map { (latitude, longitude) -> listOf(longitude, latitude) },
  )
}

/**
 * Owns the process's single Navigation. Setting a Direction Point asks for one; clearing the
 * Direction Point ends it. The two are strictly 1:1, so this holds at most one at a time.
 *
 * **There is deliberately no rerouting.** No off-route detection, no arrival detection, no automatic
 * retry — not in the foreground and not in the background. EUC riders leave the line by hundreds of
 * metres as a matter of course, and a path that redraws itself under them is worse than a stale one.
 * A failed Navigation stays failed until the rider asks again, which is a [recompute] call made from
 * a rider's tap. Only the rider replaces a Navigation. Please do not add rerouting here.
 *
 * Durable: every change is written through to [NavigationStore], and [restore] brings the stored
 * path back on cold start. Restoring is a read, never a fetch — the stored path is the truth however
 * old it is, so a path computed last weekend is still the path.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift
 */
/**
 * The one thing [NavigationController] needs from a routing service. A seam, so the controller's
 * ordering guarantees are testable without a network.
 *
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
 * What one Directions call produced. "Could not ask" and "asked, nothing leads there" are separate
 * cases all the way down, because the rider's options differ: one is worth retrying, the other is
 * the honest answer for that pin.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift `DirectionsResult`
 */
sealed interface DirectionsResult {
  /** Path points as `(latitude, longitude)`, with the service's own length and time for them. */
  data class Path(
    val points: List<Pair<Double, Double>>,
    val distanceMeters: Double,
    val durationSeconds: Double,
  ) : DirectionsResult

  /** The service answered, but returned nothing rideable. */
  object NoPath : DirectionsResult

  /** The service could not be reached or asked at all. */
  object Failed : DirectionsResult
}

class NavigationController(
  private val api: DirectionsRoutes,
  private val store: NavigationStore,
  private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
  private val lock = Any()

  private var state: Navigation? = null

  /**
   * The Navigation Profile the next computed path will use — the rider's last choice, cached here so
   * [setTarget] can read it without waiting on a database. Seeded from the store by [restore].
   *
   * It is not the profile of the drawn path: a recompute that failed leaves the old path drawn under
   * a newer choice, and the path keeps carrying the profile that actually produced it.
   */
  private var profile: NavigationProfile = NavigationProfile.DEFAULT

  /** Set once the rider has chosen, so a slow [restore] cannot overwrite a newer choice. */
  private var profileChosen = false

  val current: Navigation? get() = synchronized(lock) { state }

  /**
   * How many Directions calls are in flight. A rider who taps two profiles in a row has two, and
   * the rider is "waiting for a path" until the last of them lands — hence a count and not a flag.
   */
  private var inFlight = 0

  /**
   * Whether a path is being computed right now. The one piece of Navigation state that is not
   * durable: a request in flight dies with the process, and a cold start is never waiting.
   *
   * It exists because the alternative reads as a broken app. A recompute that fails leaves the old
   * path in place and publishes nothing, so without this the rider taps a Profile and sees the UI
   * do nothing at all for fifteen seconds.
   */
  val computing: Boolean get() = synchronized(lock) { inFlight > 0 }

  /** Notified on every change, including the clear to `null` and every [computing] transition. */
  var onChange: ((Navigation?) -> Unit)? = null

  /**
   * Where the rider is along the current path. Derived and never stored: recomputed by [onFix] and
   * dropped whenever the Navigation it belongs to changes, so there is no cache to expire by hand.
   */
  private var progress: RouteProgress? = null

  val currentProgress: RouteProgress? get() = synchronized(lock) { progress }

  /** Notified on every Route Progress change, including the clear to `null`. */
  var onProgressChange: ((RouteProgress?) -> Unit)? = null

  /**
   * A GPS Fix arrived. Recomputes Route Progress against the current path and notifies when it
   * moved. This is the *only* thing a fix does to a Navigation: it does not recompute, reroute or
   * retry the path itself.
   *
   * A fix with no usable path publishes `null` rather than keeping the last position, so nothing
   * downstream can show progress along a path that is gone.
   */
  fun onFix(latitude: Double, longitude: Double, speedMps: Double?) {
    synchronized(lock) {
      val points = state?.takeIf { it.status == NavigationStatus.READY }?.points
      val next = points?.let { RouteProgress.compute(it, latitude, longitude, speedMps) }
      if (progress == next) return
      progress = next
      onProgressChange?.invoke(next)
    }
  }

  /**
   * Ordering token. Every intent claims one *synchronously*, before any network work starts, so the
   * rider's last action always wins: a fetch that resolves late finds its token stale and is
   * dropped rather than resurrecting a path over a newer target or over a clear.
   *
   * Claiming it inside the coroutine instead would order requests by whenever the dispatcher
   * happened to run them, which is not the order the rider tapped in.
   */
  private var generation = 0

  /**
   * Cold start: brings the stored Navigation back, without touching the network.
   *
   * Claims a token like any other intent, so a rider who taps a new Direction Point while the read
   * is still in flight wins over the restore rather than being overwritten by yesterday's path.
   *
   * Returns immediately; the read runs on this controller's own scope.
   */
  fun restore() {
    val request = claimRequest()
    scope.launch {
      store.loadProfile()?.let { stored ->
        // The rider may have switched while this read was in flight; their choice is the newer one.
        synchronized(lock) { if (!profileChosen) profile = stored }
      }
      val stored = store.load() ?: return@launch
      val directionPoint = store.directionPoint()
      // The two are written separately, so an interrupted write can leave a path leading somewhere
      // the rider is no longer heading. Drawing a line to the wrong place is worse than drawing none.
      val usable = stored.takeIf {
        directionPoint != null &&
          it.targetLatitude == directionPoint.first &&
          it.targetLongitude == directionPoint.second
      }
      publish(request, usable)
      // `publish(null)` changed nothing here — nothing had been published yet — so the disagreeing
      // row has to be dropped explicitly, or every later start would re-read and re-reject it.
      if (usable == null) persist(request)
    }
  }

  /**
   * Computes the Navigation to [toLatitude]/[toLongitude] from the rider's position. A missing
   * rider position, a failed fetch or a path nothing could ride yields a Navigation carrying the
   * reason rather than a straight line — see [NavigationStatus].
   *
   * Uses the rider's sticky Navigation Profile. Asking for the same target again is [recompute],
   * which keeps a working path when the new request fails; this one always replaces, because the
   * target moved and the old path is already wrong.
   *
   * Returns immediately: the Directions call runs on this controller's own scope, so callers never
   * block the rider's tap on the network.
   */
  fun setTarget(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?,
  ) {
    val request = claimRequest()
    // The previous path led to the previous Direction Point, so it is already wrong. Drop it now
    // rather than leaving a stale line drawn under a pin that has visibly moved — a Navigation
    // belongs to exactly one Direction Point.
    publish(request, null)

    // No fix yet is a "could not ask", not a "nothing leads there": the rider is told, and asking
    // again once the phone has a position is exactly what [recompute] does.
    if (fromLatitude == null || fromLongitude == null) {
      publish(request, failed(toLatitude, toLongitude, currentProfile, NavigationStatus.FETCH_FAILED))
      return
    }

    val requested = currentProfile
    beginComputing()
    scope.launch {
      try {
        publish(request, compute(toLatitude, toLongitude, fromLatitude, fromLongitude, requested))
      } finally {
        endComputing()
      }
    }
  }

  /** The Navigation Profile the next computed path will use. */
  val currentProfile: NavigationProfile get() = synchronized(lock) { profile }

  /**
   * Remembers [next] as the rider's Navigation Profile without touching the current path. Switching
   * profile is [selectProfile] followed by [recompute]; on its own this only moves the default the
   * next Navigation will be computed under.
   *
   * The choice is stored even when the recompute that follows it fails: the rider chose it, and
   * "last choice wins" is about the choice, not about whether that one request found a path.
   */
  fun selectProfile(next: NavigationProfile) {
    synchronized(lock) {
      if (profile == next && profileChosen) return
      profile = next
      // A restore still in flight must not undo this with yesterday's value.
      profileChosen = true
    }
    scope.launch {
      // Same converge rule as [persist]: serialized, and re-read after acquiring so the last write
      // to run saves the rider's latest choice however the taps interleaved.
      writes.withLock { store.saveProfile(currentProfile) }
    }
  }

  /**
   * The rider asking for a fresh path to the Direction Point they already have, from where they are
   * now. This is the *only* way a Navigation is replaced once computed — nothing may call it on a
   * timer, on reconnect or on a new fix.
   *
   * Unlike [setTarget] it does not drop the current path first, and a request that produces no path
   * is discarded while a usable one is already drawn: losing a working line by asking for a better
   * one is a bad trade. The rider is told nothing changed by the line simply staying put.
   */
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

    beginComputing()
    scope.launch {
      try {
        publish(
          request,
          compute(toLatitude, toLongitude, fromLatitude, fromLongitude, requested),
          keepUsablePath = true,
        )
      } finally {
        endComputing()
      }
    }
  }

  /**
   * Bracket around one in-flight Directions call. Both ends notify, because [computing] is part of
   * what JS mirrors: the spinner has to come on before the fetch and go off after the result has
   * already been published, or the rider sees a gap between the two.
   */
  private fun beginComputing() = changeInFlight(1)

  private fun endComputing() = changeInFlight(-1)

  private fun changeInFlight(delta: Int) {
    synchronized(lock) {
      val was = inFlight > 0
      inFlight = (inFlight + delta).coerceAtLeast(0)
      if (was != (inFlight > 0)) onChange?.invoke(state)
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

  /** Clearing the Direction Point ends the Navigation; they are strictly 1:1. */
  fun clear() = publish(claimRequest(), null)

  private fun claimRequest(): Int = synchronized(lock) { ++generation }

  /**
   * Commits [navigation] if [request] is still the newest intent — and, when [keepUsablePath] is
   * set, only if it is not a downgrade from a drawn path to a failure — and notifies in that same
   * commit order. The staleness check, the write and the notify are one critical section: splitting them
   * lets a stale result land after a newer one, leaving JS mirroring a path native no longer holds.
   *
   * `onChange` only enqueues an event emit and never calls back into this controller, so holding
   * the lock across it cannot deadlock.
   */
  private fun publish(request: Int, navigation: Navigation?, keepUsablePath: Boolean = false) {
    synchronized(lock) {
      if (request != generation || state == navigation) return
      // A recompute that found nothing must not take away a path the rider can still ride. Checked
      // in here rather than at the call site so the read of `state` and the write are one step.
      if (keepUsablePath &&
        navigation?.status != NavigationStatus.READY &&
        state?.status == NavigationStatus.READY
      ) {
        return
      }
      state = navigation
      // Route Progress belongs to exactly one Navigation, so it dies with the one being replaced
      // rather than describing a path that is no longer drawn. The next fix refills it.
      val hadProgress = progress != null
      progress = null
      onChange?.invoke(navigation)
      if (hadProgress) onProgressChange?.invoke(null)
    }
    persist(request)
  }

  /**
   * Writes whatever is current through to the store, off the caller's thread.
   *
   * Two things make storage converge on what native holds rather than on whichever write happened to
   * finish last. Writes are serialized through [writes], so they land in the order they acquire it;
   * and each one re-reads [state] *after* acquiring rather than carrying a value, so the last write
   * to run necessarily saves the newest state. Either alone leaves a stale row behind: unordered
   * writes can land out of order, and a carried value can be stale before its turn comes.
   */
  private fun persist(request: Int) {
    scope.launch {
      writes.withLock {
        val navigation = synchronized(lock) { if (request != generation) return@withLock else state }
        store.save(navigation)
      }
    }
  }

  /**
   * Serializes every write to [store] — the path and the sticky profile alike. Two rows, one order:
   * a profile write overtaking an older one would leave the rider's second choice undone by their
   * first on the next start.
   */
  private val writes = Mutex()

  companion object {
    @Volatile
    private var instance: NavigationController? = null

    /** Process singleton — the Navigation must outlive JS runtime reloads. */
    fun get(context: Context): NavigationController = instance ?: synchronized(this) {
      instance ?: NavigationController(
        MapboxDirectionsApi(MapboxDirectionsApi.accessToken(context.applicationContext)),
        AppDataNavigationStore(context.applicationContext),
      ).also {
        instance = it
        // Restore here rather than from the module, so a JS reload — which recreates the module but
        // not this singleton — cannot re-run it over a Navigation the rider has since replaced.
        it.restore()
      }
    }
  }
}
