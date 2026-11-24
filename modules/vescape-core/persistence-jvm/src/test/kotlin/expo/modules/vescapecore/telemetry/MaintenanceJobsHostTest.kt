package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import expo.modules.vescapecore.database.AppSettings
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.DiagnosticEventEntity
import expo.modules.vescapecore.database.MetricExclusionRangeEntity
import expo.modules.vescapecore.database.TELEMETRY_FLAG_KEYFRAME
import expo.modules.vescapecore.database.TelemetryFrameEntity
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.database.VescapeRoomDatabase

internal suspend fun rebuildRideSummaries(
  dao: VescapeDao,
  nowMs: Long = Long.MAX_VALUE / 2,
  fence: DatabaseReplacementFence = DatabaseReplacementFence(),
  committed: () -> Unit = {},
): MaintenanceJobOutcome =
  RideSummariesJob.run(MaintenanceJobScope({ dao }, fence, fence.ticket(), { nowMs }, committed = committed), AppSettings())

/**
 * @parity /modules/vescape-core/persistence-macos/MaintenanceJobsContract.swift `runMaintenanceJobsContract`
 */
class MaintenanceJobsHostTest {
  private val minute = 60_000L
  private val hour = 60 * minute
  private val board = "board-a"

  private fun db() = Room.inMemoryDatabaseBuilder<VescapeRoomDatabase>().setDriver(BundledSQLiteDriver()).build()

  private fun frame(at: Long, speed: Int = 1_000, motorCurrentMa: Int = 1_000) = TelemetryFrameEntity(
    capturedAtMs = at, elapsedRealtimeMs = at, boardId = board, canId = null,
    flags = TELEMETRY_FLAG_KEYFRAME, changedMask1 = Int.MAX_VALUE, changedMask2 = 0,
    speedCentiKmh = speed, batteryVoltageMv = 80_000, motorCurrentMa = motorCurrentMa,
    batteryCurrentMa = 500, dutyPermille = 100, pitchCentiDeg = 0, rollCentiDeg = 0,
    balancePitchCentiDeg = 0, balanceCurrentMa = 0, erpm = 1_000, state = 1,
    switchState = 1, adc1Milli = 0, adc2Milli = 0, odometerCm = at,
    tempMosfetDeciC = 300, tempMotorDeciC = 300,
  )

  @Test fun telemetryStoragePublishesProgressAndCompletesSuccessfulSeals(): Unit = runBlocking {
    val db = db()
    try {
      val dao = db.vescapeDao()
      dao.insertFrames(listOf(frame(minute)))
      val fence = DatabaseReplacementFence()
      val progress = mutableListOf<Pair<Int, Int>>()
      var committed = 0
      val scope = MaintenanceJobScope({ dao }, fence, fence.ticket(), { 100 * minute },
        progress = { done, total -> progress += done to total }, committed = { committed++ })
      val job = TelemetryStorageJob()
      val settings = AppSettings()
      assertTrue(job.hasWork(scope, settings))
      job.begin(scope, settings)
      assertEquals(MaintenanceJobOutcome.Completed, job.run(scope, settings))
      job.complete(scope, settings)
      assertEquals(listOf(1 to 1), progress)
      assertEquals(1, committed)
      assertFalse(job.hasWork(scope, settings))
      assertEquals(1, dao.getTelemetryChunkHeaders(minute, minute, board, false).single().sampleCount)
    } finally { db.close() }
  }

