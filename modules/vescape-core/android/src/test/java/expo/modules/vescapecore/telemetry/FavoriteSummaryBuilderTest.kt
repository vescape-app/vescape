package expo.modules.vescapecore.telemetry

import androidx.sqlite.db.SupportSQLiteDatabase
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Favorites are durable pins over Ride History (ADR 0029). The summary is computed once from the raw
 * Telemetry Samples inside the range — including ranges that cut a minute bucket in half, which is
 * exactly what bucket-derived stats cannot express.
 *
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStoreTests.swift
 */
class FavoriteSummaryBuilderTest {
  @Test
  fun summaryAggregatesRawSamplesAcrossBucketBoundaries() {
    val summary = buildFavoriteSummary(bucketsFor(ridePoints(startMs = 0, count = 120)))

    assertEquals(120, summary.sampleCount)
    assertEquals(2_000, summary.avgSpeedCentiKmh)
    assertEquals(2_000, summary.maxSpeedCentiKmh)
    assertEquals(119_000L, summary.movingDurationMs)
    // 1 m per sample interval. Distance sums per-bucket odometer deltas, so the hop across a bucket
    // boundary is not counted — the same arithmetic history session rows already use.
    assertEquals(11_800L, summary.distanceCm)
  }

  /**
   * The point of computing from raw samples: a Favorite trimmed inside a minute bucket must report
   * the trimmed span, not the whole bucket the samples happen to live in.
   */
  @Test
  fun summaryOfAMidBucketRangeCoversOnlyTheTrimmedSamples() {
    val trimmed = ridePoints(startMs = 0, count = 120)
      .filter { it.capturedAtMs in 30_000L..89_000L }

    val summary = buildFavoriteSummary(bucketsFor(trimmed))

    assertEquals(60, summary.sampleCount)
    assertEquals(59_000L, summary.movingDurationMs)
    assertEquals(5_800L, summary.distanceCm)
  }

  /**
   * Idle samples below the moving threshold are excluded from average speed by the Metric
   * Sanitizers, exactly as they are while recording — a trimmed Favorite must not average them in.
   */
  @Test
  fun summaryExcludesIdleSamplesFromAverageSpeed() {
    val idle = ridePoints(startMs = 0, count = 10, speedCentiKmh = 0)
    val moving = ridePoints(startMs = 10_000, count = 10)

    val summary = buildFavoriteSummary(bucketsFor(idle + moving))

    assertEquals(20, summary.sampleCount)
    assertEquals(2_000, summary.avgSpeedCentiKmh)
    assertEquals(9_000L, summary.movingDurationMs)
  }

  /**
   * A range with no samples at all (deleted telemetry, wrong device) yields an empty summary instead
   * of failing the create path.
   */
  @Test
  fun summaryOfAnEmptyRangeIsZeroed() {
    val summary = buildFavoriteSummary(emptyList())

    assertEquals(0, summary.sampleCount)
    assertEquals(0L, summary.movingDurationMs)
    assertNull(summary.distanceCm)
  }

  /** A ride recorded without odometer readings still reports distance, from the GPS-distance sum. */
  @Test
  fun summaryFallsBackToGpsDistanceWithoutOdometer() {
    val summary = buildFavoriteSummary(
      listOf(bucket(bucketStartMs = 0, gpsDistanceCm = 4_200L, firstOdometerCm = null, lastOdometerCm = null)),
    )

    assertEquals(4_200L, summary.distanceCm)
  }

  @Test
  fun favoriteEntityMapsToRiderUnitsAcrossTheBridge() {
    val map = favorite(distanceCm = 250_000L).toMap(boardName = "Onewheel")

    assertEquals("board-uuid-1", map["boardId"])
    // Board name is resolved on read, never snapshotted, so renames propagate to old favorites.
    assertEquals("Onewheel", map["boardName"])
    assertEquals(2_500.0, map["distanceM"])
    assertEquals(15.0, map["avgSpeedKmh"])
    assertEquals(30.0, map["maxSpeedKmh"])
    assertEquals(12.5, map["batteryUsedWh"])
  }

