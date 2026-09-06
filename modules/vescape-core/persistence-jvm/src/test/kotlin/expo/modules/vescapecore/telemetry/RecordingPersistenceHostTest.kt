package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Production Room DAO contract on host SQLite. No Android framework, emulator, or test DAO. */
class RecordingPersistenceHostTest {
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
