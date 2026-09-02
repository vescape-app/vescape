package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.location.MAX_RECORDING_ACCURACY_M
import expo.modules.vescapecore.protocol.TELEMETRY_LOCATION_MAX_AGE_MS
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

internal fun RideTrackPointEntity.isPrecise(): Boolean =
  accuracyCm != null && accuracyCm <= RIDE_TRACK_PRECISE_ACCURACY_CM

/** One Ride Track fix with the distance from the fix before it, which is a sequence property. */
internal data class RideTrackProjectionPoint(
  val point: RideTrackPointEntity,
  val distanceFromPreviousCm: Long?,
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
    "precise" to point.isPrecise(),
    "distanceFromPreviousM" to distanceFromPreviousCm?.let { it / 100.0 },
  )

  fun toBucketPoint(): BucketLocationPoint = BucketLocationPoint(
    capturedAtMs = point.fixAtMs,
    boardId = point.boardId,
    recordingId = point.recordingId ?: LEGACY_RIDE_RECORDING_ID,
    precise = point.isPrecise(),
    distanceFromPreviousCm = distanceFromPreviousCm,
    gpsSpeedCentiMps = point.gpsSpeedCentiMps,
    latitudeE7 = point.latitudeE7,
    longitudeE7 = point.longitudeE7,
  )
}

/**
 * Project a Ride Track into points carrying their step distance. [previous] continues the sequence
 * across a batch boundary so the first fix of a flush is not silently free of distance.
 *
 * Distance is only measured between two fixes of the same Ride Recording. Legacy rows carry no
 * recording, so they chain among themselves exactly as their frames used to.
 */
internal fun List<RideTrackPointEntity>.toRideTrackProjection(
  previous: RideTrackPointEntity? = null,
): List<RideTrackProjectionPoint> {
  val points = mutableListOf<RideTrackProjectionPoint>()
  var last = previous
  for (point in this) {
    val from = last?.takeIf { it.recordingId == point.recordingId }
    points.add(RideTrackProjectionPoint(point, from?.let { distanceCm(it, point) }))
    last = point
  }
  return points
}

internal fun List<RideTrackPointEntity>.toGpsSampleMaps(
  boardNames: Map<String, String>,
): List<Map<String, Any?>> = toRideTrackProjection().map { it.toSampleMap(boardNames) }

internal fun List<RideTrackPointEntity>.toBucketLocationPoints(
  previous: RideTrackPointEntity? = null,
): List<BucketLocationPoint> = toRideTrackProjection(previous).map { it.toBucketPoint() }

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

/**
 * Stamp each Telemetry Sample with the Ride Track fix that was current when it was captured.
 *
 * The two streams are written on two clocks and joined here, on read — never at write time. The age
 * gate is the same one live telemetry uses: beyond it a sample records no position rather than
 * repeating a dead fix (ADR 0034). Both lists must be ordered by time.
 */
internal fun stampTrackLocations(
  states: List<HistoryTelemetryState>,
  track: List<RideTrackPointEntity>,
): List<HistoryTelemetryState> {
  if (states.isEmpty() || track.isEmpty()) return states
  var cursor = 0
  var current: RideTrackPointEntity? = null
  return states.map { sample ->
    while (cursor < track.size && track[cursor].fixAtMs <= sample.state.capturedAtMs) {
      current = track[cursor]
      cursor++
    }
    val fix = current?.takeIf {
      sample.state.capturedAtMs - it.fixAtMs <= TELEMETRY_LOCATION_MAX_AGE_MS &&
        (sample.state.boardId == null || it.boardId == null || sample.state.boardId == it.boardId)
    } ?: return@map sample
    sample.copy(state = sample.state.copy(location = ScaledLocation.fromTrackPoint(fix)))
  }
}
