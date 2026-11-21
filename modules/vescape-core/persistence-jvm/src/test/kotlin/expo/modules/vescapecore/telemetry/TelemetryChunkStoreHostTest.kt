package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.io.File
import java.io.StringWriter
import java.nio.file.Files
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import expo.modules.vescapecore.database.BoardEntity
import expo.modules.vescapecore.database.DatabaseReplacementFence
import expo.modules.vescapecore.database.TELEMETRY_FLAG_KEYFRAME
import expo.modules.vescapecore.database.TELEMETRY_MASK_SPEED
import expo.modules.vescapecore.database.TELEMETRY_MASK_TEMP_MOSFET
import expo.modules.vescapecore.database.TelemetryFrameEntity
import expo.modules.vescapecore.database.TelemetryMinuteBucketEntity
import expo.modules.vescapecore.database.VescapeDao
import expo.modules.vescapecore.database.VescapeRoomDatabase

/**
 * @parity /modules/vescape-core/persistence-macos/main.swift `runTelemetryChunkContract`
 */
class TelemetryChunkStoreHostTest {
  private val minute = 60_000L
  private val t0 = 100 * minute
  private val board = "board-a"
  private val boards = listOf<String?>(board, null)

  private fun memory() = Room.inMemoryDatabaseBuilder<VescapeRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
  private fun file(path: String) = Room.databaseBuilder<VescapeRoomDatabase>(path).setDriver(BundledSQLiteDriver()).build()

  private fun recording(boardId: String?, fromMs: Long = t0, minutes: Int = 4) = (0 until minutes * 120).map { i ->
    val at = fromMs + i * 500L
    val keyframe = i % 120 == 7
    val temp = if (i % 20 == 0) null else 300 + i
    TelemetryFrameEntity(
      capturedAtMs = at, elapsedRealtimeMs = at / 2, boardId = boardId, canId = if (keyframe) 4 else null,
      flags = if (keyframe) TELEMETRY_FLAG_KEYFRAME else 0,
      changedMask1 = if (keyframe) (1 shl 17) - 1 else TELEMETRY_MASK_SPEED or (if (i % 10 == 0) TELEMETRY_MASK_TEMP_MOSFET else 0),
      changedMask2 = 0, speedCentiKmh = i * 3,
      batteryVoltageMv = if (keyframe) 80_000 + i else null, motorCurrentMa = if (keyframe) 1_000 else null,
      batteryCurrentMa = if (keyframe) 500 else null, dutyPermille = if (keyframe) 100 else null,
      pitchCentiDeg = if (keyframe) -5 else null, rollCentiDeg = if (keyframe) 7 else null,
      balancePitchCentiDeg = if (keyframe) 1 else null, balanceCurrentMa = if (keyframe) 0 else null,
      erpm = if (keyframe) 1_200 else null, state = if (keyframe) 2 else null, switchState = if (keyframe) 1 else null,
      adc1Milli = if (keyframe) 10 else null, adc2Milli = if (keyframe) 20 else null,
      odometerCm = if (keyframe) 5_000_000_000L + i else null,
      tempMosfetDeciC = if (keyframe || i % 10 == 0) temp else null, tempMotorDeciC = if (keyframe) 250 else null,
    )
  }

  private suspend fun VescapeDao.seed() {
    upsertBoard(BoardEntity(board, "Board A", null, 1))
    for (owner in boards) insertFrames(recording(owner))
  }

  private suspend fun VescapeDao.seal(minutes: IntRange) {
    for (m in minutes) for (owner in boards) sealTelemetryMinute(owner, t0 + m * minute)
  }

  private suspend fun VescapeDao.canonical(fromMs: Long, toMs: Long, boardId: String?): List<Pair<Long, List<Long?>>> {
    val values = arrayOfNulls<Long>(TELEMETRY_CHUNK_VALUE_COLUMNS)
    val start = telemetryAnchorMs(fromMs + 1, boardId, false) ?: fromMs
    return readTelemetryFramesImpl(start, toMs, boardId, false, Long.MIN_VALUE, Long.MIN_VALUE, Int.MAX_VALUE).mapNotNull { f ->
      reconstructTelemetryValues(values, f.flags, f.changedMask1, arrayOf(f.speedCentiKmh?.toLong(), f.batteryVoltageMv?.toLong(),
        f.motorCurrentMa?.toLong(), f.batteryCurrentMa?.toLong(), f.dutyPermille?.toLong(), f.pitchCentiDeg?.toLong(),
        f.rollCentiDeg?.toLong(), f.balancePitchCentiDeg?.toLong(), f.balanceCurrentMa?.toLong(), f.erpm?.toLong(),
        f.state?.toLong(), f.switchState?.toLong(), f.adc1Milli?.toLong(), f.adc2Milli?.toLong(), f.odometerCm,
        f.tempMosfetDeciC?.toLong(), f.tempMotorDeciC?.toLong()))
      if (f.capturedAtMs < fromMs) null else f.capturedAtMs to values.toList()
    }
  }

