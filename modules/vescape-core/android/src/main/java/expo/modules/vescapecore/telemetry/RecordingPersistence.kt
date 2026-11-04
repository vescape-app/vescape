package expo.modules.vescapecore.telemetry

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import expo.modules.vescapecore.database.MetricExclusionRangeEntity
import expo.modules.vescapecore.database.RideTrackPointEntity
import expo.modules.vescapecore.database.TelemetryFrameEntity
import expo.modules.vescapecore.database.TelemetryMarkerEntity
import expo.modules.vescapecore.database.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.database.VescapeDao

/** Host-runnable recording transaction seam. OS lifecycle stays in [TelemetryRepository]. */
internal class RecordingPersistence(private val dao: VescapeDao) {
  suspend fun commit(
    frames: List<TelemetryFrameEntity>,
    buckets: Collection<TelemetryMinuteBucketEntity>,
    markers: List<TelemetryMarkerEntity>,
    exclusions: List<MetricExclusionRangeEntity> = emptyList(),
    trackPoints: List<RideTrackPointEntity> = emptyList(),
  ) = dao.insertBatch(frames, buckets, markers, exclusions, trackPoints)

  suspend fun readCommittedRide(): List<TelemetryMinuteBucketEntity> = dao.getAllHistoryBucketsAsc()
}

/** Process-lifetime fail-closed gate around Ride Recording ingestion and commits. */
internal class RecordingWriteGate(
  private val onFailure: (Exception) -> Unit,
  initiallyAccepting: Boolean = true,
) {
  @Volatile private var accepting = initiallyAccepting

  fun isAccepting(): Boolean = accepting

  fun fail(error: Exception) {
    synchronized(this) {
      if (!accepting) return
      accepting = false
    }
    onFailure(error)
  }
}

/** App-used transaction boundary: failed commit closes ingestion before another batch can enter. */
internal class RecordingCommitBoundary(
  private val persistence: RecordingPersistence,
  onFailure: (Exception) -> Unit,
  initiallyAccepting: Boolean = true,
) {
  private val gate = RecordingWriteGate(onFailure, initiallyAccepting)
  private val mutex = Mutex()
  fun isAccepting(): Boolean = gate.isAccepting()
  fun fail(error: Exception) = gate.fail(error)

  suspend fun commit(
    frames: List<TelemetryFrameEntity>,
    buckets: Collection<TelemetryMinuteBucketEntity>,
    markers: List<TelemetryMarkerEntity>,
    exclusions: List<MetricExclusionRangeEntity> = emptyList(),
    trackPoints: List<RideTrackPointEntity> = emptyList(),
  ): Boolean = mutex.withLock {
    if (!gate.isAccepting()) return@withLock false
    return@withLock try {
      persistence.commit(frames, buckets, markers, exclusions, trackPoints)
      true
    } catch (error: Exception) {
      gate.fail(error)
      false
    }
  }
}
