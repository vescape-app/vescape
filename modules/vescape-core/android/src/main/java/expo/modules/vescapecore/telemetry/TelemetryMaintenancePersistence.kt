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
  val at: Long, val boardId: String?, val speed: Int, val voltage: Int, val motorCurrent: Int,
  val batteryCurrent: Int, val duty: Int, val odometer: Long?, val tempMosfet: Int?,
  val tempMotor: Int?, val latitudeE7: Int?, val longitudeE7: Int?, val gpsSpeed: Int?,
  val gpsAt: Long?, val accuracyCm: Int?,
) {
  fun point() = BucketTelemetryPoint(at, boardId, speed, voltage, motorCurrent, batteryCurrent, duty,
    odometer, tempMosfet, tempMotor, gpsSpeed, gpsAt, accuracyCm)
  fun location(previous: RebuildState?): BucketLocationPoint? {
    val lat = latitudeE7 ?: return null; val lon = longitudeE7 ?: return null
    val previousDistance = previous?.takeIf { it.latitudeE7 != null && it.longitudeE7 != null }?.let {
      val dx = (lat - it.latitudeE7!!) * 1.11; val dy = (lon - it.longitudeE7!!) * 1.11
      kotlin.math.sqrt(dx * dx + dy * dy).toLong()
    }
    return BucketLocationPoint(at, boardId, (accuracyCm ?: Int.MAX_VALUE) <= 2_000, previousDistance, gpsSpeed, lat, lon)
  }

  companion object {
    fun apply(previous: RebuildState?, frame: TelemetryFrameEntity): RebuildState? {
      fun <T> pick(value: T?, old: T?): T? = value ?: old
      val locationChanged = frame.changedMask2 and TELEMETRY_MASK2_LOCATION != 0
      return RebuildState(
        frame.capturedAtMs, frame.boardId ?: previous?.boardId,
        pick(frame.speedCentiKmh, previous?.speed) ?: return null,
        pick(frame.batteryVoltageMv, previous?.voltage) ?: return null,
        pick(frame.motorCurrentMa, previous?.motorCurrent) ?: return null,
        pick(frame.batteryCurrentMa, previous?.batteryCurrent) ?: return null,
        pick(frame.dutyPermille, previous?.duty) ?: return null,
        pick(frame.odometerCm, previous?.odometer), pick(frame.tempMosfetDeciC, previous?.tempMosfet),
        pick(frame.tempMotorDeciC, previous?.tempMotor),
        if (locationChanged) frame.latitudeE7 else previous?.latitudeE7,
        if (locationChanged) frame.longitudeE7 else previous?.longitudeE7,
        if (locationChanged) frame.gpsSpeedCentiMps else previous?.gpsSpeed,
        if (locationChanged) frame.locationTimestampMs ?: frame.capturedAtMs else previous?.gpsAt,
        if (locationChanged) frame.accuracyCm else previous?.accuracyCm,
      )
    }
  }
}

internal suspend fun TelemetryDao.rebuildTelemetryBucketsImpl(
  config: MetricSanitizerConfig,
  onProgress: (Int, Int) -> Unit,
): Int {
  val first = firstFrameAt() ?: return 0
  val last = lastFrameAt() ?: return 0
  clearBuckets(); clearExclusions()
  val chunkMs = 3_600_000L
  val chunks = ((last - first) / chunkMs + 1).toInt()
  var rebuilt = 0
  onProgress(0, chunks)
  for (index in 0 until chunks) {
    val from = first + index * chunkMs; val to = minOf(from + chunkMs - 1, last)
    val keyframe = getLatestKeyframeBefore(from, null)
    val rows = getFrames(keyframe?.capturedAtMs ?: from, to, null, Int.MAX_VALUE)
    var state: RebuildState? = null
    var previousLocation: RebuildState? = null
    val states = mutableListOf<RebuildState>()
    val locations = mutableListOf<BucketLocationPoint>()
    for (row in rows) {
      state = RebuildState.apply(state, row)
      val current = state ?: continue
      if (row.capturedAtMs < from) { previousLocation = current; continue }
      states += current
      current.location(previousLocation)?.let { locations += it; previousLocation = current }
    }
    val points = states.map { it.point() }
    val sanitization = sanitizeTelemetrySamples(points, config)
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
