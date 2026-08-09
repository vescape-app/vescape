package expo.modules.vescapecore.navigation

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

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
  val profile: String,
  val computedAtMs: Long,
  val status: NavigationStatus,
  /** Path points in encoding order, each `(latitude, longitude)`. Empty unless [status] is READY. */
  val points: List<Pair<Double, Double>>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "target" to mapOf("latitude" to targetLatitude, "longitude" to targetLongitude),
    "profile" to profile,
    "computedAtMs" to computedAtMs,
    "status" to status.wire,
    // GeoJSON order, which is what the JS `ShapeSource` expects — flipped from the pairs above.
    "coordinates" to points.map { (latitude, longitude) -> listOf(longitude, latitude) },
  )
}

/**
 * Owns the process's single Navigation. Setting a Direction Point asks for one; clearing the
 * Direction Point ends it. The two are strictly 1:1, so this holds at most one at a time.
 *
 * **There is deliberately no rerouting.** No off-route detection, no recompute, no arrival
 * detection, no automatic retry — not in the foreground and not in the background. EUC riders leave
 * the line by hundreds of metres as a matter of course, and a path that redraws itself under them is
 * worse than a stale one. A failed Navigation stays failed until the rider asks again, which is an
 * ordinary [setTarget] call. Only the rider replaces a Navigation. Please do not add rerouting here.
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
  /** Path points as `(latitude, longitude)`. */
  data class Path(val points: List<Pair<Double, Double>>) : DirectionsResult

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

  val current: Navigation? get() = synchronized(lock) { state }

  /** Notified on every change, including the clear to `null`. */
  var onChange: ((Navigation?) -> Unit)? = null

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
   * This is also the whole of retry: asking again is just setting the same target from wherever the
   * rider is now, which is why there is no separate retry path to keep in step.
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
    // again once the phone has a position is exactly the retry that already exists.
    if (fromLatitude == null || fromLongitude == null) {
      publish(request, failed(toLatitude, toLongitude, NavigationStatus.FETCH_FAILED))
      return
    }

    scope.launch {
      val navigation =
        when (val result = api.route(fromLatitude, fromLongitude, toLatitude, toLongitude, DEFAULT_PROFILE)) {
          is DirectionsResult.Failed -> failed(toLatitude, toLongitude, NavigationStatus.FETCH_FAILED)
          is DirectionsResult.NoPath -> failed(toLatitude, toLongitude, NavigationStatus.NO_PATH_FOUND)
          is DirectionsResult.Path ->
            if (NavigationUsability.isUsable(result.points, toLatitude, toLongitude)) {
              Navigation(
                targetLatitude = toLatitude,
                targetLongitude = toLongitude,
                profile = DEFAULT_PROFILE,
                computedAtMs = System.currentTimeMillis(),
                status = NavigationStatus.READY,
                points = result.points,
              )
            } else {
              failed(toLatitude, toLongitude, NavigationStatus.NO_PATH_FOUND)
            }
        }
      publish(request, navigation)
    }
  }

  private fun failed(
    toLatitude: Double,
    toLongitude: Double,
    status: NavigationStatus,
  ) = Navigation(
    targetLatitude = toLatitude,
    targetLongitude = toLongitude,
    profile = DEFAULT_PROFILE,
    computedAtMs = System.currentTimeMillis(),
    status = status,
    points = emptyList(),
  )

  /** Clearing the Direction Point ends the Navigation; they are strictly 1:1. */
  fun clear() = publish(claimRequest(), null)

  private fun claimRequest(): Int = synchronized(lock) { ++generation }

  /**
   * Commits [navigation] if [request] is still the newest intent, and notifies in that same commit
   * order. The staleness check, the write and the notify are one critical section: splitting them
   * lets a stale result land after a newer one, leaving JS mirroring a path native no longer holds.
   *
   * `onChange` only enqueues an event emit and never calls back into this controller, so holding
   * the lock across it cannot deadlock.
   */
  private fun publish(request: Int, navigation: Navigation?) {
    synchronized(lock) {
      if (request != generation || state == navigation) return
      state = navigation
      onChange?.invoke(navigation)
    }
    persist(request)
  }

  /**
   * Writes whatever is current through to the store, off the caller's thread.
   *
   * It deliberately re-reads [state] instead of taking a value: writes are not ordered against each
   * other, so a write that carried its own stale value could land last and leave storage disagreeing
   * with what native holds. Re-reading makes every write converge on the newest state instead.
   */
  private fun persist(request: Int) {
    val navigation = synchronized(lock) { if (request != generation) return else state }
    scope.launch { store.save(navigation) }
  }

  companion object {
    /** Navigation Profile selection is a later slice; until then every Navigation is walking. */
    private const val DEFAULT_PROFILE = "walking"

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
