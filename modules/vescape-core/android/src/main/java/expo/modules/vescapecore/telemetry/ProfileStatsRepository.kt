package expo.modules.vescapecore.telemetry

import android.content.Context
import java.time.Instant
import java.time.ZoneId

/**
 * Minutes without a recorded sample that end a ride, when the rider has set no `rideSplitGapMinutes`.
 * @parity /src/modules/history/lib/sessions.ts `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
internal const val DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30
private val PROFILE_BREAK_BOUNDARIES = setOf("disconnected", "app_stop", "error")

data class ProfileStatsMonth(val year: Int, val month: Int)

// @parity /modules/vescape-core/ios/telemetry/TelemetryRepository.swift
class ProfileStatsRepository private constructor(private val context: Context) {
  private val dao = TelemetryDatabase.get(context).telemetryDao()

  suspend fun getTotalProfileStats(): Map<String, Any?> {
    val gapMs = rideSplitGapMs()
    val buckets = dao.getAllHistoryBucketsAsc()
    val markers = markersForBuckets(buckets, gapMs)
    return computeProfileStatsForBuckets(
      buckets = buckets,
      markers = markers,
      month = null,
      gapMs = gapMs,
    )
  }

  suspend fun getMonthlyProfileStats(options: Map<String, Any?>): Map<String, Any?> {
    val year = (options["year"] as? Number)?.toInt()
      ?: throw IllegalArgumentException("year is required")
    val month = (options["month"] as? Number)?.toInt()
      ?: throw IllegalArgumentException("month is required")
    require(month in 1..12) { "month must be 1-12" }

    val gapMs = rideSplitGapMs()
    val buckets = dao.getAllHistoryBucketsAsc()
    val markers = markersForBuckets(buckets, gapMs)
    return computeProfileStatsForBuckets(
      buckets = buckets,
      markers = markers,
      month = ProfileStatsMonth(year = year, month = month),
      gapMs = gapMs,
    )
  }

  suspend fun getProfileStatMonths(): List<Map<String, Any?>> {
    val gapMs = rideSplitGapMs()
    val buckets = dao.getAllHistoryBucketsAsc()
    val markers = markersForBuckets(buckets, gapMs)
    return computeProfileStatMonthsForBuckets(buckets, markers, gapMs = gapMs).map { month ->
      mapOf("year" to month.year, "month" to month.month)
    }
  }

  /** Rider-set ride split gap, so profile stats count the same rides the history list shows. */
  private suspend fun rideSplitGapMs(): Long {
    val minutes = AppDataRepository.get(context).getSettings()["rideSplitGapMinutes"] as? Number
    return (minutes?.toLong() ?: DEFAULT_RIDE_SPLIT_GAP_MINUTES.toLong()) * 60_000L
  }

  private suspend fun markersForBuckets(
    buckets: List<TelemetryMinuteBucketEntity>,
    gapMs: Long,
  ): List<TelemetryMarkerEntity> {
    if (buckets.isEmpty()) return emptyList()
    val fromMs = buckets.minOf { it.firstSampleAtMs } - gapMs
    val toMs = buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS
    return dao.getMarkers(fromMs = fromMs, toMs = toMs, boardId = null)
  }

  companion object {
    @Volatile
    private var instance: ProfileStatsRepository? = null

    fun get(context: Context): ProfileStatsRepository {
      return instance ?: synchronized(this) {
        instance ?: ProfileStatsRepository(context.applicationContext).also { instance = it }
      }
    }

    fun resetForDatabaseSwap() {
      synchronized(this) {
        instance = null
      }
    }
  }
}

private data class ProfileSessionAggregate(
  val boardId: String,
  var startAtMs: Long,
  var endAtMs: Long,
  var sampleCount: Int,
  var avgSpeedSampleCount: Int,
  var avgSpeedWeightedSum: Double,
  var movingStartAtMs: Long?,
  var movingEndAtMs: Long?,
  var distanceM: Double?,
  var topSpeedKmh: Double,
  var batteryUsedWh: Double,
  var batteryRegenWh: Double,
)

internal fun computeProfileStatsForBuckets(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  month: ProfileStatsMonth?,
  zoneId: ZoneId = ZoneId.systemDefault(),
  gapMs: Long = DEFAULT_RIDE_SPLIT_GAP_MINUTES * 60_000L,
): Map<String, Any?> {
  val sessions = groupProfileSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
  val included = if (month == null) {
    sessions
  } else {
    sessions.filter { profileMonth(it.startAtMs, zoneId) == month }
  }
  if (included.isEmpty()) {
    return mapOf(
      "distanceM" to null,
      "rideCount" to 0,
      "rideTimeMs" to 0L,
      "topSpeedKmh" to 0.0,
      "avgSpeedKmh" to 0.0,
      "longestRideM" to null,
      "batteryUsedWh" to null,
      "batteryRegenWh" to null,
    )
  }

  val totalDurationMs = included.sumOf { session ->
    val start = session.movingStartAtMs
    val end = session.movingEndAtMs
    val span = if (start != null && end != null) end - start else session.endAtMs - session.startAtMs
    span.coerceAtLeast(0L)
  }
  val totalDistanceM = included.mapNotNull { it.distanceM }.takeIf { it.isNotEmpty() }?.sum()
  val avgSpeedSamples = included.sumOf { it.avgSpeedSampleCount }
  val avgSpeedKmh = if (avgSpeedSamples > 0) {
    included.sumOf { it.avgSpeedWeightedSum } / avgSpeedSamples
  } else {
    0.0
  }

  return mapOf(
    "distanceM" to totalDistanceM,
    "rideCount" to included.size,
    "rideTimeMs" to totalDurationMs,
    "topSpeedKmh" to (included.maxOfOrNull { it.topSpeedKmh } ?: 0.0),
    "avgSpeedKmh" to avgSpeedKmh,
    "longestRideM" to included.mapNotNull { it.distanceM }.maxOrNull(),
    "batteryUsedWh" to included.sumOf { it.batteryUsedWh },
    "batteryRegenWh" to included.sumOf { it.batteryRegenWh },
  )
}