  /**
   * A range with no odometer and no GPS has no distance to report — the bridge must send null rather
   * than a fabricated zero, so the row renders "-" like a history row without distance.
   */
  @Test
  fun missingDistanceStaysNullAcrossTheBridge() {
    assertNull(favorite(distanceCm = null).toMap(boardName = null)["distanceM"])
  }

  @Test
  fun migrationAddsFavoritesTableAndRangeIndex() {
    val sql = mutableListOf<String>()
    val db = Proxy.newProxyInstance(
      SupportSQLiteDatabase::class.java.classLoader,
      arrayOf(SupportSQLiteDatabase::class.java),
    ) { _, method, args ->
      if (method.name == "execSQL") {
        sql += args?.firstOrNull() as String
        null
      } else {
        throw UnsupportedOperationException(method.name)
      }
    } as SupportSQLiteDatabase

    TelemetryDatabase.MIGRATION_29_30.migrate(db)

    assertTrue(sql.any { it.contains("CREATE TABLE IF NOT EXISTS favorites") })
    assertTrue(sql.any { it.contains("id TEXT NOT NULL PRIMARY KEY") })
    assertTrue(sql.any { it.contains("board_id TEXT") })
    assertTrue(sql.any { it.contains("start_ms INTEGER NOT NULL") })
    assertTrue(sql.any { it.contains("end_ms INTEGER NOT NULL") })
    assertTrue(sql.any { it.contains("created_at INTEGER NOT NULL") })
    assertTrue(sql.any { it.contains("updated_at INTEGER NOT NULL") })
    assertTrue(
      sql.any {
        it == "CREATE INDEX IF NOT EXISTS index_favorites_start_ms_end_ms ON favorites(start_ms, end_ms)"
      },
    )
    assertTrue(
      sql.any { it == "CREATE INDEX IF NOT EXISTS index_favorites_board_id ON favorites(board_id)" },
    )
  }

  @Test
  fun favoriteMediaMigrationAddsImmutableManifestMetadata() {
    val sql = mutableListOf<String>()
    val db = Proxy.newProxyInstance(
      SupportSQLiteDatabase::class.java.classLoader,
      arrayOf(SupportSQLiteDatabase::class.java),
    ) { _, method, args ->
      if (method.name == "execSQL") {
        sql += args?.firstOrNull() as String
        null
      } else {
        throw UnsupportedOperationException(method.name)
      }
    } as SupportSQLiteDatabase

    TelemetryDatabase.MIGRATION_30_31.migrate(db)

    assertTrue(sql.any { it.contains("CREATE TABLE IF NOT EXISTS favorite_media") })
    for (column in listOf(
      "id TEXT NOT NULL PRIMARY KEY",
      "favorite_id TEXT NOT NULL",
      "captured_at INTEGER",
      "mime_type TEXT NOT NULL",
      "media_kind TEXT NOT NULL",
      "byte_count INTEGER NOT NULL",
      "content_hash TEXT NOT NULL",
      "created_at INTEGER NOT NULL",
    )) {
      assertTrue("$column missing", sql.any { it.contains(column) })
    }
    assertTrue(sql.any { it.contains("ON favorite_media(favorite_id, created_at)") })
  }

  @Test
  fun favoriteMediaEntityMapsManifestAndCanonicalUriAcrossBridge() {
    val map = FavoriteMediaEntity(
      id = "media-1",
      favoriteId = "favorite-1",
      capturedAt = 1_000,
      mimeType = "image/jpeg",
      mediaKind = "photo",
      byteCount = 12,
      contentHash = "abc",
      createdAt = 2_000,
    ).toMap("file:///favoriteMedia/favorite-1/media-1.jpg", "media-1.jpg")

    assertEquals("favorite-1", map["favoriteId"])
    assertEquals(12L, map["byteCount"])
    assertEquals("abc", map["contentHash"])
    assertEquals("file:///favoriteMedia/favorite-1/media-1.jpg", map["uri"])
  }

