package expo.modules.vescapecore.telemetry

import java.time.Instant
import java.time.ZoneId
import expo.modules.vescapecore.database.TelemetryMarkerEntity
import expo.modules.vescapecore.database.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.database.VescapeDao

/**
 * Minutes without a recorded sample that end a ride, when the rider has set no `rideSplitGapMinutes`.
 * @parity /src/modules/history/lib/sessions.ts `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `DEFAULT_RIDE_SPLIT_GAP_MINUTES`
 */
data class ProfileStatsMonth(val year: Int, val month: Int)

// @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift
internal suspend fun readProfileStatsSnapshot(
  dao: VescapeDao,
  options: Map<String, Any?>,
  gapMs: Long,
): Map<String, Any?> {
      val sessions = readProfileSessions(dao, gapMs)
      val months = profileMonthsForSessions(sessions)
      val requested = ProfileStatsMonth(
        year = (options["year"] as? Number)?.toInt() ?: months.firstOrNull()?.year ?: java.time.LocalDate.now().year,
        month = (options["month"] as? Number)?.toInt() ?: months.firstOrNull()?.month ?: java.time.LocalDate.now().monthValue,
      )
      return mapOf(
        "total" to computeProfileStatsForSessions(sessions),
        "monthly" to computeProfileStatsForSessions(sessions.filter { profileMonth(it.startAtMs) == requested }),
        "months" to months.map { mapOf("year" to it.year, "month" to it.month) },
        "selectedMonth" to mapOf("year" to requested.year, "month" to requested.month),
      )
}

/**
 * Stats of the rides that started on one local calendar day.
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `getDayStats`
 */
internal suspend fun readProfileDayStats(
  dao: VescapeDao,
  options: Map<String, Any?>,
  gapMs: Long,
  zoneId: ZoneId = ZoneId.systemDefault(),
): Map<String, Any?> {
  val day = java.time.LocalDate.of(
    (options["year"] as Number).toInt(),
    (options["month"] as Number).toInt(),
    (options["day"] as Number).toInt(),
  )
  return computeProfileStatsForSessions(
    readProfileSessions(dao, gapMs).filter {
      Instant.ofEpochMilli(it.startAtMs).atZone(zoneId).toLocalDate() == day
    },
  )
}

/**
 * Stats of the rides still going on or finished at or after [sinceMs], so a ride that crosses
 * midnight keeps counting as the one being ridden.
 * @parity /modules/vescape-core/ios/telemetry/ProfileStatsRepository.swift `getRecentRideStats`
 */
internal suspend fun readProfileRecentStats(dao: VescapeDao, sinceMs: Long, gapMs: Long): Map<String, Any?> =
  computeProfileStatsForSessions(readProfileSessions(dao, gapMs).filter { it.endAtMs >= sinceMs })

private suspend fun readProfileSessions(dao: VescapeDao, gapMs: Long): List<RideSessionAggregate> {
  val buckets = dao.getAllHistoryBucketsAsc()
  val markers = readProfileMarkers(dao, buckets, gapMs)
  return groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
}

private suspend fun readProfileMarkers(
    dao: VescapeDao,
    buckets: List<TelemetryMinuteBucketEntity>,
    gapMs: Long,
  ): List<TelemetryMarkerEntity> {
    if (buckets.isEmpty()) return emptyList()
    val fromMs = buckets.minOf { it.firstSampleAtMs } - gapMs
    val toMs = buckets.maxOf { it.lastSampleAtMs } + TELEMETRY_BUCKET_SIZE_MS
    return dao.getMarkers(fromMs = fromMs, toMs = toMs, boardId = null)
  }

internal fun computeProfileStatsForBuckets(
  buckets: List<TelemetryMinuteBucketEntity>,
  markers: List<TelemetryMarkerEntity>,
  month: ProfileStatsMonth?,
  zoneId: ZoneId = ZoneId.systemDefault(),
  gapMs: Long = DEFAULT_RIDE_SPLIT_GAP_MINUTES * 60_000L,
): Map<String, Any?> {
  val sessions = groupRideSessions(buckets, markers, gapMs).filter { it.avgSpeedSampleCount > 0 }
  return computeProfileStatsForSessions(
    if (month == null) sessions else sessions.filter { profileMonth(it.startAtMs, zoneId) == month },
  )
}

private fun computeProfileStatsForSessions(included: List<RideSessionAggregate>): Map<String, Any?> {
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
      "topSpeedRideId" to null,
      "longestRideId" to null,
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

  val topSpeedRide = included.maxByOrNull { it.topSpeedKmh }
  val longestRide = included.maxByOrNull { it.distanceM ?: -1.0 }?.takeIf { it.distanceM != null }

  return mapOf(
    "distanceM" to totalDistanceM,
    "rideCount" to included.size,
    "rideTimeMs" to totalDurationMs,
    "topSpeedKmh" to (topSpeedRide?.topSpeedKmh ?: 0.0),
    "avgSpeedKmh" to avgSpeedKmh,
    "longestRideM" to longestRide?.distanceM,
    "batteryUsedWh" to included.sumOf { it.batteryUsedWh },
    "batteryRegenWh" to included.sumOf { it.batteryRegenWh },
    "topSpeedRideId" to topSpeedRide?.let(::rideSessionId),
    "longestRideId" to longestRide?.let(::rideSessionId),
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

private fun profileMonth(atMs: Long, zoneId: ZoneId = ZoneId.systemDefault()): ProfileStatsMonth {
  val dt = Instant.ofEpochMilli(atMs).atZone(zoneId)
  return ProfileStatsMonth(year = dt.year, month = dt.monthValue)
}
