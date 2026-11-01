package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.database.RECORDING_STOP_MARKER
import expo.modules.vescapecore.database.TelemetryMarkerEntity
import expo.modules.vescapecore.database.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.database.VescapeDao

private const val RIDE_BUCKET_BATCH_SIZE = 100
private const val MAX_RIDE_PAGE_SIZE = 50

// @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideRoutePoint`
// @parity /modules/vescape-core/src/index.ts `RideRoutePoint`
internal data class RideRoutePoint(val latitude: Double, val longitude: Double, val breakBefore: Boolean = false)

internal data class RideSessionAggregate(
  /** Owning Board (`boards.id`), blank when the buckets match no saved Board (ADR 0028). */
  val boardId: String,
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
  val routePoints: MutableList<RideRoutePoint>,
  var lastRouteAtMs: Long? = null,
  /** Last Telemetry Sample bucket of the ride; GPS-only buckets never move it. */
  var lastFrameAtMs: Long,
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
internal suspend fun readRideHistoryPage(
  dao: VescapeDao,
  options: Map<String, Any?>,
  gapMs: Long,
): Map<String, Any?> {
  val limit = ((options["limit"] as? Number)?.toInt() ?: 10).coerceIn(1, MAX_RIDE_PAGE_SIZE)
  var beforeExclusive = (options["cursorBeforeMs"] as? Number)?.toLong() ?: Long.MAX_VALUE
  val filter = RideHistoryFilter.from(options)
      val buckets = mutableListOf<TelemetryMinuteBucketEntity>()
      var hasOlderBuckets = true
      var complete = emptyList<RideSessionAggregate>()
      var reachedFrom = false

      while (hasOlderBuckets && !reachedFrom && complete.size < limit) {
        // The limit is soft: include every Board in the boundary minute.
        val batch = dao.getRideBuckets(beforeExclusive, RIDE_BUCKET_BATCH_SIZE)
        if (batch.isEmpty()) {
          hasOlderBuckets = false
          break
        }
        buckets.addAll(batch)
        beforeExclusive = batch.minOf { it.bucketStartMs }
        hasOlderBuckets = dao.hasRideBucketsBefore(beforeExclusive)
        val markerFrom = buckets.minOf { it.firstSampleAtMs } - gapMs
        val markerTo = buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS
        val markers = dao.getMarkers(markerFrom, markerTo, null)
        val grouped = groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
        val completeAll = completeRideSessions(grouped, hasOlderBuckets)
        reachedFrom = filter.reachedFrom(completeAll)
        complete = completeAll.filter(filter::matches)
      }
      val exhausted = !hasOlderBuckets || reachedFrom

      // Names resolve from `boards` on read, never off the bucket row (ADR 0028), so a rename
      // relabels the whole Ride History.
      val boardNames = dao.getBoardNames().associate { it.id to it.name }
      val sorted = complete.sortedByDescending { it.startAtMs }
      val cutoff = sorted.getOrNull(limit - 1)?.firstBucketStartMs
      val page = if (cutoff == null) sorted else sorted.filter { it.firstBucketStartMs >= cutoff }
      val hasMore = !exhausted || (cutoff != null && sorted.any { it.firstBucketStartMs < cutoff })
      // One weather read per page; each ride picks its rows from the page span in memory.
      val weather = if (page.isEmpty()) emptyList() else dao.getWeatherObservationsSpanning(
        page.minOf { it.startAtMs },
        page.maxOf { it.endAtMs },
      ).map { it.toObservation() }
      return mapOf(
        "sessions" to page.map { rideSessionMap(it, boardNames, summarizeRideWeather(weather, it.startAtMs, it.endAtMs)) },
        "hasMore" to hasMore,
        "nextCursorBeforeMs" to if (hasMore) page.lastOrNull()?.firstBucketStartMs else null,
      )
}

/**
 * Counts every complete ride matching the filter in `options`, independent of loaded pages.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `countRides`
 */
internal suspend fun countRideHistory(dao: VescapeDao, options: Map<String, Any?>, gapMs: Long): Int {
  var count = 0
  var cursor: Long? = null
  while (true) {
    val page = readRideHistoryPage(dao, options + mapOf("limit" to MAX_RIDE_PAGE_SIZE, "cursorBeforeMs" to cursor), gapMs)
    count += (page["sessions"] as List<*>).size
    cursor = page["nextCursorBeforeMs"] as? Long ?: return count
  }
}

/**
 * Ride History Filter: rides starting in `[fromMs, toMs)` on any of `boardIds` (empty = all).
 * Applied after grouping, because another Board's buckets still decide where a ride splits.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `RideHistoryFilter`
 * @parity /modules/vescape-core/src/index.ts `RideHistoryFilter`
 */
internal data class RideHistoryFilter(val fromMs: Long?, val toMs: Long?, val boardIds: Set<String>) {
  fun matches(session: RideSessionAggregate) =
    (fromMs == null || session.startAtMs >= fromMs) &&
      (toMs == null || session.startAtMs < toMs) &&
      (boardIds.isEmpty() || session.boardId in boardIds)

  /** Once a complete ride starts before [fromMs], every older ride does too. */
  fun reachedFrom(complete: List<RideSessionAggregate>) =
    fromMs != null && complete.any { it.startAtMs < fromMs }

  companion object {
    fun from(options: Map<String, Any?>) = RideHistoryFilter(
      fromMs = (options["fromMs"] as? Number)?.toLong(),
      toMs = (options["toMs"] as? Number)?.toLong(),
      boardIds = (options["boardIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet(),
    )
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
 *
 * Boundaries come from recorded data only (ADR 0041). A ride is one Board's Telemetry Samples; a
 * new one starts on a Board change, when consecutive Telemetry Samples are more than [gapMs]
 * apart, or at an explicit Stop Recording. GPS-only buckets never start or extend a ride on their
 * own: they attach to the preceding ride of their Board.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `groupRideSessions`
 */
internal fun groupRideSessions(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  gapMs: Long,
): List<RideSessionAggregate> {
  val sessions = mutableListOf<RideSessionAggregate>()
  var current: RideSessionAggregate? = null
  val stops = markers.filter { it.type == RECORDING_STOP_MARKER }

  for (bucket in buckets.sortedBy { it.firstSampleAtMs }) {
    val open = current
    if (bucket.sampleCount == 0) {
      // A GPS-only minute belongs to the ride its Board was just recording, or to nothing.
      if (open != null && open.boardId == bucket.boardId &&
        bucket.firstSampleAtMs - open.lastFrameAtMs <= gapMs &&
        !stoppedBetween(stops, bucket.boardId, open.lastFrameAtMs, bucket.firstSampleAtMs)
      ) mergeRideBucket(open, bucket)
      continue
    }
    val split = open == null || open.boardId != bucket.boardId ||
      bucket.firstSampleAtMs - open.lastFrameAtMs > gapMs ||
      stoppedBetween(stops, bucket.boardId, open.lastFrameAtMs, bucket.firstSampleAtMs)
    val session = if (split) {
      open?.let(sessions::add)
      newRideAggregate(bucket, rideBoundaryForBucket(bucket, markers)).also { current = it }
    } else open!!
    mergeRideBucket(session, bucket)
    session.lastFrameAtMs = maxOf(session.lastFrameAtMs, bucket.lastSampleAtMs)
  }
  current?.let(sessions::add)
  return sessions
}

private fun stoppedBetween(stops: List<TelemetryMarkerEntity>, boardId: String, afterMs: Long, untilMs: Long) =
  stops.any { it.occurredAtMs in afterMs..untilMs && (it.boardId ?: "") == boardId }

private fun newRideAggregate(bucket: TelemetryMinuteBucketEntity, boundary: String) = RideSessionAggregate(
  boardId = bucket.boardId,
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
  minLongitude = null, maxLongitude = null, routePoints = mutableListOf(),
  lastFrameAtMs = bucket.lastSampleAtMs,
)

private fun mergeRideBucket(session: RideSessionAggregate, bucket: TelemetryMinuteBucketEntity) {
  session.firstBucketStartMs = minOf(session.firstBucketStartMs, bucket.bucketStartMs)
  session.startAtMs = minOf(session.startAtMs, bucket.firstSampleAtMs)
  session.endAtMs = maxOf(session.endAtMs, bucket.lastSampleAtMs)
  // Same identity `getHistory` gives a bucket.
  session.blockIds.add("${bucket.boardId}:${bucket.bucketStartMs}")
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
  val segments = bucket.routePreview?.let(BucketRoutePreview::decode)
  if (segments != null) {
    for (segment in segments) {
      for ((index, point) in segment.points.withIndex()) {
        val split = index == 0 && session.lastRouteAtMs?.let { segment.firstAtMs - it > BucketRoutePreview.GAP_MS } == true
        appendRideRoutePoint(session, point.latitudeE7 / 1e7, point.longitudeE7 / 1e7, split)
      }
      session.lastRouteAtMs = segment.lastAtMs
    }
  } else if (bucket.firstLatitudeE7 != null && bucket.firstLongitudeE7 != null) {
    // Old buckets keep their coarse preview until explicit history maintenance rebuilds it.
    appendRideRoutePoint(session, bucket.firstLatitudeE7 / 1e7, bucket.firstLongitudeE7 / 1e7, false)
    session.lastRouteAtMs = null
  }
}

private fun appendRideRoutePoint(session: RideSessionAggregate, latitude: Double, longitude: Double, breakBefore: Boolean) {
  if (session.firstLatitude == null) { session.firstLatitude = latitude; session.firstLongitude = longitude }
  session.latitudeSum += latitude; session.longitudeSum += longitude; session.coordinateCount++
  session.minLatitude = minOf(session.minLatitude ?: latitude, latitude)
  session.maxLatitude = maxOf(session.maxLatitude ?: latitude, latitude)
  session.minLongitude = minOf(session.minLongitude ?: longitude, longitude)
  session.maxLongitude = maxOf(session.maxLongitude ?: longitude, longitude)
  session.routePoints.add(RideRoutePoint(latitude, longitude, breakBefore))
}

private fun rideBoundaryForBucket(bucket: TelemetryMinuteBucketEntity, markers: List<TelemetryMarkerEntity>): String =
  markers.lastOrNull { marker ->
    marker.occurredAtMs >= bucket.firstSampleAtMs - 5_000L &&
      marker.occurredAtMs <= bucket.firstSampleAtMs + 1_000L &&
      (marker.boardId ?: "") == bucket.boardId
  }?.type ?: "none"

private fun rideDistanceDeltaM(bucket: TelemetryMinuteBucketEntity): Double? {
  val first = bucket.firstOdometerCm ?: return null
  val last = bucket.lastOdometerCm ?: return null
  return (last - first).coerceAtLeast(0L) / 100.0
}

/**
 * Stable Ride id: Board, start and end. A ride that grows gets a new id, so a stale link misses.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `rideSessionId`
 */
internal fun rideSessionId(session: RideSessionAggregate): String =
  "${session.boardId.ifBlank { "unknown" }}:${session.startAtMs}:${session.endAtMs}"

/**
 * One complete ride by [rideSessionId], or null once it no longer exists under that id.
 * Pages from just past the ride's end, so the ride is the newest complete one in the window.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `getSession`
 */
internal suspend fun readRideSession(dao: VescapeDao, id: String, gapMs: Long): Map<String, Any?>? {
  val endAtMs = id.substringAfterLast(':').toLongOrNull() ?: return null
  val page = readRideHistoryPage(
    dao,
    mapOf("cursorBeforeMs" to endAtMs + 1, "limit" to RIDE_SESSION_LOOKUP_LIMIT),
    gapMs,
  )
  @Suppress("UNCHECKED_CAST")
  return (page["sessions"] as List<Map<String, Any?>>).firstOrNull { it["id"] == id }
}

/** Other Boards' rides that started during this one sort ahead of it; a few covers them. */
private const val RIDE_SESSION_LOOKUP_LIMIT = 4

/** @parity /modules/vescape-core/src/index.ts `RideHistorySession` */
internal fun rideSessionMap(
  session: RideSessionAggregate,
  boardNames: Map<String, String>,
  weather: RideWeather?,
): Map<String, Any?> {
  val avgSpeed = if (session.avgSpeedSampleCount > 0) session.avgSpeedWeightedSum / session.avgSpeedSampleCount else 0.0
  return mapOf(
    "id" to rideSessionId(session),
    "boardId" to session.boardId.ifBlank { null },
    "boardName" to (boardNames[session.boardId] ?: UNKNOWN_TELEMETRY_BOARD_NAME),
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
    "boundaryBefore" to session.boundaryBefore,
    "weather" to weather?.toMap(),
    "routePoints" to session.routePoints.map { buildMap<String, Any> { put("latitude", it.latitude); put("longitude", it.longitude); if (it.breakBefore) put("breakBefore", true) } },
  )
}