internal fun computeProfileStatMonthsForBuckets(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  zoneId: ZoneId = ZoneId.systemDefault(),
  gapMs: Long = DEFAULT_RIDE_SPLIT_GAP_MINUTES * 60_000L,
): List<ProfileStatsMonth> {
  return groupProfileSessions(buckets, markers, gapMs)
    .filter { it.avgSpeedSampleCount > 0 }
    .map { profileMonth(it.startAtMs, zoneId) }
    .distinct()
    .sortedWith(compareByDescending<ProfileStatsMonth> { it.year }.thenByDescending { it.month })
}

private fun groupProfileSessions(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  gapMs: Long,
): List<ProfileSessionAggregate> {
  if (buckets.isEmpty()) return emptyList()
  val sorted = buckets.sortedBy { it.firstSampleAtMs }
  val sessions = mutableListOf<ProfileSessionAggregate>()
  var current: ProfileSessionAggregate? = null
  var previous: TelemetryMinuteBucketEntity? = null

  for (bucket in sorted) {
    if (bucket.sampleCount <= 0) continue
    val boundaryBefore = markerBoundaryForBucket(bucket, markers)
    val breakByBoard = current == null || current.boardId != bucket.boardId
    val breakByGap = previous != null && bucket.firstSampleAtMs - previous.lastSampleAtMs > gapMs
    val breakByBoundary = boundaryBefore != null && PROFILE_BREAK_BOUNDARIES.contains(boundaryBefore)

    if (breakByBoard || breakByGap || breakByBoundary) {
      current?.let { sessions.add(it) }
      current = ProfileSessionAggregate(
        boardId = bucket.boardId,
        startAtMs = bucket.firstSampleAtMs,
        endAtMs = bucket.lastSampleAtMs,
        sampleCount = 0,
        avgSpeedSampleCount = 0,
        avgSpeedWeightedSum = 0.0,
        movingStartAtMs = null,
        movingEndAtMs = null,
        distanceM = null,
        topSpeedKmh = 0.0,
        batteryUsedWh = 0.0,
        batteryRegenWh = 0.0,
      )
    }

    current = mergeBucketIntoSession(current ?: continue, bucket)
    previous = bucket
  }

  current?.let { sessions.add(it) }
  return sessions
}

private fun markerBoundaryForBucket(
  bucket: TelemetryMinuteBucketEntity,
  markers: List<TelemetryMarkerEntity>,
): String? {
  val marker = markers.lastOrNull { marker ->
    marker.occurredAtMs >= bucket.firstSampleAtMs - 5_000L &&
      marker.occurredAtMs <= bucket.firstSampleAtMs + 1_000L &&
      (marker.boardId ?: UNKNOWN_TELEMETRY_BOARD_ID) == bucket.boardId
  }
  return marker?.type
}

private fun mergeBucketIntoSession(
  session: ProfileSessionAggregate,
  bucket: TelemetryMinuteBucketEntity,
): ProfileSessionAggregate {
  session.startAtMs = minOf(session.startAtMs, bucket.firstSampleAtMs)
  session.endAtMs = maxOf(session.endAtMs, bucket.lastSampleAtMs)
  session.sampleCount += bucket.sampleCount
  if (bucket.movingSpeedSampleCount != null) {
    session.avgSpeedSampleCount += bucket.movingSpeedSampleCount
    session.avgSpeedWeightedSum += (bucket.sumMovingAbsSpeedCentiKmh ?: 0L).toDouble() / 100.0
  } else {
    session.avgSpeedSampleCount += bucket.sampleCount
    session.avgSpeedWeightedSum += bucket.sumAbsSpeedCentiKmh.toDouble() / 100.0
  }
  bucket.firstMovingAtMs?.let { first ->
    session.movingStartAtMs = session.movingStartAtMs?.let { minOf(it, first) } ?: first
  }
  bucket.lastMovingAtMs?.let { last ->
    session.movingEndAtMs = session.movingEndAtMs?.let { maxOf(it, last) } ?: last
  }
  session.topSpeedKmh = maxOf(session.topSpeedKmh, bucket.maxAbsSpeedCentiKmh / 100.0)
  session.batteryUsedWh += bucket.batteryUsedWhMilli / 1000.0
  session.batteryRegenWh += bucket.batteryRegenWhMilli / 1000.0

  distanceDeltaM(bucket)?.let { distance ->
    session.distanceM = (session.distanceM ?: 0.0) + distance
  }

  return session
}

private fun distanceDeltaM(bucket: TelemetryMinuteBucketEntity): Double? {
  val first = bucket.firstOdometerCm ?: return null
  val last = bucket.lastOdometerCm ?: return null
  return ((last - first).coerceAtLeast(0L)) / 100.0
}

private fun profileMonth(atMs: Long, zoneId: ZoneId): ProfileStatsMonth {
  val dt = Instant.ofEpochMilli(atMs).atZone(zoneId)
  return ProfileStatsMonth(year = dt.year, month = dt.monthValue)
}
