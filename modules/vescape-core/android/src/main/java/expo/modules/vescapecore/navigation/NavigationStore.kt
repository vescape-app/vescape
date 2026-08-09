package expo.modules.vescapecore.navigation

import android.content.Context
import expo.modules.vescapecore.telemetry.AppDataRepository
import org.json.JSONObject

/**
 * Durable home for the one Navigation, and for the Direction Point it must still agree with.
 *
 * A seam rather than a direct repository call, so [NavigationController]'s restore and staleness
 * rules are testable without a database.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationStore.swift `NavigationStore`
 */
interface NavigationStore {
  /** The stored Navigation, or `null` when none was ever written or the row is unreadable. */
  suspend fun load(): Navigation?

  /** Replaces the stored Navigation. `null` erases it. */
  suspend fun save(navigation: Navigation?)

  /**
   * The current Direction Point as `(latitude, longitude)`. A restored path is only usable while it
   * still leads here.
   */
  suspend fun directionPoint(): Pair<Double, Double>?
}

/**
 * Wire form of a stored Navigation. The path rides as its `polyline6` body rather than as a
 * coordinate array: for an 83 km walking route (3802 points) that is 14.5 KB against 81 KB of
 * `[longitude, latitude]` JSON, a 5.6x saving on the largest value the app stores.
 *
 * Kept a plain string-in, string-out codec so it is testable without a database, and so the stored
 * form stays a value a later slice can ship over the Group Ride relay unchanged.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationStore.swift `NavigationJson`
 */
object NavigationJson {
  private const val TARGET_LATITUDE = "targetLatitude"
  private const val TARGET_LONGITUDE = "targetLongitude"
  private const val PROFILE = "profile"
  private const val COMPUTED_AT_MS = "computedAtMs"
  private const val STATUS = "status"
  private const val GEOMETRY = "geometry"

  fun encode(navigation: Navigation): String = JSONObject()
    .put(TARGET_LATITUDE, navigation.targetLatitude)
    .put(TARGET_LONGITUDE, navigation.targetLongitude)
    .put(PROFILE, navigation.profile)
    .put(COMPUTED_AT_MS, navigation.computedAtMs)
    .put(STATUS, navigation.status.wire)
    .put(GEOMETRY, Polyline6.encode(navigation.points))
    .toString()

  /**
   * Parses [json], or returns `null` when it is malformed. A failed Navigation is stored and
   * restored like any other: the rider comes back to the same "no path here, retry?" they left,
   * never to a spinner and never to a line that was never computed.
   *
   * A `ready` row with no points is a contradiction and is dropped — the rider can set the pin
   * again. Rows written before the status existed always carried points, so their missing key
   * defaults to `ready`.
   */
  fun decode(json: String): Navigation? = try {
    val stored = JSONObject(json)
    val status = NavigationStatus.fromWire(stored.optString(STATUS).takeIf { it.isNotEmpty() })
    val points = Polyline6.decode(stored.optString(GEOMETRY))
    if (status == NavigationStatus.READY && points.isEmpty()) {
      null
    } else {
      Navigation(
        targetLatitude = stored.getDouble(TARGET_LATITUDE),
        targetLongitude = stored.getDouble(TARGET_LONGITUDE),
        profile = stored.getString(PROFILE),
        computedAtMs = stored.getLong(COMPUTED_AT_MS),
        status = status,
        points = points,
      )
    }
  } catch (_: Exception) {
    null
  }
}

/**
 * The real store: one App Settings row next to the Direction Point's own two. No schema migration —
 * App Settings are key/value rows, not columns — and the row is deliberately outside the settings
 * projection JS mirrors, so a 14 KB path never rides along on an unrelated settings read.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationStore.swift `AppDataNavigationStore`
 */
class AppDataNavigationStore(context: Context) : NavigationStore {
  private val repository = AppDataRepository.get(context.applicationContext)

  override suspend fun load(): Navigation? = repository.getNavigationPath()?.let(NavigationJson::decode)

  override suspend fun save(navigation: Navigation?) =
    repository.setNavigationPath(navigation?.let(NavigationJson::encode))

  override suspend fun directionPoint(): Pair<Double, Double>? = repository.getDirectionPoint()
}
