package expo.modules.vescapecore.telemetry

/** Host-runnable recording transaction seam. OS lifecycle stays in [TelemetryRepository]. */
internal class RecordingPersistence(private val dao: TelemetryDao) {
  suspend fun commit(
    frames: List<TelemetryFrameEntity>,
    buckets: Collection<TelemetryMinuteBucketEntity>,
    markers: List<TelemetryMarkerEntity>,
    exclusions: List<MetricExclusionRangeEntity> = emptyList(),
  ) = dao.insertBatch(frames, buckets, markers, exclusions)

  suspend fun readCommittedRide(): List<TelemetryMinuteBucketEntity> = dao.getAllHistoryBucketsAsc()
}
