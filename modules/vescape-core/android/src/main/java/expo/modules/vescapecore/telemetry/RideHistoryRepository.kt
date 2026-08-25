package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.withTransaction

private const val RIDE_BUCKET_BATCH_SIZE = 100
private const val MAX_RIDE_PAGE_SIZE = 50
private val RIDE_BREAK_BOUNDARIES = setOf("disconnected", "app_stop", "error")

internal data class RideRoutePoint(val latitude: Double, val longitude: Double)

internal data class RideSessionAggregate(
  val deviceId: String,
  var deviceName: String,
  var boundaryBefore: String,
  var firstBucketStartMs: Long,
  var startAtMs: Long,
  var endAtMs: Long,
  val blockIds: MutableList<String>,
  var blockCount: Int,
  var sampleCount: Int,
  var gpsPointCount: Int,
  var preciseGpsPointCount: Int,
  var avgSpeedSampleCount: Int,
  var avgSpeedWeightedSum: Double,
  var movingStartAtMs: Long?,
  var movingEndAtMs: Long?,
  var distanceDeltaM: Double,
  var distanceDeltaCount: Int,
  var gpsDistanceM: Double,
  var gpsDistanceCount: Int,
  var topSpeedKmh: Double,
  var maxTempMosfet: Double?,
  var maxTempMotor: Double?,
  var maxDuty: Double,
  var batteryUsedWh: Double,
  var batteryRegenWh: Double,
  var firstLatitude: Double?,
  var firstLongitude: Double?,
  var latitudeSum: Double,
  var longitudeSum: Double,
  var coordinateCount: Int,
  var minLatitude: Double?,
  var maxLatitude: Double?,
  var minLongitude: Double?,
  var maxLongitude: Double?,
  var faultCount: Int,
  val routePoints: MutableList<RideRoutePoint>,
) {
  val distanceM: Double?
    get() = when {
      distanceDeltaCount > 0 -> distanceDeltaM
      gpsDistanceCount > 0 -> gpsDistanceM
      else -> null
    }
}

/** Complete-ride paging over minute buckets. JS never observes a provisional, cut-off ride. */
// @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift
internal class RideHistoryRepository private constructor(private val context: Context) {
  private val database = TelemetryDatabase.get(context)
  private val dao = database.telemetryDao()

  /** @parity /modules/vescape-core/src/index.ts `RideHistoryPage` */
  suspend fun getPage(options: Map<String, Any?>): Map<String, Any?> {
    val limit = ((options["limit"] as? Number)?.toInt() ?: 10).coerceIn(1, MAX_RIDE_PAGE_SIZE)
    val gapMs = rideSplitGapMs()
    return database.withTransaction {
      var beforeExclusive = (options["cursorBeforeMs"] as? Number)?.toLong() ?: Long.MAX_VALUE
      val buckets = mutableListOf<TelemetryMinuteBucketEntity>()
      var hasOlderBuckets = true
      var complete = emptyList<RideSessionAggregate>()

      while (hasOlderBuckets && complete.size < limit) {
        val beforeInclusive = if (beforeExclusive == Long.MAX_VALUE) Long.MAX_VALUE else beforeExclusive - 1L
        val fetched = dao.getHistoryBuckets(0, Long.MAX_VALUE, beforeInclusive, null, RIDE_BUCKET_BATCH_SIZE + 1)
        val batch = fetched.take(RIDE_BUCKET_BATCH_SIZE)
        if (batch.isEmpty()) {
          hasOlderBuckets = false
          break
        }
        buckets.addAll(batch)
        beforeExclusive = batch.minOf { it.bucketStartMs }
        hasOlderBuckets = fetched.size > RIDE_BUCKET_BATCH_SIZE
        val markerFrom = buckets.minOf { it.firstSampleAtMs } - gapMs
        val markerTo = buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS
        val markers = dao.getMarkers(markerFrom, markerTo, null)
        val grouped = groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
        complete = completeRideSessions(grouped, hasOlderBuckets)
      }

      val sorted = complete.sortedByDescending { it.startAtMs }
      val cutoff = sorted.getOrNull(limit - 1)?.firstBucketStartMs
      val page = if (cutoff == null) sorted else sorted.filter { it.firstBucketStartMs >= cutoff }
      val hasMore = hasOlderBuckets || (cutoff != null && sorted.any { it.firstBucketStartMs < cutoff })
      mapOf(
        "sessions" to page.map(::rideSessionMap),
        "hasMore" to hasMore,
        "nextCursorBeforeMs" to if (hasMore) page.lastOrNull()?.firstBucketStartMs else null,
      )
    }
  }

  private suspend fun rideSplitGapMs(): Long {
    val minutes = AppDataRepository.get(context).getSettings()["rideSplitGapMinutes"] as? Number
    return (minutes?.toLong() ?: DEFAULT_RIDE_SPLIT_GAP_MINUTES.toLong()) * 60_000L
  }

