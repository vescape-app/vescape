package expo.modules.vescapecore.telemetry

import android.content.Context
import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real SQLite regressions for complete-minute paging and complete aggregation reads.
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryGroupingTests.swift
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStoreTests.swift
 */
@RunWith(AndroidJUnit4::class)
class RideReadQueriesTest {
  private lateinit var database: TelemetryDatabase
  private lateinit var dao: TelemetryDao
  private val displayLimit = 20_000
  private val base = 1_714_521_600_000L

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    database = Room.inMemoryDatabaseBuilder(context, TelemetryDatabase::class.java)
      .allowMainThreadQueries().build()
    dao = database.telemetryDao()
  }

  @After
  fun tearDown() { database.close() }

  @Test
  fun bucketPagingIncludesTheWholeBoundaryMinute() = runBlocking {
    val buckets = (2..100).map { minute ->
      bucket(base + minute * 60_000L, base + minute * 60_000L + 10_000, "newer")
    } + listOf(
      bucket(base + 60_000, base + 70_000, "boundary-a"),
      bucket(base + 80_000, base + 90_000, "boundary-b"),
      bucket(base, base + 10_000, "boundary-a"),
    )
    dao.upsertBuckets(buckets)
    database.withTransaction {
      val first = dao.getRideBuckets(Long.MAX_VALUE, 100)
      assertEquals(101, first.size)
      val cursor = first.last().bucketStartMs
      assertEquals(base + 60_000, cursor)
      assertTrue(dao.hasRideBucketsBefore(cursor))
      val second = dao.getRideBuckets(cursor, 100)
      assertEquals(1, second.size)
      assertFalse(dao.hasRideBucketsBefore(second.last().bucketStartMs))
      val sessions = groupRideSessions(first + second, emptyList(), 30 * 60_000L)
      assertEquals(3, sessions.size)
      assertEquals(99, sessions.single { it.recordingId == "newer" }.sampleCount)
      assertEquals(2, sessions.single { it.recordingId == "boundary-a" }.sampleCount)
      assertEquals(1, sessions.single { it.recordingId == "boundary-b" }.sampleCount)
      assertTrue(dao.getRideBuckets(base, 100).isEmpty())
    }
  }

  @Test
  fun favoriteSummaryReadsMovementBeyondTheDisplayCap() = runBlocking {
    dao.insertRideTrackPoints((0 until displayLimit + 2).map { index ->
      RideTrackPointEntity(
        recordingId = "recording-1", boardId = "board-1", fixAtMs = index * 60_000L,
        latitudeE7 = 500_000_000, longitudeE7 = 190_000_000, accuracyCm = 300,
        gpsSpeedCentiMps = if (index >= displayLimit) 1_000 else 0,
        bearingCentiDeg = null, altitudeCm = null,
      )
    })
    assertEquals(displayLimit, dao.getRideTrackPoints(0, Long.MAX_VALUE, "board-1", displayLimit).size)
    val complete = dao.getRideTrackForAggregation(0, Long.MAX_VALUE, "board-1")
    assertEquals(displayLimit + 2, complete.size)
    val summary = buildFavoriteSummary(buildTelemetryBuckets(emptyList(), locationPoints = complete.toBucketLocationPoints()))
    assertEquals(60_000L, summary.movingDurationMs)
    assertEquals(displayLimit + 2, summary.gpsPointCount)
  }

  private fun bucket(start: Long, end: Long, recordingId: String = LEGACY_RIDE_RECORDING_ID) = TelemetryMinuteBucketEntity(
    bucketStartMs = start - (start % TELEMETRY_BUCKET_SIZE_MS),
    boardId = "board-1",
    recordingId = recordingId,
    sampleCount = 1,
    firstSampleAtMs = start,
    lastSampleAtMs = end,
    sumAbsSpeedCentiKmh = 1_000L,
    movingSpeedSampleCount = 1,
    sumMovingAbsSpeedCentiKmh = 1_000L,
    maxAbsSpeedCentiKmh = 1_000,
    minBatteryVoltageMv = 50_000,
    maxMotorCurrentAbsMa = 0,
    maxBatteryCurrentAbsMa = 0,
    batteryUsedWhMilli = 0L,
    batteryRegenWhMilli = 0L,
    maxDutyAbsPermille = 0,
    firstOdometerCm = 0L,
    lastOdometerCm = 1_000L,
    gpsPointCount = 0,
    preciseGpsPointCount = 0,
    gpsDistanceCm = 0L,
    maxGpsSpeedCentiMps = 0,
    firstMovingAtMs = start,
    lastMovingAtMs = end,
    firstLatitudeE7 = null,
    firstLongitudeE7 = null,
  )
}