  private fun bucketsFor(points: List<BucketTelemetryPoint>): Collection<TelemetryMinuteBucketEntity> {
    val sanitization = sanitizeTelemetrySamples(points, MetricSanitizerConfig())
    val sanitized = points.mapIndexed { index, point ->
      point.copy(
        excludedFromAvgSpeed = sanitization.samples[index].excludedFromAvgSpeed,
        excludedFromMaxSpeed = sanitization.samples[index].excludedFromMaxSpeed,
        excludedFromMaxDuty = sanitization.samples[index].excludedFromMaxDuty,
      )
    }
    return buildTelemetryBuckets(telemetryPoints = sanitized, locationPoints = emptyList())
  }

  /**
   * A steady ride: constant speed, odometer advancing 1 m per second, no GPS (so the free-spin
   * sanitizer has nothing to compare against and leaves max speed alone).
   */
  private fun ridePoints(
    startMs: Long,
    count: Int,
    speedCentiKmh: Int = 2_000,
    intervalMs: Long = 1_000,
  ): List<BucketTelemetryPoint> = (0 until count).map { index ->
    val capturedAtMs = startMs + index * intervalMs
    BucketTelemetryPoint(
      capturedAtMs = capturedAtMs,
      boardId = "board-1",
      speedCentiKmh = speedCentiKmh,
      batteryVoltageMv = 50_000,
      motorCurrentMa = 10_000,
      batteryCurrentMa = 5_000,
      dutyPermille = 400,
      hasFault = false,
      odometerCm = capturedAtMs / 10,
    )
  }

  private fun bucket(
    bucketStartMs: Long,
    gpsDistanceCm: Long = 0L,
    firstOdometerCm: Long? = 0L,
    lastOdometerCm: Long? = 1_000L,
  ) = TelemetryMinuteBucketEntity(
    bucketStartMs = bucketStartMs,
    boardId = "board-1",
    sampleCount = 10,
    firstSampleAtMs = bucketStartMs,
    lastSampleAtMs = bucketStartMs + 9_000,
    sumAbsSpeedCentiKmh = 20_000L,
    movingSpeedSampleCount = 10,
    sumMovingAbsSpeedCentiKmh = 20_000L,
    maxAbsSpeedCentiKmh = 2_000,
    minBatteryVoltageMv = 50_000,
    maxMotorCurrentAbsMa = 10_000,
    maxBatteryCurrentAbsMa = 5_000,
    batteryUsedWhMilli = 1_000L,
    batteryRegenWhMilli = 0L,
    maxDutyAbsPermille = 400,
    faultCount = 0,
    firstOdometerCm = firstOdometerCm,
    lastOdometerCm = lastOdometerCm,
    gpsPointCount = 0,
    preciseGpsPointCount = 0,
    gpsDistanceCm = gpsDistanceCm,
    maxGpsSpeedCentiMps = null,
    maxTempMosfetDeciC = null,
    maxTempMotorDeciC = null,
    firstLatitudeE7 = null,
    firstLongitudeE7 = null,
    firstMovingAtMs = bucketStartMs,
    lastMovingAtMs = bucketStartMs + 9_000,
    updatedAt = bucketStartMs + 9_000,
  )

  private fun favorite(distanceCm: Long?) = FavoriteEntity(
    id = "fav-1",
    boardId = "board-uuid-1",
    name = "Dolina single track",
    startMs = 1_000,
    endMs = 61_000,
    createdAt = 1_700_000_000_000,
    updatedAt = 1_700_000_000_000,
    sampleCount = 3,
    gpsPointCount = 1,
    distanceCm = distanceCm,
    movingDurationMs = 60_000,
    avgSpeedCentiKmh = 1_500,
    maxSpeedCentiKmh = 3_000,
    batteryUsedWhMilli = 12_500,
  )
}
