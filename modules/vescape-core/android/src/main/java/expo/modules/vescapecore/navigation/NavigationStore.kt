package expo.modules.vescapecore.navigation

import android.content.Context
import kotlinx.coroutines.CancellationException
import expo.modules.vescapecore.recording.RecordingStorageFailure
import expo.modules.vescapecore.telemetry.AppDataRepository
import org.json.JSONObject

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationStore.swift `NavigationStore`
 */
interface NavigationStore {
  suspend fun load(): Navigation?

  suspend fun save(navigation: Navigation?)

  suspend fun directionPoint(): Pair<Double, Double>?

  suspend fun loadProfile(): NavigationProfile?

  suspend fun saveProfile(profile: NavigationProfile)
}

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationStore.swift `NavigationJson`
 */
object NavigationJson {
  private const val TARGET_LATITUDE = "targetLatitude"
  private const val TARGET_LONGITUDE = "targetLongitude"
  private const val PROFILE = "profile"
  private const val COMPUTED_AT_MS = "computedAtMs"
  private const val STATUS = "status"
  private const val GEOMETRY = "geometry"
  private const val DISTANCE_METERS = "distanceMeters"
  private const val DURATION_SECONDS = "durationSeconds"

  fun encode(navigation: Navigation): String = JSONObject()
    .put(TARGET_LATITUDE, navigation.targetLatitude)
    .put(TARGET_LONGITUDE, navigation.targetLongitude)
    .put(PROFILE, navigation.profile.wire)
    .put(COMPUTED_AT_MS, navigation.computedAtMs)
    .put(STATUS, navigation.status.wire)
    .put(DISTANCE_METERS, navigation.distanceMeters)
    .put(DURATION_SECONDS, navigation.durationSeconds)
    .put(GEOMETRY, Polyline6.encode(navigation.points))
    .toString()

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
        profile = NavigationProfile.fromWire(stored.optString(PROFILE)),
        computedAtMs = stored.getLong(COMPUTED_AT_MS),
        status = status,
        distanceMeters = stored.optDouble(DISTANCE_METERS, 0.0),
        durationSeconds = stored.optDouble(DURATION_SECONDS, 0.0),
        points = points,
      )
    }
  } catch (_: Exception) {
    null
  }
}

/**
 * @parity /modules/vescape-core/ios/navigation/NavigationStore.swift `AppDataNavigationStore`
 */
class AppDataNavigationStore(context: Context) : NavigationStore {
  private val repository = AppDataRepository.get(context.applicationContext)

  override suspend fun load(): Navigation? = try {
    repository.getNavigationPath()?.let(NavigationJson::decode)
  } catch (error: CancellationException) {
    throw error
  } catch (error: Exception) {
    RecordingStorageFailure.reportRead("navigation_path_read", error)
    null
  }

  override suspend fun save(navigation: Navigation?) {
    try {
      repository.setNavigationPath(navigation?.let(NavigationJson::encode))
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      RecordingStorageFailure.report("navigation_path_save", "write_failed", error)
    }
  }

  override suspend fun directionPoint(): Pair<Double, Double>? = repository.getDirectionPoint()

  override suspend fun loadProfile(): NavigationProfile? = try {
    repository.getNavigationProfile()?.let(NavigationProfile::fromWire)
  } catch (error: CancellationException) {
    throw error
  } catch (error: Exception) {
    RecordingStorageFailure.reportRead("navigation_profile_read", error)
    null
  }

  override suspend fun saveProfile(profile: NavigationProfile) {
    try {
      repository.setNavigationProfile(profile.wire)
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      RecordingStorageFailure.report("navigation_profile_save", "write_failed", error)
    }
  }
}
