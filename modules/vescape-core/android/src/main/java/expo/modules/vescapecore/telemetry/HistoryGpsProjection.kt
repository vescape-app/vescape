package expo.modules.vescapecore.telemetry

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

internal data class HistoryGpsPoint(
  val sample: HistoryTelemetryState,
  val location: ScaledLocation,
  val distanceFromPreviousCm: Long?,
) {
  /** [boardNames] resolves `boards.id` -> name on read; the row never carried one (ADR 0028). */
  fun toSampleMap(boardNames: Map<String, String>): Map<String, Any?> {
    val telemetry = sample.state
    return mapOf(
      "id" to sample.id,
      "capturedAtMs" to telemetry.capturedAtMs,
      "boardId" to telemetry.boardId,
      "boardName" to (telemetry.boardId?.let { boardNames[it] } ?: UNKNOWN_TELEMETRY_BOARD_NAME),
      "latitude" to location.latitudeE7 / 10_000_000.0,
      "longitude" to location.longitudeE7 / 10_000_000.0,
      "speedMps" to location.gpsSpeedCentiMps?.let { it / 100.0 },
      "bearingDeg" to location.bearingCentiDeg?.let { it / 100.0 },
      "accuracyM" to location.accuracyCm?.let { it / 100.0 },
      "altitudeM" to location.altitudeCm?.let { it / 100.0 },
      "timestamp" to location.timestampMs,
      "precise" to true,
      "distanceFromPreviousM" to distanceFromPreviousCm?.let { it / 100.0 },
    )
  }

  fun toBucketPoint(): BucketLocationPoint {
    val telemetry = sample.state
    return BucketLocationPoint(
      capturedAtMs = telemetry.capturedAtMs,
      boardId = telemetry.boardId,
      precise = true,
      distanceFromPreviousCm = distanceFromPreviousCm,
      gpsSpeedCentiMps = location.gpsSpeedCentiMps,
      latitudeE7 = location.latitudeE7,
      longitudeE7 = location.longitudeE7,
    )
  }
}

internal fun List<HistoryTelemetryState>.toHistoryGpsPoints(): List<HistoryGpsPoint> {
  val points = mutableListOf<HistoryGpsPoint>()
  var previousLocation: ScaledLocation? = null
  var previousEmitted: ScaledLocation? = null

  for (sample in this) {
    val location = sample.state.location ?: continue
    if (previousEmitted != null &&
      previousEmitted.timestampMs == location.timestampMs &&
      previousEmitted.latitudeE7 == location.latitudeE7 &&
      previousEmitted.longitudeE7 == location.longitudeE7
    ) {
      previousLocation = location
      continue
    }
    points.add(
      HistoryGpsPoint(
        sample = sample,
        location = location,
        distanceFromPreviousCm = previousLocation?.let { distanceCm(it, location) },
      ),
    )
    previousLocation = location
    previousEmitted = location
  }
  return points
}

internal fun List<HistoryTelemetryState>.toGpsSampleMaps(
  boardNames: Map<String, String>,
): List<Map<String, Any?>> = toHistoryGpsPoints().map { it.toSampleMap(boardNames) }

internal fun List<HistoryTelemetryState>.toBucketLocationPoints(): List<BucketLocationPoint> =
  toHistoryGpsPoints().map { it.toBucketPoint() }

private fun distanceCm(from: ScaledLocation, to: ScaledLocation): Long {
  val lat1 = Math.toRadians(from.latitudeE7 / 10_000_000.0)
  val lat2 = Math.toRadians(to.latitudeE7 / 10_000_000.0)
  val deltaLat = lat2 - lat1
  val deltaLon = Math.toRadians((to.longitudeE7 - from.longitudeE7) / 10_000_000.0)
  val a = sin(deltaLat / 2.0) * sin(deltaLat / 2.0) +
    cos(lat1) * cos(lat2) * sin(deltaLon / 2.0) * sin(deltaLon / 2.0)
  val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
  return (6_371_000.0 * c * 100.0).roundToLong()
}