  private suspend fun VescapeDao.csv(fromMs: Long, toMs: Long, boardId: String?) =
    StringWriter().also { RideExport.writeCsv(this, it, fromMs, toMs, boardId) }.toString()

  private suspend fun assertSameReads(expected: VescapeDao, actual: VescapeDao) {
    val windows = listOf(
      t0 to t0 + 4 * minute,
      t0 + 30_000 to t0 + 90_000,
      t0 + 2 * minute + 1_000 to t0 + 3 * minute,
      t0 + 61_000 to t0 + 61_000,
    )
    for (owner in boards) for ((from, to) in windows) {
      assertEquals("$owner $from..$to", expected.canonical(from, to, owner), actual.canonical(from, to, owner))
      assertEquals("export $owner $from..$to", expected.csv(from, to, owner), actual.csv(from, to, owner))
    }
    assertEquals(expected.countFrames(), actual.countFrames())
    assertEquals(expected.firstFrameAt(), actual.firstFrameAt())
    assertEquals(expected.lastFrameAt(), actual.lastFrameAt())
    for (at in listOf(t0 - 1, t0 + 30_250, t0 + 59_999, t0 + 4 * minute)) {
      assertEquals("first at or after $at", expected.firstFrameAtOrAfter(at), actual.firstFrameAtOrAfter(at))
    }
    for (at in listOf(t0 + 30_500, t0 + 30_250, t0 + 2 * minute)) for (owner in boards + "other") {
      assertEquals("exists $owner $at", expected.frameExists(at, owner), actual.frameExists(at, owner))
    }
    fun everyBoard(dao: VescapeDao) = runBlocking { dao.getFrames(t0, t0 + 4 * minute, null, 10_000) }
      .map { it.capturedAtMs to it.boardId }.also { read -> assertEquals(read.map { it.first }.sorted(), read.map { it.first }) }
      .sortedWith(compareBy({ it.first }, { it.second ?: "" }))
    assertEquals(everyBoard(expected), everyBoard(actual))
  }

  @Test fun consecutiveSealsReadLikeTheBuffer(): Unit = runBlocking {
    val reference = memory()
    val sealed = memory()
    try {
      reference.vescapeDao().seed()
      sealed.vescapeDao().seed()
      sealed.vescapeDao().seal(0..1)
      assertEquals(0, sealed.vescapeDao().getBufferFramesPage(t0, t0 + 2 * minute - 1, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10).size)
      assertEquals(4, sealed.vescapeDao().getTelemetryChunkHeaders(t0, t0 + 4 * minute, null, true).size)
      assertSameReads(reference.vescapeDao(), sealed.vescapeDao())
      val ids = sealed.vescapeDao().getFrames(t0, t0 + 4 * minute, null, 10_000).map { it.id }
      assertEquals("every sample has its own id", ids.size, ids.toSet().size)
    } finally { reference.close(); sealed.close() }
  }

  @Test fun deletesAndFavoriteProtectionKeepEverySurvivingSample(): Unit = runBlocking {
    val reference = memory()
    val sealed = memory()
    try {
      for (db in listOf(reference, sealed)) db.vescapeDao().seed()
      val truth = boards.associateWith { reference.vescapeDao().canonical(t0, t0 + 4 * minute, it) }
      val dao = sealed.vescapeDao()
      dao.seal(0..2)
      suspend fun assertSurvivors(kept: (Long, String?) -> Boolean) {
        for (owner in boards) {
          assertEquals("$owner", truth.getValue(owner).filter { kept(it.first, owner) }, dao.canonical(t0, t0 + 4 * minute, owner))
        }
      }
      assertEquals(121, dao.deleteRange(t0 + 20_000, t0 + 80_000, board))
      val deleted = { at: Long, owner: String? -> owner == board && at in t0 + 20_000..t0 + 80_000 }
      assertSurvivors { at, owner -> !deleted(at, owner) }
      dao.clearExcept(listOf(TelemetryTimeRange(t0 + 100_000, t0 + 130_000)))
      assertSurvivors { at, owner -> !deleted(at, owner) && at in t0 + 100_000..t0 + 130_000 }
      assertEquals(2 * 61L, dao.countFrames())
      dao.deleteBefore(t0 + 120_000)
      assertSurvivors { at, _ -> at in t0 + 120_000..t0 + 130_000 }
      dao.clearAll()
      assertEquals(0L, dao.countFrames())
      assertEquals(0, dao.getTelemetryChunkHeaders(Long.MIN_VALUE, Long.MAX_VALUE, null, true).size)
    } finally { reference.close(); sealed.close() }
  }

