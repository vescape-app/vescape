package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.database.RideTrackPointEntity
import expo.modules.vescapecore.database.TELEMETRY_FLAG_KEYFRAME
import expo.modules.vescapecore.database.TelemetryFrameEntity
import expo.modules.vescapecore.database.VescapeDao

/** App-used outer transactions for maintenance operations that may span several protected ranges. */
internal class TelemetryMaintenancePersistence(
  private val dao: VescapeDao,
) {
  suspend fun deleteRanges(
    ranges: List<TelemetryTimeRange>,
    boardId: String?,
    allBoards: Boolean,
  ): Int = dao.deleteRanges(ranges, boardId, allBoards)

  suspend fun clear(protectedRanges: List<TelemetryTimeRange>) = dao.clearExcept(protectedRanges)
}

internal data class RebuildState(
  val at: Long, val boardId: String?, val speed: Int, val voltage: Int,
  val motorCurrent: Int, val batteryCurrent: Int, val duty: Int, val odometer: Long?,
  val tempMosfet: Int?, val tempMotor: Int?,
) {
  fun point() = BucketTelemetryPoint(at, boardId,
    speed, voltage, motorCurrent, batteryCurrent, duty, odometer, tempMosfet, tempMotor)
  companion object {
    fun apply(previous: RebuildState?, frame: TelemetryFrameEntity): RebuildState? {
      val old = previous?.takeIf { frame.flags and TELEMETRY_FLAG_KEYFRAME == 0 && it.boardId == frame.boardId }
      return RebuildState(frame.capturedAtMs, frame.boardId,
        frame.speedCentiKmh ?: old?.speed ?: return null,
        frame.batteryVoltageMv ?: old?.voltage ?: return null,
        frame.motorCurrentMa ?: old?.motorCurrent ?: return null,
        frame.batteryCurrentMa ?: old?.batteryCurrent ?: return null,
        frame.dutyPermille ?: old?.duty ?: return null,
        frame.odometerCm ?: old?.odometer, frame.tempMosfetDeciC ?: old?.tempMosfet,
        frame.tempMotorDeciC ?: old?.tempMotor)
    }
  }
}

internal const val RIDE_SUMMARIES_CHUNK_MS = 3_600_000L

/**
 * Read-only state one Ride summaries chunk hands the next: each Board's delta chain and the last
 * precise Ride Track fix. It shapes the next chunk's output but is never written as it. Every chunk
 * re-checks it against the database, so a ride deleted between chunks cannot leak into the rebuild.
 */
class RideSummariesContext {
  internal val latestStates = mutableMapOf<String?, RebuildState>()
  internal var previousTrack: RideTrackPointEntity? = null
}

/** What one Ride summaries chunk did. Owned ranges are half-open `[from, to)` on whole minutes. */
sealed class RideSummariesChunkResult {
  /** Rebuilt `[fromMs, toMs)`; `endMs` is where this run currently stops. */
  data class Rebuilt(val toMs: Long, val endMs: Long) : RideSummariesChunkResult()
  /** Nothing left to rebuild: every old-generation minute is replaced. */
  data object Finished : RideSummariesChunkResult()
  /** The rest belongs to a potentially active ride; check again at [retryAtMs]. */
  data class ActiveRide(val retryAtMs: Long) : RideSummariesChunkResult()
}

private fun floorMinute(ms: Long) = Math.floorDiv(ms, TELEMETRY_BUCKET_SIZE_MS) * TELEMETRY_BUCKET_SIZE_MS
private fun floorChunk(ms: Long) = Math.floorDiv(ms, RIDE_SUMMARIES_CHUNK_MS) * RIDE_SUMMARIES_CHUNK_MS

/** First owned chunk start, or null for a database with no frames and no Ride Track. */
internal suspend fun VescapeDao.rideSummariesStartMs(): Long? =
  listOfNotNull(firstFrameAt(), firstRideTrackAt()).minOrNull()?.let(::floorChunk)

/**
 * Start of the derived ride that may still be recording (ADR 0041), or null when the newest sample
 * is a full split gap old. Every Board and both streams count, and a Stop Recording is ignored, so
 * the cutoff can only be earlier than the real ride start, never later.
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `activeRideStartMs`
 */
internal suspend fun VescapeDao.activeRideStartMs(nowMs: Long, gapMs: Long): Long? {
  val last = listOfNotNull(lastFrameAt(), lastRideTrackAt()).maxOrNull() ?: return null
  if (nowMs - last >= gapMs) return null
  var start = last
  while (true) {
    val earlier = listOfNotNull(firstFrameAtOrAfter(start - gapMs), firstRideTrackAtOrAfter(start - gapMs))
      .minOrNull()
    if (earlier == null || earlier >= start) return start
    start = earlier
  }
}

