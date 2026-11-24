package expo.modules.vescapecore.telemetry

import expo.modules.vescapecore.database.RideTrackPoint
import expo.modules.vescapecore.database.TELEMETRY_FLAG_KEYFRAME
import expo.modules.vescapecore.database.TELEMETRY_MASK_BATTERY_CURRENT
import expo.modules.vescapecore.database.TELEMETRY_MASK_BATTERY_VOLTAGE
import expo.modules.vescapecore.database.TELEMETRY_MASK_DUTY
import expo.modules.vescapecore.database.TELEMETRY_MASK_MOTOR_CURRENT
import expo.modules.vescapecore.database.TELEMETRY_MASK_ODOMETER
import expo.modules.vescapecore.database.TELEMETRY_MASK_SPEED
import expo.modules.vescapecore.database.TELEMETRY_MASK_TEMP_MOSFET
import expo.modules.vescapecore.database.TELEMETRY_MASK_TEMP_MOTOR
import expo.modules.vescapecore.database.TelemetryFrameEntity
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.telemetry.sanitizers.FreeSpinCarry

internal class TelemetryMaintenancePersistence(
  private val dao: VescapeDao,
) {
  suspend fun deleteRanges(
    ranges: List<TelemetryTimeRange>,
    boardId: String?,
    allBoards: Boolean,
  ): Int = dao.deleteRanges(ranges, boardId, allBoards)

  suspend fun deleteBoardRanges(rangesByBoard: Map<String?, List<TelemetryTimeRange>>): Int =
    dao.deleteBoardRanges(rangesByBoard)

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
      val keyframe = frame.flags and TELEMETRY_FLAG_KEYFRAME != 0
      val old = previous?.takeIf { !keyframe && it.boardId == frame.boardId }
      fun <T> pick(value: T?, fallback: T?, mask: Int): T? =
        if (keyframe || frame.changedMask1 and mask != 0) value else fallback
      return RebuildState(frame.capturedAtMs, frame.boardId,
        pick(frame.speedCentiKmh, old?.speed, TELEMETRY_MASK_SPEED) ?: return null,
        pick(frame.batteryVoltageMv, old?.voltage, TELEMETRY_MASK_BATTERY_VOLTAGE) ?: return null,
        pick(frame.motorCurrentMa, old?.motorCurrent, TELEMETRY_MASK_MOTOR_CURRENT) ?: return null,
        pick(frame.batteryCurrentMa, old?.batteryCurrent, TELEMETRY_MASK_BATTERY_CURRENT) ?: return null,
        pick(frame.dutyPermille, old?.duty, TELEMETRY_MASK_DUTY) ?: return null,
        pick(frame.odometerCm, old?.odometer, TELEMETRY_MASK_ODOMETER),
        pick(frame.tempMosfetDeciC, old?.tempMosfet, TELEMETRY_MASK_TEMP_MOSFET),
        pick(frame.tempMotorDeciC, old?.tempMotor, TELEMETRY_MASK_TEMP_MOTOR))
    }
  }
}

internal const val RIDE_SUMMARIES_CHUNK_MS = 3_600_000L

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `DIAGNOSTIC_EVENT_RETENTION_MS`
 */
internal const val DIAGNOSTIC_EVENT_RETENTION_MS = 30L * 24 * 60 * 60 * 1000
/** @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `DIAGNOSTIC_EVENT_PRUNE_BATCH` */
internal const val DIAGNOSTIC_EVENT_PRUNE_BATCH = 5_000

/** @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `BOARD_CONFIG_REVISION_RETENTION_PER_BOARD` */
internal const val BOARD_CONFIG_REVISION_RETENTION_PER_BOARD = 200