  @Test fun lateSampleOfASealedMinuteMergesOnTheNextSeal(): Unit = runBlocking {
    val reference = memory()
    val sealed = memory()
    try {
      for (db in listOf(reference, sealed)) db.vescapeDao().seed()
      sealed.vescapeDao().seal(0..0)
      val late = recording(board, t0 + 250, 1)[20]
      for (db in listOf(reference, sealed)) db.vescapeDao().insertFrames(listOf(late))
      assertSameReads(reference.vescapeDao(), sealed.vescapeDao())
      assertEquals(1, sealed.vescapeDao().sealTelemetryMinute(board, t0))
      assertSameReads(reference.vescapeDao(), sealed.vescapeDao())
      val chunk = sealed.vescapeDao().getTelemetryChunkHeaders(t0, t0, board, false).single()
      assertEquals(121, chunk.sampleCount)
    } finally { reference.close(); sealed.close() }
  }

  private val drainNow = t0 + 4 * minute
  private val drainGapMs = 500L

  private fun drainScope(db: VescapeRoomDatabase, fence: DatabaseReplacementFence, progress: (Int, Int) -> Unit = { _, _ -> }) =
    MaintenanceJobScope({ db.vescapeDao() }, fence, fence.ticket(), { drainNow }, progress)

  private suspend fun VescapeDao.seedLeftovers(backlog: List<TelemetryFrameEntity>, late: TelemetryFrameEntity, sealFirst: Boolean) {
    seed()
    insertFrames(backlog)
    if (sealFirst) seal(0..0)
    insertFrames(listOf(late))
  }

  @Test fun drainSealsEveryClosedMinuteAndLeavesTheOpenOne(): Unit = runBlocking {
    val reference = memory()
    val drained = memory()
    try {
      val backlog = recording(board, t0 - 30 * minute, 2)
      val late = recording(board, t0 + 250, 1)[20]
      reference.vescapeDao().seedLeftovers(backlog, late, sealFirst = false)
      drained.vescapeDao().seedLeftovers(backlog, late, sealFirst = true)
      val failures = mutableListOf<TelemetryMinuteKey>()
      val result = drainTelemetryBuffer(drainScope(drained, DatabaseReplacementFence()), drainGapMs, batch = 3) { key, _ -> failures += key }
      assertEquals(TelemetryDrainResult(minutes = 7, sealedMinutes = 7, failures = 0, yielded = false), result)
      assertEquals(emptyList<TelemetryMinuteKey>(), failures)
      val dao = drained.vescapeDao()
      assertEquals(0, dao.getBufferFramesPage(Long.MIN_VALUE, t0 + 3 * minute - 1, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10).size)
      assertEquals("open minute untouched", 2 * 120,
        dao.getBufferFramesPage(t0 + 3 * minute, drainNow, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10_000).size)
      assertEquals("late sample merged, no second chunk", 121, dao.getTelemetryChunkHeaders(t0, t0, board, false).single().sampleCount)
      assertSameReads(reference.vescapeDao(), dao)
      assertEquals(reference.vescapeDao().canonical(0, t0, board), dao.canonical(0, t0, board))
      assertEquals(TelemetryDrainResult(0, 0, 0, false), drainTelemetryBuffer(drainScope(drained, DatabaseReplacementFence()), drainGapMs) { _, _ -> })
    } finally { reference.close(); drained.close() }
  }

