package expo.modules.vescapecore.telemetry

/** App-used outer transactions for maintenance operations that may span several protected ranges. */
internal class TelemetryMaintenancePersistence(
  private val dao: TelemetryDao,
) {
  suspend fun deleteRanges(
    ranges: List<TelemetryTimeRange>,
    boardId: String?,
    allBoards: Boolean,
  ): Int = dao.deleteRanges(ranges, boardId, allBoards)

  suspend fun clear(protectedRanges: List<TelemetryTimeRange>) = dao.clearExcept(protectedRanges)

  suspend fun rebuild(
    config: MetricSanitizerConfig,
    onProgress: (Int, Int) -> Unit = { _, _ -> },
  ): Int = dao.rebuildTelemetryBuckets(config, onProgress)
}

private data class RebuildState(
  val at: Long, val boardId: String?, val recordingId: String?, val speed: Int, val voltage: Int,
  val motorCurrent: Int, val batteryCurrent: Int, val duty: Int, val odometer: Long?,
  val tempMosfet: Int?, val tempMotor: Int?,
) {
  fun point() = BucketTelemetryPoint(at, boardId, recordingId ?: LEGACY_RIDE_RECORDING_ID,
    speed, voltage, motorCurrent, batteryCurrent, duty, odometer, tempMosfet, tempMotor)
  companion object {
    fun apply(previous: RebuildState?, frame: TelemetryFrameEntity): RebuildState? {
      val old = previous?.takeIf { frame.flags and TELEMETRY_FLAG_KEYFRAME == 0 && it.recordingId == frame.recordingId && it.boardId == frame.boardId }
      return RebuildState(frame.capturedAtMs, frame.boardId, frame.recordingId,
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

internal suspend fun TelemetryDao.rebuildTelemetryBucketsImpl(
  config: MetricSanitizerConfig,
  onProgress: (Int, Int) -> Unit,
): Int {
  val first = listOfNotNull(firstFrameAt(), firstRideTrackAt()).minOrNull() ?: return 0
  val last = listOfNotNull(lastFrameAt(), lastRideTrackAt()).maxOrNull() ?: return 0
  clearBuckets(); clearExclusions()
  val chunkMs = 3_600_000L
  val chunks = ((last - first) / chunkMs + 1).toInt()
  var rebuilt = 0
  onProgress(0, chunks)
  var previousTrack: RideTrackPointEntity? = null
  val latestStates = mutableMapOf<Pair<String?, String?>, RebuildState>()
  for (index in 0 until chunks) {
    val from = first + index * chunkMs; val to = minOf(from + chunkMs - 1, last)
    val states = mutableListOf<RebuildState>()
    // Carry each independent delta chain across chunks, including unattributed legacy samples.
    for (row in getFrames(from, to, null, Int.MAX_VALUE)) {
      val key = row.boardId to row.recordingId
      val current = RebuildState.apply(latestStates[key], row) ?: continue
      latestStates[key] = current
      states += current
    }
    states.sortBy { it.at }
    val track = getRideTrackForAggregation(from, to, null)
    val locations = track.toBucketLocationPoints(previous = previousTrack,
      movingThresholdCentiKmh = config.movingSpeedThresholdCentiKmh)
    previousTrack = track.lastOrNull { it.isPrecise() } ?: previousTrack
    val points = states.map { it.point() }
    val sanitization = sanitizeTelemetrySamples(points, track, config)
    val sanitized = points.mapIndexed { i, point -> point.copy(
      excludedFromAvgSpeed = sanitization.samples[i].excludedFromAvgSpeed,
      excludedFromMaxSpeed = sanitization.samples[i].excludedFromMaxSpeed,
      excludedFromMaxDuty = sanitization.samples[i].excludedFromMaxDuty,
    ) }
    upsertExclusionRanges(sanitization.exclusions)
    val buckets = buildTelemetryBuckets(sanitized, locations)
    upsertBuckets(buckets); rebuilt += buckets.size
    onProgress(index + 1, chunks)
  }
  return rebuilt
}