  @Test fun telemetryStorageFinishesFailuresAndRetriesAfterLaunchOrReplacement(): Unit = runBlocking {
    val db = db()
    try {
      val dao = db.vescapeDao()
      val fence = DatabaseReplacementFence()
      val now = 100 * minute
      fun scope() = MaintenanceJobScope({ dao }, fence, fence.ticket(), { now })
      val settings = AppSettings()
      val job = TelemetryStorageJob()
      dao.insertFrames(listOf(frame(now - 500)))
      assertFalse("open minute alone is not work", job.hasWork(scope(), settings))
      dao.insertFrames(listOf(frame(minute)))
      assertTrue(job.hasWork(scope(), settings))
      job.begin(scope(), settings)
      assertTrue("recording defers the job", job.run(scope(), settings) is MaintenanceJobOutcome.Deferred)
      dao.deleteFramesByIds(dao.getBufferFramesPage(now - 500, now, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10).map { it.id })
      dao.sealTelemetryMinute(board, minute)
      val chunk = dao.getTelemetryChunkHeaders(minute, minute, board, false).single()
      dao.updateTelemetryChunk(chunk.id, 1, chunk.sampleCount, chunk.firstAtMs, chunk.lastAtMs, byteArrayOf(0x7F))
      dao.insertFrames(listOf(frame(minute + 500)))
      assertEquals(MaintenanceJobOutcome.Completed, job.run(scope(), settings))
      job.complete(scope(), settings)
      assertFalse("failed minute does not rerun on every trigger", job.hasWork(scope(), settings))
      assertTrue("next launch retries failed minute", TelemetryStorageJob().hasWork(scope(), settings))
      fence.fence { }
      assertTrue("replacement retries in the same process", job.hasWork(scope(), settings))
      dao.publishMaintenanceFingerprint("telemetryBacklogDrain", "drained", now)
      job.hasWork(scope(), settings)
      assertNull("legacy marker cleaned up", dao.storedMaintenanceFingerprint("telemetryBacklogDrain"))
    } finally { db.close() }
  }

  private suspend fun VescapeDao.persisted() = Triple(
    getAllHistoryBucketsAsc(),
    getExclusions(Long.MIN_VALUE, Long.MAX_VALUE, null).map { it.copy(id = 0) }.sortedBy { it.startMs },
    getAllHistoryBucketsAsc().map { it.routePreview },
  )