/** @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `BoardConfigRevisionPruneResult` */
internal data class BoardConfigRevisionPruneResult(
  val deletedRevisions: Int,
  val deletedSchemas: Int,
  val yielded: Boolean,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `pruneBoardConfigRevisions`
 */
internal suspend fun pruneBoardConfigRevisions(
  scope: MaintenanceJobScope,
  gapMs: Long,
  retainPerBoard: Int = BOARD_CONFIG_REVISION_RETENTION_PER_BOARD,
): BoardConfigRevisionPruneResult {
  val deleted = scope.chunk { dao ->
    if (dao.activeRideStartMs(scope.nowMs(), gapMs) != null) null
    else {
      val revisions = dao.pruneExcessBoardConfigRevisions(retainPerBoard)
      val schemas = dao.deleteUnreferencedBoardConfigSchemas()
      revisions to schemas
    }
  } ?: return BoardConfigRevisionPruneResult(0, 0, true)
  return BoardConfigRevisionPruneResult(deleted.first, deleted.second, false)
}

/** @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `DiagnosticEventPruneResult` */
internal data class DiagnosticEventPruneResult(val deleted: Int, val yielded: Boolean)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `pruneDiagnosticEvents`
 */
internal suspend fun pruneDiagnosticEvents(
  scope: MaintenanceJobScope,
  gapMs: Long,
  batch: Int = DIAGNOSTIC_EVENT_PRUNE_BATCH,
): DiagnosticEventPruneResult {
  val beforeMs = scope.nowMs() - DIAGNOSTIC_EVENT_RETENTION_MS
  var deleted = 0
  while (true) {
    val count = scope.chunk { dao ->
      if (dao.activeRideStartMs(scope.nowMs(), gapMs) != null) null
      else dao.deleteDiagnosticEventsBatchBefore(beforeMs, batch)
    } ?: return DiagnosticEventPruneResult(deleted, true)
    deleted += count
    scope.progress(deleted, deleted)
    if (count < batch) return DiagnosticEventPruneResult(deleted, false)
  }
}

class RideSummariesContext {
  internal val latestStates = mutableMapOf<String?, RebuildState>()
  internal var previousTrack: RideTrackPoint? = null
  internal var freeSpin = FreeSpinCarry()
}

sealed class RideSummariesChunkResult {
  data class Rebuilt(val toMs: Long, val endMs: Long) : RideSummariesChunkResult()
  data object Finished : RideSummariesChunkResult()
  data class ActiveRide(val retryAtMs: Long) : RideSummariesChunkResult()
}

private fun floorMinute(ms: Long) = Math.floorDiv(ms, TELEMETRY_BUCKET_SIZE_MS) * TELEMETRY_BUCKET_SIZE_MS
private fun floorChunk(ms: Long) = Math.floorDiv(ms, RIDE_SUMMARIES_CHUNK_MS) * RIDE_SUMMARIES_CHUNK_MS

internal suspend fun VescapeDao.rideSummariesStartMs(): Long? =
  listOfNotNull(firstFrameAt(), firstRideTrackAt()).minOrNull()?.let(::floorChunk)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryMaintenancePersistence.swift `activeRideStartMs`
 */
internal suspend fun VescapeDao.activeRideStartMs(nowMs: Long, gapMs: Long): Long? {
  val last = lastSampleAtOrBefore(nowMs) ?: return null
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

  for ((boardId, state) in context.latestStates.entries.toList()) {
    if (!frameExists(state.at, boardId)) context.latestStates.remove(boardId)
  }
  context.freeSpin = FreeSpinCarry(context.freeSpin.boards.filterValues { state ->
    state.previous?.let { frameExists(it.capturedAtMs, it.boardId) } ?: true
  })
  context.previousTrack = context.previousTrack?.takeIf { rideTrackPointExists(it.id) }

  deleteBucketsRange(fromMs, toMs)
  trimExclusions(fromMs, toMs)

  val states = mutableListOf<RebuildState>()
  for (row in getFrames(fromMs, toMs - 1, null, Int.MAX_VALUE)) {
    val current = RebuildState.apply(context.latestStates[row.boardId], row) ?: continue
    context.latestStates[row.boardId] = current
    states += current
  }
  states.sortBy { it.at }
  val track = getRideTrackForAggregation(fromMs, toMs - 1, null)
  val locations = track.toBucketLocationPoints(previous = context.previousTrack,
    movingThresholdCentiKmh = config.movingSpeedThresholdCentiKmh)
  context.previousTrack = track.lastOrNull { it.isPrecise() } ?: context.previousTrack
  val points = states.map { it.point() }
  val sanitization = sanitizeTelemetrySamples(points, config, context.freeSpin)
  context.freeSpin = sanitization.freeSpinCarry
  val sanitized = points.mapIndexed { i, point -> point.copy(
    excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed,
    excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed,
    excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty,
  ) }
  for (exclusion in sanitization.exclusions) insertExclusionRange(exclusion)
  val buckets = buildTelemetryBuckets(sanitized, locations)
  upsertBuckets(buckets)
  for (bucket in buckets) refreshBucketRoutePreview(bucket.bucketStartMs, bucket.boardId)
  return RideSummariesChunkResult.Rebuilt(toMs, end)
}

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
