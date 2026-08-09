package expo.modules.vescapecore.navigation

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

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
  /** Path points in encoding order, each `(latitude, longitude)`. */
  val points: List<Pair<Double, Double>>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "target" to mapOf("latitude" to targetLatitude, "longitude" to targetLongitude),
    "profile" to profile,
    "computedAtMs" to computedAtMs,
    // GeoJSON order, which is what the JS `ShapeSource` expects — flipped from the pairs above.
    "coordinates" to points.map { (latitude, longitude) -> listOf(longitude, latitude) },
  )
}

/**
 * Owns the process's single Navigation. Setting a Direction Point asks for one; clearing the
 * Direction Point ends it. The two are strictly 1:1, so this holds at most one at a time.
 *
 * **There is deliberately no rerouting.** No off-route detection, no recompute, no arrival
 * detection, no retry. EUC riders leave the line by hundreds of metres as a matter of course, and a
 * path that redraws itself under them is worse than a stale one. Only the rider replaces a
 * Navigation. Please do not add rerouting here.
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
  /** Path points as `(latitude, longitude)`, or `null` when no route could be produced. */
  suspend fun route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String,
  ): List<Pair<Double, Double>>?
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
   * rider position or a failed fetch yields no Navigation rather than a straight line.
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
    if (fromLatitude == null || fromLongitude == null) return

    scope.launch {
      val points = api.route(fromLatitude, fromLongitude, toLatitude, toLongitude, DEFAULT_PROFILE)
      publish(
        request,
        points?.let {
          Navigation(
            targetLatitude = toLatitude,
            targetLongitude = toLongitude,
            profile = DEFAULT_PROFILE,
            computedAtMs = System.currentTimeMillis(),
            points = it,
          )
        },
      )
    }
  }

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