  companion object {
    @Volatile private var instance: RideHistoryRepository? = null

    fun get(context: Context): RideHistoryRepository = instance ?: synchronized(this) {
      instance ?: RideHistoryRepository(context.applicationContext).also { instance = it }
    }

    fun resetForDatabaseSwap() = synchronized(this) { instance = null }
  }
}

/**
 * Buckets arrive newest-first, so the only ride that may still grow backwards is the OLDEST one in
 * the window. Dropping the newest instead hides the ride being recorded right now.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `completeRideSessions`
 */
internal fun completeRideSessions(
  grouped: List<RideSessionAggregate>,
  hasOlderBuckets: Boolean,
): List<RideSessionAggregate> = if (hasOlderBuckets) grouped.drop(1) else grouped

/**
 * Native source of Ride boundaries and aggregates used by both History pages and Profile stats.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `groupRideSessions`
 */
internal fun groupRideSessions(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  gapMs: Long,
): List<RideSessionAggregate> {
  val sessions = mutableListOf<RideSessionAggregate>()
  var current: RideSessionAggregate? = null
  var previous: TelemetryMinuteBucketEntity? = null

  for (bucket in buckets.sortedBy { it.firstSampleAtMs }) {
    if (bucket.sampleCount <= 0) continue
    val boundary = rideBoundaryForBucket(bucket, markers)
    val split = current == null || current.deviceId != bucket.deviceId ||
      (previous != null && bucket.firstSampleAtMs - previous.lastSampleAtMs > gapMs) ||
      RIDE_BREAK_BOUNDARIES.contains(boundary)
    if (split) {
      current?.let(sessions::add)
      current = newRideAggregate(bucket, boundary)
    }
    mergeRideBucket(current ?: continue, bucket)
    previous = bucket
  }
  current?.let(sessions::add)
  return sessions
}

private fun newRideAggregate(bucket: TelemetryMinuteBucketEntity, boundary: String) = RideSessionAggregate(
  deviceId = bucket.deviceId,
  deviceName = bucket.deviceName ?: UNKNOWN_TELEMETRY_DEVICE_NAME,
  boundaryBefore = boundary,
  firstBucketStartMs = bucket.bucketStartMs,
  startAtMs = bucket.firstSampleAtMs,
  endAtMs = bucket.lastSampleAtMs,
  blockIds = mutableListOf(), blockCount = 0, sampleCount = 0, gpsPointCount = 0,
  preciseGpsPointCount = 0, avgSpeedSampleCount = 0, avgSpeedWeightedSum = 0.0,
  movingStartAtMs = null, movingEndAtMs = null, distanceDeltaM = 0.0,
  distanceDeltaCount = 0, gpsDistanceM = 0.0, gpsDistanceCount = 0, topSpeedKmh = 0.0,
  maxTempMosfet = null, maxTempMotor = null, maxDuty = 0.0, batteryUsedWh = 0.0,
  batteryRegenWh = 0.0, firstLatitude = null, firstLongitude = null, latitudeSum = 0.0,
  longitudeSum = 0.0, coordinateCount = 0, minLatitude = null, maxLatitude = null,
  minLongitude = null, maxLongitude = null, faultCount = 0, routePoints = mutableListOf(),
)

