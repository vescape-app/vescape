package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.withTransaction
import java.time.Instant
import java.time.ZoneId

/**
 * Minutes without a recorded sample that end a ride, when the rider has set no `rideSplitGapMinutes`.
 * @parity /src/modules/history/lib/sessions.ts `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
internal const val DEFAULT_RIDE_SPLIT_GAP_MINUTES = 30
data class ProfileStatsMonth(val year: Int, val month: Int)

// @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift
class ProfileStatsRepository private constructor(private val context: Context) {
  private val database = TelemetryDatabase.get(context)
  private val dao = database.telemetryDao()

  /** Lifetime, available months, and selected-month stats from one database read/grouping pass. */
  // @parity /modules/vescape-core/src/index.ts `ProfileStatsSnapshot`
  suspend fun getProfileStatsSnapshot(options: Map<String, Any?>): Map<String, Any?> {
    val gapMs = rideSplitGapMs()
    return database.withTransaction {
      val buckets = dao.getAllHistoryBucketsAsc()
      val markers = markersForBuckets(buckets, gapMs)
      val sessions = groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
      val months = profileMonthsForSessions(sessions)
      val requested = ProfileStatsMonth(
        year = (options["year"] as? Number)?.toInt() ?: months.firstOrNull()?.year ?: java.time.LocalDate.now().year,
        month = (options["month"] as? Number)?.toInt() ?: months.firstOrNull()?.month ?: java.time.LocalDate.now().monthValue,
      )
      mapOf(
        "total" to computeProfileStatsForSessions(sessions, null),
        "monthly" to computeProfileStatsForSessions(sessions, requested),
        "months" to months.map { mapOf("year" to it.year, "month" to it.month) },
        "selectedMonth" to mapOf("year" to requested.year, "month" to requested.month),
      )
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

internal fun computeProfileStatsForBuckets(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  month: ProfileStatsMonth?,
  zoneId: ZoneId = ZoneId.systemDefault(),
  gapMs: Long = DEFAULT_RIDE_SPLIT_GAP_MINUTES * 60_000L,
): Map<String, Any?> {
  val sessions = groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
  return computeProfileStatsForSessions(sessions, month, zoneId)
}

private fun computeProfileStatsForSessions(
  sessions: List<RideSessionAggregate>,
  month: ProfileStatsMonth?,
  zoneId: ZoneId = ZoneId.systemDefault(),
): Map<String, Any?> {
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
  return profileMonthsForSessions(groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }, zoneId)
}

private fun profileMonthsForSessions(
  sessions: List<RideSessionAggregate>,
  zoneId: ZoneId = ZoneId.systemDefault(),
): List<ProfileStatsMonth> {
  return sessions.map { profileMonth(it.startAtMs, zoneId) }
    .distinct()
    .sortedWith(compareByDescending<ProfileStatsMonth> { it.year }.thenByDescending { it.month })
}

private fun profileMonth(atMs: Long, zoneId: ZoneId): ProfileStatsMonth {
  val dt = Instant.ofEpochMilli(atMs).atZone(zoneId)
  return ProfileStatsMonth(year = dt.year, month = dt.monthValue)
}
