package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.CoroutineStart
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.Assert.assertFalse

/** Production Room DAO contract on host SQLite. No Android framework, emulator, or test DAO. */
class RecordingPersistenceHostTest {
  @Test
  fun failedTransactionRollsBackAndStopsIngestion(): Unit = runBlocking {
    val path = Files.createTempFile("vescape-recording-failure", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open()
    var persistence = RecordingPersistence(db.telemetryDao())
    fun marker(at: Long, type: String) = TelemetryMarkerEntity(
      occurredAtMs = at, elapsedRealtimeMs = at, type = type, boardId = null, message = null, gapMs = null,
    )
    persistence.commit(emptyList(), emptyList(), listOf(marker(1, "committed")))
    db.close()
    var connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("""
      CREATE TRIGGER fail_recording_marker BEFORE INSERT ON telemetry_markers
      WHEN NEW.type = 'fail' BEGIN SELECT RAISE(FAIL, 'deterministic recording failure'); END
    """.trimIndent())
    connection.close()
    db = open()
    persistence = RecordingPersistence(db.telemetryDao())
    var reports = 0
    val boundary = RecordingCommitBoundary(persistence, onFailure = { reports++ })
    val failingFlush = async(start = CoroutineStart.UNDISPATCHED) {
      boundary.commit(emptyList(), emptyList(), listOf(marker(2, "pending"), marker(3, "fail")))
    }
    val competingFlush = async {
      boundary.commit(emptyList(), emptyList(), listOf(marker(4, "after_failure")))
    }
    assertFalse(failingFlush.await())
    assertFalse(competingFlush.await())
    assertFalse(boundary.isAccepting())
    assertFalse(boundary.commit(emptyList(), emptyList(), listOf(marker(5, "later"))))
    assertEquals(1, reports)
    db.close()
    connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TRIGGER fail_recording_marker")
    connection.close()
    db = open()
    assertEquals(listOf("committed"), db.telemetryDao().getMarkers(0, Long.MAX_VALUE, null).map { it.type })
    db.close()
    Files.deleteIfExists(path)
  }

  @Test
  fun movingRecordingSurvivesCloseAndReopen(): Unit = runBlocking {
    val fixture = JSONObject(
      checkNotNull(javaClass.classLoader?.getResource("recording-persistence-contract.json")).readText(),
    )
    assertEquals("moving-recording-close-reopen", fixture.getString("scenario"))
    val path = Files.createTempFile("vescape-recording-contract", ".db")
    Files.deleteIfExists(path)

    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString())
      .setDriver(BundledSQLiteDriver())
      .build()

    var db = open()
    val samples = fixture.getJSONArray("samples")
    val boardId = fixture.getString("boardId")
    val frames = (0 until samples.length()).map { index ->
      val sample = samples.getJSONObject(index)
      TelemetryFrameEntity(
        capturedAtMs = sample.getLong("capturedAtMs"), elapsedRealtimeMs = sample.getLong("elapsedRealtimeMs"),
        boardId = boardId, canId = null, flags = TELEMETRY_FLAG_KEYFRAME,
        changedMask1 = Int.MAX_VALUE, changedMask2 = 1,
        speedCentiKmh = sample.getInt("speedCentiKmh"), batteryVoltageMv = sample.getInt("batteryVoltageMv"),
        motorCurrentMa = 5000, batteryCurrentMa = 2000, dutyPermille = 200,
        pitchCentiDeg = 0, rollCentiDeg = 0, balancePitchCentiDeg = 0, balanceCurrentMa = 0,
        erpm = 1000, state = 1, switchState = 2, adc1Milli = 1000, adc2Milli = 1000,
        odometerCm = sample.getLong("odometerCm"), tempMosfetDeciC = 300, tempMotorDeciC = 350,
        latitudeE7 = null, longitudeE7 = null, gpsSpeedCentiMps = null, bearingCentiDeg = null,
        accuracyCm = null, altitudeCm = null, locationTimestampMs = null,
      )
    }
    val expected = fixture.getJSONObject("expected")
    val points = (0 until samples.length()).map { index ->
      val sample = samples.getJSONObject(index)
      BucketTelemetryPoint(sample.getLong("capturedAtMs"), boardId, sample.getInt("speedCentiKmh"),
        sample.getInt("batteryVoltageMv"), 5000, 2000, 200, sample.getLong("odometerCm"), 300, 350)
    }
    val buckets = buildTelemetryBuckets(points, emptyList())
    RecordingPersistence(db.telemetryDao()).commit(frames, buckets, emptyList())
    db.close()

    db = open()
    val dao = db.telemetryDao()
    assertEquals(expected.getLong("frameCount"), dao.countFrames())
    val reopened = RecordingPersistence(dao).readCommittedRide()
    assertEquals(expected.getInt("bucketCount"), reopened.size)
    assertEquals(expected.getInt("sampleCount"), reopened.single().sampleCount)
    assertEquals(expected.getLong("rideStartAtMs"), reopened.single().firstSampleAtMs)
    assertEquals(expected.getLong("rideEndAtMs"), reopened.single().lastSampleAtMs)
    assertEquals(expected.getInt("movingSampleCount"), reopened.single().movingSpeedSampleCount)
    assertEquals(expected.getLong("sumMovingSpeedCentiKmh"), reopened.single().sumMovingAbsSpeedCentiKmh)
    assertEquals(expected.getInt("maxSpeedCentiKmh"), reopened.single().maxAbsSpeedCentiKmh)
    assertEquals(expected.getInt("minBatteryVoltageMv"), reopened.single().minBatteryVoltageMv)
    assertEquals(expected.getLong("firstOdometerCm"), reopened.single().firstOdometerCm)
    assertEquals(expected.getLong("lastOdometerCm"), reopened.single().lastOdometerCm)
    db.close()
    Files.deleteIfExists(path)
  }
}
