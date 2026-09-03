package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.location.MAX_RECORDING_ACCURACY_M
import expo.modules.vescapecore.telemetry.sanitizers.gpsSpeedCentiMpsToKmh
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Reported horizontal accuracy a Ride Track fix must beat to count as a route point or as GPS
 * movement evidence. Read-side, deliberately: every fix is stored with the accuracy the platform
 * reported, and this is the one rule that decides what those numbers are good enough for (ADR 0038).
 * It does not depend on the Android provider identity and does not change live GPS classification.
 *
 * @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `rideTrackPreciseAccuracyCm`
 */
internal val RIDE_TRACK_PRECISE_ACCURACY_CM = (MAX_RECORDING_ACCURACY_M * 100.0).toInt()

/**
 * A fix with no reported accuracy is precise only when it predates durable recording identity.
 * Legacy rows were persisted through the old write-time `precise && freshEnoughToRecord` gate, so a
 * migrated row without `accuracy_cm` was stored *because* it was precise — reading it as imprecise
 * would silently strip route quality the ride actually had. A live fix carries whatever the
 * platform reported, so a missing accuracy there is genuinely unknown and does not count.
 */
internal fun RideTrackPointEntity.isPrecise(): Boolean =
  if (accuracyCm == null) recordingId == null else accuracyCm <= RIDE_TRACK_PRECISE_ACCURACY_CM

/**
 * Does this fix evidence movement? The fix's **own reported speed**, checked after the accuracy
 * rule and against the rider's movement threshold — never a speed derived from the displacement
 * between two coordinates, which turns GPS scatter into a phantom ride. A fix with no reported
 * speed is not movement evidence, but stays a perfectly good route point (ADR 0038).
 *
 * @parity /modules/vescape-core/ios/telemetry/RideTrackProjection.swift `rideTrackFixIsMovement`
 */
internal fun RideTrackPointEntity.isMovementEvidence(movingThresholdCentiKmh: Int): Boolean =
  isPrecise() && gpsSpeedCentiMps != null &&
    gpsSpeedCentiMpsToKmh(gpsSpeedCentiMps) >= movingThresholdCentiKmh

/** One Ride Track fix with the distance from the fix before it, which is a sequence property. */
internal data class RideTrackProjectionPoint(
  val point: RideTrackPointEntity,
  val distanceFromPreviousCm: Long?,
  val movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
) {
  /** [boardNames] resolves `boards.id` -> name on read; the row never carried one (ADR 0028). */
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

  fun toBucketPoint(): BucketLocationPoint = BucketLocationPoint(
    capturedAtMs = point.fixAtMs,
    boardId = point.boardId,
    recordingId = point.recordingId ?: LEGACY_RIDE_RECORDING_ID,
    precise = point.isPrecise(),
    moving = point.isMovementEvidence(movingThresholdCentiKmh),
    distanceFromPreviousCm = distanceFromPreviousCm,
    gpsSpeedCentiMps = point.gpsSpeedCentiMps,
    latitudeE7 = point.latitudeE7.takeIf { point.isPrecise() },
    longitudeE7 = point.longitudeE7.takeIf { point.isPrecise() },
  )
}

/**
 * Project a Ride Track into points carrying their step distance. [previous] continues the sequence
 * across a batch boundary so the first fix of a flush is not silently free of distance.
 *
 * Distance is only measured between two **qualifying** fixes of the same Ride Recording **and the
 * same Board**. Legacy rows carry no recording, so recording equality alone would chain every
 * migrated fix to every other one regardless of Board; the predecessor is therefore tracked per
 * Board, exactly as the frame columns this replaced did.
 */
internal fun List<RideTrackPointEntity>.toRideTrackProjection(
  previous: RideTrackPointEntity? = null,
  movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
): List<RideTrackProjectionPoint> {
  val points = mutableListOf<RideTrackProjectionPoint>()
  val lastByBoard = HashMap<String?, RideTrackPointEntity>()
  previous?.takeIf { it.isPrecise() }?.let { lastByBoard[it.boardId] = it }
  for (point in this) {
    val precise = point.isPrecise()
    val from = lastByBoard[point.boardId]
      ?.takeIf { precise && it.recordingId == point.recordingId }
    points.add(
      RideTrackProjectionPoint(point, from?.let { distanceCm(it, point) }, movingThresholdCentiKmh),
    )
    if (precise) lastByBoard[point.boardId] = point
  }
  return points
}

/**
 * The Ride Track as JS reads it: the route stream.
 *
 * Only fixes that pass the shared read-side precision rule cross the bridge. A poor fix stays in
 * storage — that is the whole point of ADR 0038's write-everything decision — but it never draws a
 * route, never anchors a marker and never contributes a step distance, so the rule is applied
 * exactly once, here, instead of in every JS consumer.
 */
internal fun List<RideTrackPointEntity>.toGpsSampleMaps(
  boardNames: Map<String, String>,
): List<Map<String, Any?>> = toRideTrackProjection()
  .filter { it.point.isPrecise() }
  .map { it.toSampleMap(boardNames) }

/**
 * The same projection, as the minute-bucket location contribution. Every stored fix is counted, so
 * `gpsPointCount` stays an honest measure of what was captured, but only qualifying fixes derive
 * anything: the bucket's route anchor, its step distances and its GPS movement evidence.
 */
internal fun List<RideTrackPointEntity>.toBucketLocationPoints(
  previous: RideTrackPointEntity? = null,
  movingThresholdCentiKmh: Int = DEFAULT_MOVING_SPEED_THRESHOLD_CENTI_KMH,
): List<BucketLocationPoint> =
  toRideTrackProjection(previous, movingThresholdCentiKmh).map { it.toBucketPoint() }

private fun distanceCm(from: RideTrackPointEntity, to: RideTrackPointEntity): Long {
  val lat1 = Math.toRadians(from.latitudeE7 / 10_000_000.0)
  val lat2 = Math.toRadians(to.latitudeE7 / 10_000_000.0)
  val deltaLat = lat2 - lat1
  val deltaLon = Math.toRadians((to.longitudeE7 - from.longitudeE7) / 10_000_000.0)
  val a = sin(deltaLat / 2.0) * sin(deltaLat / 2.0) +
    cos(lat1) * cos(lat2) * sin(deltaLon / 2.0) * sin(deltaLon / 2.0)
  val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
  return (6_371_000.0 * c * 100.0).roundToLong()
}