private fun mergeRideBucket(session: RideSessionAggregate, bucket: TelemetryMinuteBucketEntity) {
  session.firstBucketStartMs = minOf(session.firstBucketStartMs, bucket.bucketStartMs)
  session.startAtMs = minOf(session.startAtMs, bucket.firstSampleAtMs)
  session.endAtMs = maxOf(session.endAtMs, bucket.lastSampleAtMs)
  session.blockIds.add("${bucket.deviceId}:${bucket.bucketStartMs}")
  session.blockCount++
  session.sampleCount += bucket.sampleCount
  session.gpsPointCount += bucket.gpsPointCount
  session.preciseGpsPointCount += bucket.preciseGpsPointCount
  val movingCount = bucket.movingSpeedSampleCount ?: bucket.sampleCount
  session.avgSpeedSampleCount += movingCount
  session.avgSpeedWeightedSum += if (bucket.movingSpeedSampleCount != null) {
    (bucket.sumMovingAbsSpeedCentiKmh ?: 0L) / 100.0
  } else bucket.sumAbsSpeedCentiKmh / 100.0
  bucket.firstMovingAtMs?.let { session.movingStartAtMs = session.movingStartAtMs?.let { old -> minOf(old, it) } ?: it }
  bucket.lastMovingAtMs?.let { session.movingEndAtMs = session.movingEndAtMs?.let { old -> maxOf(old, it) } ?: it }
  val odometerDistance = rideDistanceDeltaM(bucket)
  if (odometerDistance != null) { session.distanceDeltaM += odometerDistance; session.distanceDeltaCount++ }
  if (bucket.gpsDistanceCm > 0) { session.gpsDistanceM += bucket.gpsDistanceCm / 100.0; session.gpsDistanceCount++ }
  session.topSpeedKmh = maxOf(session.topSpeedKmh, bucket.maxAbsSpeedCentiKmh / 100.0)
  bucket.maxTempMosfetDeciC?.let { value -> session.maxTempMosfet = maxOf(session.maxTempMosfet ?: value / 10.0, value / 10.0) }
  bucket.maxTempMotorDeciC?.let { value -> session.maxTempMotor = maxOf(session.maxTempMotor ?: value / 10.0, value / 10.0) }
  session.maxDuty = maxOf(session.maxDuty, bucket.maxDutyAbsPermille / 1000.0)
  session.batteryUsedWh += bucket.batteryUsedWhMilli / 1000.0
  session.batteryRegenWh += bucket.batteryRegenWhMilli / 1000.0
  session.faultCount += bucket.faultCount
  if (bucket.firstLatitudeE7 != null && bucket.firstLongitudeE7 != null) {
    val latitude = bucket.firstLatitudeE7 / 1e7
    val longitude = bucket.firstLongitudeE7 / 1e7
    if (session.firstLatitude == null) { session.firstLatitude = latitude; session.firstLongitude = longitude }
    session.latitudeSum += latitude; session.longitudeSum += longitude; session.coordinateCount++
    session.minLatitude = minOf(session.minLatitude ?: latitude, latitude)
    session.maxLatitude = maxOf(session.maxLatitude ?: latitude, latitude)
    session.minLongitude = minOf(session.minLongitude ?: longitude, longitude)
    session.maxLongitude = maxOf(session.maxLongitude ?: longitude, longitude)
    session.routePoints.add(RideRoutePoint(latitude, longitude))
  }
}

private fun rideBoundaryForBucket(bucket: TelemetryMinuteBucketEntity, markers: List<TelemetryMarkerEntity>): String =
  markers.lastOrNull { marker ->
    marker.occurredAtMs >= bucket.firstSampleAtMs - 5_000L &&
      marker.occurredAtMs <= bucket.firstSampleAtMs + 1_000L &&
      (marker.deviceId ?: UNKNOWN_TELEMETRY_DEVICE_ID) == bucket.deviceId
  }?.type ?: "none"

private fun rideDistanceDeltaM(bucket: TelemetryMinuteBucketEntity): Double? {
  val first = bucket.firstOdometerCm ?: return null
  val last = bucket.lastOdometerCm ?: return null
  return (last - first).coerceAtLeast(0L) / 100.0
}

/** @parity /modules/vescape-core/src/index.ts `RideHistorySession` */
internal fun rideSessionMap(session: RideSessionAggregate): Map<String, Any?> {
  val avgSpeed = if (session.avgSpeedSampleCount > 0) session.avgSpeedWeightedSum / session.avgSpeedSampleCount else 0.0
  return mapOf(
    "id" to "${session.deviceId.ifBlank { "unknown" }}:${session.startAtMs}:${session.endAtMs}",
    "deviceId" to session.deviceId.ifBlank { null }, "deviceName" to session.deviceName,
    "startAtMs" to session.startAtMs, "endAtMs" to session.endAtMs,
    "movingStartAtMs" to session.movingStartAtMs, "movingEndAtMs" to session.movingEndAtMs,
    "blockIds" to session.blockIds, "blockCount" to session.blockCount,
    "sampleCount" to session.sampleCount, "gpsPointCount" to session.gpsPointCount,
    "preciseGpsPointCount" to session.preciseGpsPointCount, "distanceM" to session.distanceM,
    "maxSpeedKmh" to session.topSpeedKmh, "avgSpeedKmh" to avgSpeed,
    "maxTempMosfet" to session.maxTempMosfet, "maxTempMotor" to session.maxTempMotor,
    "maxDuty" to session.maxDuty, "batteryUsedWh" to session.batteryUsedWh,
    "batteryRegenWh" to session.batteryRegenWh, "firstLatitude" to session.firstLatitude,
    "firstLongitude" to session.firstLongitude,
    "centerLatitude" to if (session.coordinateCount > 0) session.latitudeSum / session.coordinateCount else null,
    "centerLongitude" to if (session.coordinateCount > 0) session.longitudeSum / session.coordinateCount else null,
    "minLatitude" to session.minLatitude, "maxLatitude" to session.maxLatitude,
    "minLongitude" to session.minLongitude, "maxLongitude" to session.maxLongitude,
    "faultCount" to session.faultCount, "boundaryBefore" to session.boundaryBefore,
    "routePoints" to session.routePoints.map { mapOf("latitude" to it.latitude, "longitude" to it.longitude) },
  )
}