/**
 * Replace the complete minute buckets and exclusion portions in one owned chunk starting at
 * [fromMs], reading frames, Ride Track and boundary context in the same transaction. Live additive
 * upserts never meet a rebuilt bucket: the potentially active ride is never owned.
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `rebuildRideSummariesChunk`
 */
internal suspend fun VescapeDao.rebuildRideSummariesChunkImpl(
  fromMs: Long,
  context: RideSummariesContext,
  config: MetricSanitizerConfig,
  gapMs: Long,
  nowMs: Long,
): RideSummariesChunkResult {
  val last = listOfNotNull(lastFrameAt(), lastRideTrackAt()).maxOrNull() ?: return RideSummariesChunkResult.Finished
  val active = activeRideStartMs(nowMs, gapMs)
  val dataEnd = floorMinute(last) + TELEMETRY_BUCKET_SIZE_MS
  val end = active?.let { minOf(floorMinute(it), dataEnd) } ?: dataEnd
  if (fromMs >= end) {
    return if (active != null) RideSummariesChunkResult.ActiveRide(last + gapMs) else RideSummariesChunkResult.Finished
  }
  val toMs = minOf(floorChunk(fromMs) + RIDE_SUMMARIES_CHUNK_MS, end)

  // Context that a deletion removed since the last chunk no longer exists to carry.
  for ((boardId, state) in context.latestStates.entries.toList()) {
    if (!frameExists(state.at, boardId)) context.latestStates.remove(boardId)
  }
  context.previousTrack = context.previousTrack?.takeIf { rideTrackPointExists(it.id) }

  deleteBucketsRange(fromMs, toMs)
  trimExclusions(fromMs, toMs)

  val states = mutableListOf<RebuildState>()
  // Carry each independent delta chain across chunks, including unattributed legacy samples.
  for (row in getFrames(fromMs, toMs - 1, null, Int.MAX_VALUE)) {
    val current = RebuildState.apply(context.latestStates[row.boardId], row) ?: continue
    context.latestStates[row.boardId] = current
    states += current
  }
  states.sortBy { it.at }
  val track = getRideTrackForAggregation(fromMs, toMs - 1, null)
  // Free spin reads the nearest fix, which may sit just outside the owned span.
  val sanitizerTrack = getRideTrackForAggregation(
    fromMs - FREE_SPIN_NEAREST_GPS_MAX_AGE_MS, toMs - 1 + FREE_SPIN_NEAREST_GPS_MAX_AGE_MS, null,
  )
  val locations = track.toBucketLocationPoints(previous = context.previousTrack,
    movingThresholdCentiKmh = config.movingSpeedThresholdCentiKmh)
  context.previousTrack = track.lastOrNull { it.isPrecise() } ?: context.previousTrack
  val points = states.map { it.point() }
  val sanitization = sanitizeTelemetrySamples(points, sanitizerTrack, config)
  val sanitized = points.mapIndexed { i, point -> point.copy(
    excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed,
    excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed,
    excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty,
  ) }
  // Plain inserts: merging into a neighbouring range would rewrite another chunk's output.
  for (exclusion in sanitization.exclusions) insertExclusionRange(exclusion)
  val buckets = buildTelemetryBuckets(sanitized, locations)
  upsertBuckets(buckets)
  for (bucket in buckets) refreshBucketRoutePreview(bucket.bucketStartMs, bucket.boardId)
  return RideSummariesChunkResult.Rebuilt(toMs, end)
}

/** Remove the `[fromMs, toMs)` portion of every exclusion range, keeping what lies outside it. */
private suspend fun VescapeDao.trimExclusions(fromMs: Long, toMs: Long) {
  for (range in getExclusions(fromMs, toMs - 1, null)) {
    deleteExclusionRange(range.id)
    val span = (range.endMs - range.startMs + 1).toDouble()
    fun part(start: Long, end: Long) = range.copy(id = 0, startMs = start, endMs = end,
      sampleCount = maxOf(1, Math.round(range.sampleCount * ((end - start + 1) / span)).toInt()))
    if (range.startMs < fromMs) insertExclusionRange(part(range.startMs, fromMs - 1))
    if (range.endMs >= toMs) insertExclusionRange(part(toMs, range.endMs))
  }
}
