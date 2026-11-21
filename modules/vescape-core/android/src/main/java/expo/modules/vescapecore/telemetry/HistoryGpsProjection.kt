package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.location.MAX_RECORDING_ACCURACY_M
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt
import expo.modules.vescapecore.database.RideTrackPoint

/**
 * @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `rideTrackPreciseAccuracyCm`
 */
internal val RIDE_TRACK_PRECISE_ACCURACY_CM = (MAX_RECORDING_ACCURACY_M * 100.0).toInt()

internal fun RideTrackPoint.isPrecise(): Boolean =
  accuracyCm != null && accuracyCm <= RIDE_TRACK_PRECISE_ACCURACY_CM

/**
 * @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `rideTrackFixIsMovement`
 */
internal fun RideTrackPoint.isMovementEvidence(movingThresholdCentiKmh: Int): Boolean =
  isPrecise() && gpsSpeedCentiMps != null &&
    gpsSpeedCentiMpsToCentiKmh(gpsSpeedCentiMps) >= movingThresholdCentiKmh

/** @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `gpsSpeedCentiMpsToCentiKmh` */
internal fun gpsSpeedCentiMpsToCentiKmh(centiMps: Int): Int = (centiMps * 36) / 10

internal data class RideTrackProjectionPoint(
  val point: RideTrackPoint,
  val distanceFromPreviousCm: Long?,
  val movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
) {
  // @parity /modules/vescape-core/src/index.ts `HistoryGpsSample`
  // @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `rideTrackGpsMaps`
  fun toSampleMap(boardNames: Map<String, String>): Map<String, Any?> = mapOf(
    "id" to point.id,
    "capturedAtMs" to point.fixAtMs,
    "boardId" to point.boardId,
    "boardName" to (point.boardId?.let { boardNames[it] } ?: UNKNOWN_TELEMETRY_BOARD_NAME),
    "latitude" to point.latitudeE7 / 10_000_000.0,
    "longitude" to point.longitudeE7 / 10_000_000.0,
    "speedMps" to point.gpsSpeedCentiMps?.let { it / 100.0 },
    "bearingDeg" to point.bearingCentiDeg?.let { it / 100.0 },
    "accuracyM" to point.accuracyCm?.let { it / 100.0 },
    "altitudeM" to point.altitudeCm?.let { it / 100.0 },
    "timestamp" to point.fixAtMs,
    "distanceFromPreviousM" to distanceFromPreviousCm?.let { it / 100.0 },
  )

  fun toBucketPoint(): BucketLocationPoint {
    val precise = point.isPrecise()
    return BucketLocationPoint(
      capturedAtMs = point.fixAtMs,
      boardId = point.boardId,
      precise = precise,
      moving = point.isMovementEvidence(movingThresholdCentiKmh),
      distanceFromPreviousCm = distanceFromPreviousCm,
      gpsSpeedCentiMps = point.gpsSpeedCentiMps,
      latitudeE7 = point.latitudeE7.takeIf { precise },
      longitudeE7 = point.longitudeE7.takeIf { precise },
    )
  }
}

internal fun List<RideTrackPoint>.toRideTrackProjection(
  previous: RideTrackPoint? = null,
  movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
): List<RideTrackProjectionPoint> {
  val points = mutableListOf<RideTrackProjectionPoint>()
  val lastByBoard = HashMap<String?, RideTrackPoint>()
  previous?.takeIf { it.isPrecise() }?.let { lastByBoard[it.boardId] = it }
  for (point in this) {
    val precise = point.isPrecise()
    val from = lastByBoard[point.boardId]?.takeIf { precise }
    points.add(
      RideTrackProjectionPoint(point, from?.let { distanceCm(it, point) }, movingThresholdCentiKmh),
    )
    if (precise) lastByBoard[point.boardId] = point
  }
  return points
}

internal fun List<RideTrackPoint>.toGpsSampleMaps(
  boardNames: Map<String, String>,
): List<Map<String, Any?>> = toRideTrackProjection()
  .filter { it.point.isPrecise() }
  .map { it.toSampleMap(boardNames) }

internal fun List<RideTrackPoint>.toBucketLocationPoints(
  previous: RideTrackPoint? = null,
  movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
): List<BucketLocationPoint> =
  toRideTrackProjection(previous, movingThresholdCentiKmh).map { it.toBucketPoint() }

private fun distanceCm(from: RideTrackPoint, to: RideTrackPoint): Long {
  val lat1 = Math.toRadians(from.latitudeE7 / 10_000_000.0)
  val lat2 = Math.toRadians(to.latitudeE7 / 10_000_000.0)
  val deltaLat = lat2 - lat1
  val deltaLon = Math.toRadians((to.longitudeE7 - from.longitudeE7) / 10_000_000.0)
  val a = sin(deltaLat / 2.0) * sin(deltaLat / 2.0) +
    cos(lat1) * cos(lat2) * sin(deltaLon / 2.0) * sin(deltaLon / 2.0)
  val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
  return (6_371_000.0 * c * 100.0).roundToLong()
}