  @Test fun rebuildingTwiceIsIdenticalAcrossMinuteAndHourEdges(): Unit = runBlocking {
    val db = db()
    val dao = db.vescapeDao()
    val edge = 10 * hour
    val spinning = edge - 500 until edge + 5_000
    dao.insertFrames((edge - 5 * minute until edge + 5 * minute step 500).map {
      if (it in spinning) frame(it, speed = 5_000, motorCurrentMa = 1_000) else frame(it, speed = 3_000, motorCurrentMa = 20_000)
    })
    dao.insertExclusionRange(MetricExclusionRangeEntity(boardId = board, reason = "live", startMs = edge - 90_000, endMs = edge + 90_000, sampleCount = 4))

    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao))
    val first = dao.persisted()
    assertEquals(10, first.first.size)
    assertTrue("free spin carries across the edge",
      first.second.any { it.reason == EXCLUSION_REASON_FREE_SPIN && it.startMs >= edge && it.startMs < edge + 10_000 })
    assertFalse("rebuild replaces both owned portions of the live range", first.second.any { it.reason == "live" })
    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao))
    assertEquals(first, dao.persisted())
    db.close()
  }

  @Test fun activeRideIsNeverTouchedAndKeepsTheJobStale(): Unit = runBlocking {
    val db = db()
    val dao = db.vescapeDao()
    val now = 100 * hour
    dao.insertFrames((10 * hour until 10 * hour + 10 * minute step 5_000).map { frame(it) })
    val active = (now - 3 * hour..now - minute step 20 * minute).toList()
    dao.insertFrames(active.map { frame(it) })
    val sentinel = buildTelemetryBuckets(active.map { BucketTelemetryPoint(it, board, 9_999, 80_000, 1_000, 500, 100, null) }, emptyList())
    dao.upsertBuckets(sentinel)
    val before = dao.getAllHistoryBucketsAsc().filter { it.bucketStartMs >= now - 3 * hour }

    val outcome = rebuildRideSummaries(dao, nowMs = now)
    assertEquals(MaintenanceJobOutcome.Deferred(active.last() + 30 * minute), outcome)
    assertEquals(before, dao.getAllHistoryBucketsAsc().filter { it.bucketStartMs >= now - 3 * hour })
    assertEquals(10, dao.getAllHistoryBucketsAsc().count { it.bucketStartMs < now - 3 * hour })
    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao, nowMs = active.last() + 30 * minute))
    assertTrue(dao.getAllHistoryBucketsAsc().none { it.maxAbsSpeedCentiKmh == 9_999 })
    db.close()
  }

  @Test fun fenceAndDeletionBetweenChunksLeaveNoGhostsOrFingerprint(): Unit = runBlocking {
    val db = db()
    val dao = db.vescapeDao()
    dao.insertFrames((0 until 3 * hour step minute).map { frame(it) })
    val fence = DatabaseReplacementFence()
    var chunks = 0
    rebuildRideSummaries(dao, fence = fence, committed = {
      if (++chunks == 1) runBlocking { TelemetryMaintenancePersistence(dao).deleteRanges(listOf(TelemetryTimeRange(hour, 2 * hour - 1)), board, allBoards = false) }
    })
    assertTrue(dao.getAllHistoryBucketsAsc().none { it.bucketStartMs in hour until 2 * hour })
    assertEquals(120, dao.getAllHistoryBucketsAsc().size)

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
    val dao = db.vescapeDao()
    assertEquals(MaintenanceJobOutcome.Completed, rebuildRideSummaries(dao))
    val settings = AppSettings(movingSpeedThresholdKmh = 2.999_999)
    val fingerprint = RideSummariesJob.fingerprint(settings)
    assertEquals("2|moving=300", fingerprint)
    dao.publishMaintenanceFingerprint(RideSummariesJob.id, fingerprint, 1)
    assertEquals(fingerprint, dao.storedMaintenanceFingerprint(RideSummariesJob.id))
    assertNotEquals(fingerprint, RideSummariesJob.fingerprint(settings.copy(movingSpeedThresholdKmh = 5.0)))
    db.close()
  }
  @Test fun cleanupRetainsRecentEventsAndRunsAgainAfterDatabaseReplacement(): Unit = runBlocking {
    val original = db()
    val replacement = db()
    try {
      var dao = original.vescapeDao()
      val fence = DatabaseReplacementFence()
      val now = 100 * 24 * hour
      val boundary = now - DIAGNOSTIC_EVENT_RETENTION_MS
      val settings = AppSettings()
      val job = MAINTENANCE_JOBS.last()
      assertTrue(job is CleanupJob)
      fun scope() = MaintenanceJobScope({ dao }, fence, fence.ticket(), { now })
      suspend fun seed() {
        for (at in listOf(boundary - 1, boundary, now - 1)) {
          dao.insertDiagnosticEvent(DiagnosticEventEntity(occurredAtMs = at, elapsedRealtimeMs = 0, eventName = "e",
            operation = null, phase = null, boardId = null, message = null, propertiesJson = "{}"))
        }
      }
      suspend fun runJob() {
        val scope = scope()
        assertTrue(job.hasWork(scope, settings))
        job.begin(scope, settings)
        assertEquals(MaintenanceJobOutcome.Completed, job.run(scope, settings))
        job.complete(scope, settings)
        assertFalse(job.hasWork(scope, settings))
        assertEquals(listOf(now - 1, boundary), dao.getDiagnosticEvents(Long.MIN_VALUE, Long.MAX_VALUE, null, 100).map { it.occurredAtMs })
      }
      seed()
      dao.insertFrames(listOf(frame(now - minute)))
      job.begin(scope(), settings)
      assertTrue(job.run(scope(), settings) is MaintenanceJobOutcome.Deferred)
      assertTrue(job.hasWork(scope(), settings))
      assertEquals(3, dao.getDiagnosticEvents(Long.MIN_VALUE, Long.MAX_VALUE, null, 100).size)
      dao.deleteFramesByIds(dao.getBufferFramesPage(now - minute, now, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10).map { it.id })
      runJob()
      assertTrue("next launch runs cleanup again", CleanupJob().hasWork(scope(), settings))
      val fingerprint = dao.storedMaintenanceFingerprint(job.id)!!
      fence.fence { dao = replacement.vescapeDao() }
      dao.publishMaintenanceFingerprint(job.id, fingerprint, now)
      seed()
      runJob()
    } finally { original.close(); replacement.close() }
  }

  @Test fun diagnosticEventPruneKeepsTheBoundaryStopsAtAFenceAndWaitsForAnActiveRide(): Unit = runBlocking {
    val db = db()
    val dao = db.vescapeDao()
    val now = 100 * 24 * hour
    val boundary = now - DIAGNOSTIC_EVENT_RETENTION_MS
    suspend fun insertEvents() = (List(5) { boundary - 1 - it } + listOf(boundary, now - 1)).forEach {
      dao.insertDiagnosticEvent(DiagnosticEventEntity(occurredAtMs = it, elapsedRealtimeMs = 0, eventName = "e",
        operation = null, phase = null, boardId = null, message = null, propertiesJson = "{}"))
    }
    suspend fun remaining() = dao.getDiagnosticEvents(Long.MIN_VALUE, Long.MAX_VALUE, null, 100).map { it.occurredAtMs }.sorted()
    val fence = DatabaseReplacementFence()
    fun scope(progress: (Int, Int) -> Unit = { _, _ -> }) =
      MaintenanceJobScope({ dao }, fence, fence.ticket(), { now }, progress)

    insertEvents()
    var fenced = false
    try {
      pruneDiagnosticEvents(scope { _, _ -> runBlocking { fence.fence { } } }, gapMs = 10 * minute, batch = 2)
    } catch (_: MaintenanceRunFenced) {
      fenced = true
    }
    assertTrue(fenced)
    assertEquals(5, remaining().size)

    assertEquals(2, pruneDiagnosticEvents(scope { _, _ -> runBlocking { dao.insertFrames(listOf(frame(now - minute))) } },
      gapMs = 10 * minute, batch = 2).deleted)
    assertEquals(3, remaining().size)

    assertEquals(0, pruneDiagnosticEvents(scope(), gapMs = 10 * minute, batch = 2).deleted)
    assertEquals(3, remaining().size)

    assertEquals(1, pruneDiagnosticEvents(scope(), gapMs = 30 * 1000, batch = 2).deleted)
    assertEquals(listOf(boundary, now - 1), remaining())
    db.close()
  }

  @Test fun cleanupPrunesOldBoardConfigRevisionsAndUnreferencedSchemas(): Unit = runBlocking {
    val db = db()
    val dao = db.vescapeDao()
    val fence = DatabaseReplacementFence()
    val now = 100 * 24 * hour
    fun scope() = MaintenanceJobScope({ dao }, fence, fence.ticket(), { now })

    dao.insertBoardConfigSchemaIfAbsent(expo.modules.vescapecore.database.BoardConfigSchemaEntity("schema-old", "<ConfigParams/>", 1))
    dao.insertBoardConfigSchemaIfAbsent(expo.modules.vescapecore.database.BoardConfigSchemaEntity("schema-kept", "<ConfigParams/>", 2))
    dao.insertBoardConfigSchemaIfAbsent(expo.modules.vescapecore.database.BoardConfigSchemaEntity("schema-last-known", "<ConfigParams/>", 3))
    dao.upsertBoardConfigValues(expo.modules.vescapecore.database.BoardConfigValuesEntity("board-a", "1.3", "{}", 10, "schema-last-known"))
    for (i in 1..4) {
      val hash = if (i <= 2) "schema-old" else "schema-kept"
      dao.insertBoardConfigRevision(
        expo.modules.vescapecore.database.BoardConfigRevisionEntity(
          boardId = "board-a",
          refloatVersion = "1.3.0",
          schemaHash = hash,
          packageSignature = 1L,
          rawConfig = byteArrayOf(i.toByte()),
          source = "app",
          changesJson = "[]",
          createdAt = i.toLong() * 100,
        ),
      )
    }
    dao.insertBoardConfigRevision(
      expo.modules.vescapecore.database.BoardConfigRevisionEntity(
        boardId = "board-b",
        refloatVersion = "1.3.0",
        schemaHash = "schema-kept",
        packageSignature = 1L,
        rawConfig = byteArrayOf(9),
        source = "external",
        changesJson = "[]",
        createdAt = 500L,
      ),
    )

    val result = pruneBoardConfigRevisions(scope(), gapMs = 30 * minute, retainPerBoard = 2)
    assertEquals(2, result.deletedRevisions)
    assertEquals(1, result.deletedSchemas)
    assertEquals(false, result.yielded)
    assertEquals(listOf(400L, 300L), dao.getBoardConfigRevisions("board-a", 10).map { it.createdAt })
    assertEquals(1, dao.getBoardConfigRevisions("board-b", 10).size)
    assertEquals(null, dao.getBoardConfigSchema("schema-old"))
    assertEquals("<ConfigParams/>", dao.getBoardConfigSchema("schema-kept")?.rawXml)
    assertEquals("<ConfigParams/>", dao.getBoardConfigSchema("schema-last-known")?.rawXml)
    db.close()
  }
}
