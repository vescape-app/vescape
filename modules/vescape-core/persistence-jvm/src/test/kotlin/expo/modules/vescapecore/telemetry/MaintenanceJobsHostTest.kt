package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** Rebuild every ride summary the way the runner does, without fingerprint bookkeeping. */
internal suspend fun rebuildRideSummaries(
  dao: TelemetryDao,
  nowMs: Long = Long.MAX_VALUE / 2,
  fence: DatabaseReplacementFence = DatabaseReplacementFence(),
  committed: () -> Unit = {},
): MaintenanceJobOutcome =
  RideSummariesJob.run(MaintenanceJobScope({ dao }, fence, fence.ticket(), { nowMs }, committed = committed), AppSettings())

/**
 * Ride summaries Maintenance Job (#605) through the production Room DAO and fence.
 * @parity /modules/vescape-core/persistence-macos/MaintenanceJobsContract.swift `runMaintenanceJobsContract`
 */
class MaintenanceJobsHostTest {
  private val minute = 60_000L
  private val hour = 60 * minute
  private val board = "board-a"

  private fun db() = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()

  private fun frame(at: Long, speed: Int = 1_000) = TelemetryFrameEntity(
    capturedAtMs = at, elapsedRealtimeMs = at, boardId = board, canId = null,
    flags = TELEMETRY_FLAG_KEYFRAME, changedMask1 = Int.MAX_VALUE, changedMask2 = 0,
    speedCentiKmh = speed, batteryVoltageMv = 80_000, motorCurrentMa = 1_000,
    batteryCurrentMa = 500, dutyPermille = 100, pitchCentiDeg = 0, rollCentiDeg = 0,
    balancePitchCentiDeg = 0, balanceCurrentMa = 0, erpm = 1_000, state = 1,
    switchState = 1, adc1Milli = 0, adc2Milli = 0, odometerCm = at,
    tempMosfetDeciC = 300, tempMotorDeciC = 300,
  )

  private fun fix(at: Long, speedCentiMps: Int, lat: Int = 520_000_000) = RideTrackPointEntity(
    boardId = board, fixAtMs = at, latitudeE7 = lat + (at / 1_000).toInt(), longitudeE7 = 210_000_000,
    accuracyCm = 500, gpsSpeedCentiMps = speedCentiMps, bearingCentiDeg = null, altitudeCm = null,
  )

  private suspend fun TelemetryDao.persisted() = Triple(
    getAllHistoryBucketsAsc(),
    getExclusions(Long.MIN_VALUE, Long.MAX_VALUE, null).map { it.copy(id = 0) }.sortedBy { it.startMs },
    getAllHistoryBucketsAsc().map { it.routePreview },
  )

  @Test fun rebuildingTwiceIsIdenticalAcrossMinuteAndHourEdges(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    val edge = 10 * hour
    // A ride across the hour edge: fast board, a standing GPS fix just before the edge, so free
    // spin needs the nearest-fix context from the previous chunk.
    dao.insertFrames((edge - 5 * minute until edge + 5 * minute step 2_000).map { frame(it, speed = 3_000) })
    dao.insertRideTrackPoints(listOf(fix(edge - 3_000, 0)) + (edge + 20_000 until edge + 4 * minute step 5_000).map { fix(it, 800) })
    // A live-written range crossing the edge; its outside portion is not another chunk's output.
    dao.insertExclusionRange(MetricExclusionRangeEntity(boardId = board, reason = "live", startMs = edge - 90_000, endMs = edge + 90_000, sampleCount = 4))

    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao))
    val first = dao.persisted()
    assertEquals(10, first.first.size)
    assertTrue("free spin sees the fix across the edge",
      first.second.any { it.reason == EXCLUSION_REASON_FREE_SPIN && it.startMs >= edge && it.startMs < edge + 10_000 })
    assertFalse("rebuild replaces both owned portions of the live range", first.second.any { it.reason == "live" })
    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao))
    assertEquals(first, dao.persisted())
    db.close()
  }

  @Test fun activeRideIsNeverTouchedAndKeepsTheJobStale(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    val now = 100 * hour
    dao.insertFrames((10 * hour until 10 * hour + 10 * minute step 5_000).map { frame(it) })
    // A three-hour ride still recording: samples every 20 minutes, inside the 30-minute split gap.
    val active = (now - 3 * hour..now - minute step 20 * minute).toList()
    dao.insertFrames(active.map { frame(it) })
    val sentinel = buildTelemetryBuckets(active.map { BucketTelemetryPoint(it, board, 9_999, 80_000, 1_000, 500, 100, null) }, emptyList())
    dao.upsertBuckets(sentinel)
    val before = dao.getAllHistoryBucketsAsc().filter { it.bucketStartMs >= now - 3 * hour }

    val outcome = rebuildRideSummaries(dao, nowMs = now)
    assertEquals(MaintenanceJobOutcome.Deferred(active.last() + 30 * minute), outcome)
    assertEquals(before, dao.getAllHistoryBucketsAsc().filter { it.bucketStartMs >= now - 3 * hour })
    assertEquals(10, dao.getAllHistoryBucketsAsc().count { it.bucketStartMs < now - 3 * hour })
    // Once the gap has passed, the closed ride is rebuilt with the rest.
    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao, nowMs = active.last() + 30 * minute))
    assertTrue(dao.getAllHistoryBucketsAsc().none { it.maxAbsSpeedCentiKmh == 9_999 })
    db.close()
  }

  @Test fun fenceAndDeletionBetweenChunksLeaveNoGhostsOrFingerprint(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    dao.insertFrames((0 until 3 * hour step minute).map { frame(it) })
    val fence = DatabaseReplacementFence()
    var chunks = 0
    // Ride deletion after the first chunk: the second hour must not come back from carried state.
    rebuildRideSummaries(dao, fence = fence, committed = {
      if (++chunks == 1) runBlocking { TelemetryMaintenancePersistence(dao).deleteRanges(listOf(TelemetryTimeRange(hour, 2 * hour - 1)), board, allBoards = false) }
    })
    assertTrue(dao.getAllHistoryBucketsAsc().none { it.bucketStartMs in hour until 2 * hour })
    assertEquals(120, dao.getAllHistoryBucketsAsc().size)

    // Restore/Clear all bump the generation mid-run: the next chunk throws and nothing is published.
    var fenced = false
    try {
      rebuildRideSummaries(dao, fence = fence, committed = { runBlocking { fence.fence { } } })
    } catch (_: MaintenanceRunFenced) {
      fenced = true
    }
    assertTrue(fenced)
    assertEquals(120, dao.getAllHistoryBucketsAsc().size)
    assertNull(dao.storedMaintenanceFingerprint(RideSummariesJob.id))
    db.close()
  }

  @Test fun fingerprintCarriesVersionAndNormalizedInputs(): Unit = runBlocking {
    val db = db()
    val dao = db.telemetryDao()
    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao))
    val settings = AppSettings(movingSpeedThresholdKmh = 2.999_999)
    val fingerprint = RideSummariesJob.fingerprint(settings)
    assertEquals("1|moving=300|freeSpinDelta=1200|freeSpinCap=1500", fingerprint)
    dao.publishMaintenanceFingerprint(RideSummariesJob.id, fingerprint, 1)
    assertEquals(fingerprint, dao.storedMaintenanceFingerprint(RideSummariesJob.id))
    assertNotEquals(fingerprint, RideSummariesJob.fingerprint(settings.copy(freeSpinMaxSpeedDeltaKmh = 10.0)))
    db.close()
  }
}