  @Test fun drainYieldsToARecordingRide(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      dao.seed()
      val result = drainTelemetryBuffer(drainScope(db, DatabaseReplacementFence()), gapMs = 10 * minute) { _, _ -> }
      assertEquals(TelemetryDrainResult(minutes = 6, sealedMinutes = 0, failures = 0, yielded = true), result)
      assertEquals(4 * 2 * 120, dao.getBufferFramesPage(Long.MIN_VALUE, Long.MAX_VALUE, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10_000).size)
    } finally { db.close() }
  }

  @Test fun fencedDrainEndsConsistentAndResumes(): Unit = runBlocking {
    val reference = memory()
    val drained = memory()
    try {
      val backlog = recording(board, t0 - 30 * minute, 2)
      val late = recording(board, t0 + 250, 1)[20]
      reference.vescapeDao().seedLeftovers(backlog, late, sealFirst = false)
      drained.vescapeDao().seedLeftovers(backlog, late, sealFirst = false)
      val fence = DatabaseReplacementFence()
      val interrupted = drainScope(drained, fence) { done, _ -> if (done == 2) runBlocking { fence.fence { } } }
      assertThrows(MaintenanceRunFenced::class.java) { runBlocking { drainTelemetryBuffer(interrupted, drainGapMs, batch = 2) { _, _ -> } } }
      val dao = drained.vescapeDao()
      assertEquals("only the first batch committed", 2, dao.getTelemetryChunkHeaders(Long.MIN_VALUE, Long.MAX_VALUE, null, true).size)
      assertSameReads(reference.vescapeDao(), dao)
      val resumed = drainTelemetryBuffer(drainScope(drained, fence), drainGapMs, batch = 2) { _, _ -> }
      assertEquals(TelemetryDrainResult(minutes = 6, sealedMinutes = 6, failures = 0, yielded = false), resumed)
      assertSameReads(reference.vescapeDao(), dao)
      assertEquals(reference.vescapeDao().canonical(0, t0, board), dao.canonical(0, t0, board))
    } finally { reference.close(); drained.close() }
  }

  @Test fun drainSkipsAMinuteThatFailsToEncodeOrDecode(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      dao.upsertBoard(BoardEntity(board, "Board A", null, 1))
      dao.insertFrames(recording(board, t0 - 30 * minute, 1) + recording(null, t0 - 20 * minute, 1) + recording(board, t0 - 10 * minute, 1))
      dao.sealTelemetryMinute(null, t0 - 20 * minute)
      val chunk = dao.getTelemetryChunkHeaders(t0 - 20 * minute, t0 - 20 * minute, null, false).single()
      dao.updateTelemetryChunk(chunk.id, TelemetryChunkCodec.VERSION, chunk.sampleCount, chunk.firstAtMs, chunk.lastAtMs, byteArrayOf(0x7F))
      dao.insertFrames(listOf(recording(null, t0 - 20 * minute + 250, 1)[20]))
      val failures = mutableListOf<TelemetryMinuteKey>()
      val result = drainTelemetryBuffer(drainScope(db, DatabaseReplacementFence()), drainGapMs) { key, _ -> failures += key }
      assertEquals(TelemetryDrainResult(minutes = 3, sealedMinutes = 2, failures = 1, yielded = false), result)
      assertEquals(listOf(TelemetryMinuteKey(null, t0 - 20 * minute)), failures)
      assertEquals(listOf(t0 - 20 * minute + 250 + 20 * 500),
        dao.getBufferFramesPage(Long.MIN_VALUE, Long.MAX_VALUE, null, true, Long.MIN_VALUE, Long.MIN_VALUE, 10_000).map { it.capturedAtMs })
    } finally { db.close() }
  }

  @Test fun drainLeavesMinutesThatCloseDuringTheRun(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      dao.seed()
      var now = drainNow
      val fence = DatabaseReplacementFence()
      val scope = MaintenanceJobScope({ dao }, fence, fence.ticket(), { now }, { done, _ -> if (done == 2) now += minute })
      assertEquals(TelemetryDrainResult(6, 6, 0, false), drainTelemetryBuffer(scope, drainGapMs, batch = 2) { _, _ -> })
      assertEquals(TelemetryDrainResult(2, 2, 0, false), drainTelemetryBuffer(scope, drainGapMs) { _, _ -> })
    } finally { db.close() }
  }

  @Test fun futureDatedSampleDoesNotBlockTheDrain(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      dao.insertFrames(recording(board, t0 - 30 * minute, 2) + recording(board, drainNow + 60 * minute, 1)[7])
      val result = drainTelemetryBuffer(drainScope(db, DatabaseReplacementFence()), gapMs = 10 * minute) { _, _ -> }
      assertEquals(TelemetryDrainResult(minutes = 2, sealedMinutes = 2, failures = 0, yielded = false), result)
      assertNull(dao.activeRideStartMs(drainNow, 10 * minute))
    } finally { db.close() }
  }

  @Test fun clearAllForgetsTheDrainedMarker(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      for (protected in listOf(emptyList(), listOf(TelemetryTimeRange(t0, t0 + minute)))) {
        dao.publishMaintenanceFingerprint("telemetryStorage", "drained", drainNow)
        dao.clearExcept(protected)
        assertNull(dao.storedMaintenanceFingerprint("telemetryStorage"))
      }
    } finally { db.close() }
  }

  @Test fun readsRacingSealsSeeEverySampleExactlyOnce(): Unit = runBlocking {
    val dir = Files.createTempDirectory("telemetry-chunk-race").toFile()
    val db = file(File(dir, "race.db").path)
    try {
      val dao = db.vescapeDao()
      dao.upsertBoard(BoardEntity(board, "Board A", null, 1))
      val minutes = 12
      val frames = recording(board, t0, minutes)
      dao.insertFrames(frames)
      val expected = frames.map { it.capturedAtMs }
      val sealer = async(Dispatchers.IO) { for (m in 0 until minutes) dao.sealTelemetryMinute(board, t0 + m * minute) }
      var reads = 0
      while (!sealer.isCompleted || reads == 0) {
        val read = async(Dispatchers.IO) { dao.getFrames(t0, t0 + minutes * minute, board, Int.MAX_VALUE) }.await()
        assertEquals(expected, read.map { it.capturedAtMs })
        reads++
      }
      sealer.await()
      assertEquals(expected, dao.getFrames(t0, t0 + minutes * minute, board, Int.MAX_VALUE).map { it.capturedAtMs })
      assertEquals(0, dao.getBufferFramesPage(t0, t0 + minutes * minute, board, false, Long.MIN_VALUE, Long.MIN_VALUE, 10).size)
    } finally { db.close(); dir.deleteRecursively() }
  }

  @Test fun limitedAnchoredReadsKeepTheirPageAfterSealing(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      dao.seed()
      dao.seal(0..0)
      for (from in listOf(t0 + 50_250, t0 + minute + 250)) {
        val read = dao.getAnchoredFrames(from, t0 + 4 * minute, board, 10).filter { it.capturedAtMs >= from }
        assertEquals("from $from", (1..10).map { from - 250 + it * 500L }, read.map { it.capturedAtMs })
      }
    } finally { db.close() }
  }

  @Test fun unknownBoardIdSealsUnderAMintedTombstone(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      val ghost = "board-without-row"
      dao.insertFrames(recording(ghost, minutes = 1))
      assertEquals(120, dao.sealTelemetryMinute(ghost, t0))
      assertNotNull(dao.getBoardKey(ghost))
      assertEquals(120, dao.getTelemetryChunkHeaders(t0, t0 + minute, ghost, false).single().sampleCount)
      assertEquals(0, dao.getBufferFramesPage(t0, t0 + minute, ghost, false, Long.MIN_VALUE, Long.MIN_VALUE, 10).size)
    } finally { db.close() }
  }

  @Test fun sealingNeverRewritesBuckets(): Unit = runBlocking {
    val db = memory()
    try {
      val dao = db.vescapeDao()
      dao.seed()
      dao.upsertBuckets(listOf(TelemetryMinuteBucketEntity(bucketStartMs = t0, boardId = board, sampleCount = 1200,
        firstSampleAtMs = t0, lastSampleAtMs = t0 + 59_950, sumAbsSpeedCentiKmh = 123_456, movingSpeedSampleCount = null,
        sumMovingAbsSpeedCentiKmh = null, maxAbsSpeedCentiKmh = 9_999,
        minBatteryVoltageMv = 70_000, maxMotorCurrentAbsMa = 40_000, maxBatteryCurrentAbsMa = 30_000,
        batteryUsedWhMilli = 777, batteryRegenWhMilli = 55, maxDutyAbsPermille = 900, firstOdometerCm = 1, lastOdometerCm = 2,
        gpsPointCount = 0, preciseGpsPointCount = 0, gpsDistanceCm = 0, maxGpsSpeedCentiMps = null)))
      val before = dao.getAllHistoryBucketsAsc()
      dao.seal(0..3)
      assertEquals(before, dao.getAllHistoryBucketsAsc())
    } finally { db.close() }
  }

  @Test fun rideSummariesRebuildTheSameFromChunks(): Unit = runBlocking {
    val reference = memory()
    val sealed = memory()
    try {
      for (db in listOf(reference, sealed)) db.vescapeDao().seed()
      sealed.vescapeDao().seal(0..3)
      rebuildRideSummaries(reference.vescapeDao())
      rebuildRideSummaries(sealed.vescapeDao())
      suspend fun buckets(db: VescapeRoomDatabase) = db.vescapeDao().getAllHistoryBucketsAsc().sortedBy { "${it.bucketStartMs}:${it.boardId}" }
      assertEquals(buckets(reference), buckets(sealed))
    } finally { reference.close(); sealed.close() }
  }
}
