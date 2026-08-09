package expo.modules.vescapecore.navigation

import android.content.Context
import java.util.concurrent.atomic.AtomicInteger

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
 * In-memory only for now: it survives JS reloads but not a process restart. Persistence is a later
 * slice.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationController.swift
 */
class NavigationController(private val api: MapboxDirectionsApi) {
  @Volatile
  var current: Navigation? = null
    private set

  /** Notified on every change, including the clear to `null`. */
  var onChange: ((Navigation?) -> Unit)? = null

  /**
   * Requests generate a token so a slower earlier fetch cannot overwrite a newer Direction Point —
   * the rider tapping twice in a second must end up with the second path, not whichever call the
   * network happened to finish last.
   */
  private val generation = AtomicInteger(0)

  /**
   * Computes the Navigation to [toLatitude]/[toLongitude] from the rider's position. A missing
   * rider position or a failed fetch yields no Navigation rather than a straight line.
   */
  suspend fun setTarget(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?,
  ) {
    val request = generation.incrementAndGet()
    if (fromLatitude == null || fromLongitude == null) {
      publish(request, null)
      return
    }

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

  /** Clearing the Direction Point ends the Navigation; they are strictly 1:1. */
  fun clear() = publish(generation.incrementAndGet(), null)

  private fun publish(request: Int, navigation: Navigation?) {
    if (request != generation.get()) return
    current = navigation
    onChange?.invoke(navigation)
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
      ).also { instance = it }
    }
  }
}
