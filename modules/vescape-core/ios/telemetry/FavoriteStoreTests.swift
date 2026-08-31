import GRDB
import XCTest
@testable import VescapeCore

/// Favorites are durable pins over Ride History (ADR 0029): identity and timestamps are native, and
/// the summary is computed once from the raw Telemetry Samples inside the range — including ranges
/// that cut a minute bucket in half, which is exactly what bucket-derived stats cannot express.
final class FavoriteStoreTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var store: FavoriteStore!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try queue.write { db in
      try FavoriteStore.createTables(db)
      try FavoriteMediaStore.createTables(db)
    }
    store = FavoriteStore(dbWriter: queue)
  }

  override func tearDownWithError() throws {
    store = nil
    queue = nil
  }

  // MARK: - Store

  func testInsertedFavoriteRoundTripsThroughTheStore() throws {
    let favorite = makeFavorite(
      id: "fav-1",
      boardId: "board-uuid-1",
      name: "Dolina single track",
      startMs: 1_000,
      endMs: 61_000,
      summary: FavoriteSummary(
        sampleCount: 12,
        gpsPointCount: 4,
        distanceCm: 123_400,
        movingDurationMs: 55_000,
        avgSpeedCentiKmh: 1_850,
        maxSpeedCentiKmh: 4_210,
        batteryUsedWhMilli: 9_600
      )
    )

    XCTAssertTrue(store.insert(favorite))

    let stored = try XCTUnwrap(store.list().first)
    XCTAssertEqual(stored.id, "fav-1")
    XCTAssertEqual(stored.name, "Dolina single track")
    XCTAssertEqual(stored.startMs, 1_000)
    XCTAssertEqual(stored.endMs, 61_000)
    XCTAssertEqual(stored.boardId, "board-uuid-1")
    XCTAssertEqual(stored.summary.distanceCm, 123_400)
    XCTAssertEqual(stored.summary.movingDurationMs, 55_000)
    XCTAssertEqual(stored.summary.avgSpeedCentiKmh, 1_850)
    XCTAssertEqual(stored.summary.maxSpeedCentiKmh, 4_210)
    XCTAssertEqual(stored.summary.batteryUsedWhMilli, 9_600)
  }

  func testListReturnsNewestRangeFirst() {
    store.insert(makeFavorite(id: "older", startMs: 1_000, endMs: 2_000))
    store.insert(makeFavorite(id: "newer", startMs: 9_000, endMs: 10_000))

    XCTAssertEqual(store.list().map(\.id), ["newer", "older"])
  }

  func testUpdateKeepsIdentityAndCreationTimeWhileReplacingRangeNameAndSummary() throws {
    store.insert(
      makeFavorite(
        id: "fav-1",
        name: "Dolina",
        startMs: 1_000,
        endMs: 61_000,
        summary: FavoriteSummary(sampleCount: 12, movingDurationMs: 55_000)
      )
    )
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO favorite_media (
            id, favorite_id, captured_at, mime_type, media_kind, byte_count, content_hash, created_at
          ) VALUES ('media-1', 'fav-1', 1000, 'image/jpeg', 'photo', 1, '00', 1000)
          """
      )
    }

    let updated = try XCTUnwrap(
      store.update(
        makeFavorite(
          id: "fav-1",
          name: "Dolina single track",
          startMs: 10_000,
          endMs: 50_000,
          updatedAtMs: 1_800_000_000_000,
          summary: FavoriteSummary(sampleCount: 8, movingDurationMs: 35_000)
        )
      )
    )

    XCTAssertEqual(updated.id, "fav-1")
    XCTAssertEqual(updated.name, "Dolina single track")
    XCTAssertEqual(updated.startMs, 10_000)
    XCTAssertEqual(updated.endMs, 50_000)
    XCTAssertEqual(updated.summary.sampleCount, 8)
    XCTAssertEqual(updated.summary.movingDurationMs, 35_000)
    XCTAssertEqual(updated.createdAtMs, 1_700_000_000_000)
    XCTAssertEqual(updated.updatedAtMs, 1_800_000_000_000)
    let mediaCount = try queue.read { db in
      try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM favorite_media WHERE favorite_id = 'fav-1'")
    }
    XCTAssertEqual(mediaCount, 1)
  }

  func testUpdateToNilClearsTheName() throws {
    store.insert(makeFavorite(id: "fav-1", name: "Dolina", startMs: 1_000, endMs: 2_000))

    let cleared = try XCTUnwrap(
      store.update(
        makeFavorite(
          id: "fav-1",
          name: nil,
          startMs: 1_000,
          endMs: 2_000,
          updatedAtMs: 1_800_000_000_000
        )
      )
    )

    XCTAssertNil(cleared.name)
    XCTAssertNil(try XCTUnwrap(store.list().first).name)
  }

  func testUpdateOfAnUnknownFavoriteReportsNoRow() {
    XCTAssertNil(
      store.update(
        makeFavorite(
          id: "missing",
          name: "Nope",
          startMs: 1_000,
          endMs: 2_000,
          updatedAtMs: 1_800_000_000_000
        )
      )
    )
  }

  /// Removing a Favorite unpins it and nothing else: only its own row goes away.
  func testDeleteRemovesOnlyTheTargetRow() {
    store.insert(makeFavorite(id: "fav-1", startMs: 1_000, endMs: 2_000))
    store.insert(makeFavorite(id: "fav-2", startMs: 3_000, endMs: 4_000))

    XCTAssertTrue(store.delete("fav-1"))
    XCTAssertEqual(store.list().map(\.id), ["fav-2"])
    XCTAssertFalse(store.delete("fav-1"))
  }

  func testDeleteRawCascadesFavoriteMediaManifestRows() throws {
    store.insert(makeFavorite(id: "fav-1", startMs: 1_000, endMs: 2_000))
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO favorite_media (
            id, favorite_id, captured_at, mime_type, media_kind, byte_count, content_hash, created_at
          ) VALUES ('media-1', 'fav-1', 1000, 'image/jpeg', 'photo', 1, '00', 1000)
          """
      )
    }

    XCTAssertTrue(store.delete("fav-1"))
    let mediaCount = try queue.read { db in
      try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM favorite_media")
    }
    XCTAssertEqual(mediaCount, 0)
  }

  func testBridgeMapConvertsStoredIntegersToRiderUnits() {
    let routePoints = [["latitude": 52.0, "longitude": 21.0]]
    let map = makeFavorite(
      id: "fav-1",
      startMs: 1_000,
      endMs: 2_000,
      summary: FavoriteSummary(
        sampleCount: 3,
        gpsPointCount: 1,
        distanceCm: 250_000,
        movingDurationMs: 60_000,
        avgSpeedCentiKmh: 1_500,
        maxSpeedCentiKmh: 3_000,
        batteryUsedWhMilli: 12_500
      )
    ).toMap(boardName: "Onewheel", routePoints: routePoints)

    XCTAssertEqual(map["boardName"] as? String, "Onewheel")
    XCTAssertEqual(map["distanceM"] as? Double, 2_500.0)
    XCTAssertEqual(map["avgSpeedKmh"] as? Double, 15.0)
    XCTAssertEqual(map["maxSpeedKmh"] as? Double, 30.0)
    XCTAssertEqual(map["batteryUsedWh"] as? Double, 12.5)
    XCTAssertEqual(map["routePoints"] as? [[String: Double]], routePoints)
  }

  /// A range with no odometer readings has no distance to report — the bridge must send `nil`
  /// rather than a fabricated zero, so the row renders "-" like a history row without distance.
  func testMissingDistanceStaysNullAcrossTheBridge() {
    let map = makeFavorite(id: "fav-1", startMs: 1_000, endMs: 2_000).toMap(boardName: nil)

    XCTAssertNil(map["distanceM"] ?? nil)
  }

  func testFavoriteRangeRequiresValidBridgeBounds() {
    XCTAssertNil(TelemetryRepository.favoriteRange([:]))
    XCTAssertNil(TelemetryRepository.favoriteRange(["startMs": 2_000, "endMs": 1_000]))
    XCTAssertEqual(
      TelemetryRepository.favoriteRange(["startMs": 1_000, "endMs": 2_000]),
      TelemetryTimeRange(startMs: 1_000, endMs: 2_000)
    )
  }

  // MARK: - Summary from raw samples

  func testSummaryAggregatesRawSamplesAcrossBucketBoundaries() {
    let points = ridePoints(startMs: 0, count: 120, speedCentiKmh: 2_000, intervalMs: 1_000)

    let summary = TelemetryRepository.favoriteSummary(points, config: MetricSanitizerConfig())

    XCTAssertEqual(summary.sampleCount, 120)
    XCTAssertEqual(summary.avgSpeedCentiKmh, 2_000)
    XCTAssertEqual(summary.maxSpeedCentiKmh, 2_000)
    XCTAssertEqual(summary.movingDurationMs, 119_000)
    // 1 m per sample interval. Distance sums per-bucket odometer deltas, so the hop across a bucket
    // boundary is not counted — the same arithmetic history session rows already use.
    XCTAssertEqual(summary.distanceCm, 11_800)
  }

  /// The point of computing from raw samples: a Favorite trimmed inside a minute bucket must report
  /// the trimmed span, not the whole bucket the samples happen to live in.
  func testSummaryOfAMidBucketRangeCoversOnlyTheTrimmedSamples() {
    let all = ridePoints(startMs: 0, count: 120, speedCentiKmh: 2_000, intervalMs: 1_000)
    let trimmed = all.filter { $0.capturedAtMs >= 30_000 && $0.capturedAtMs <= 89_000 }

    let summary = TelemetryRepository.favoriteSummary(trimmed, config: MetricSanitizerConfig())

    XCTAssertEqual(summary.sampleCount, 60)
    XCTAssertEqual(summary.movingDurationMs, 59_000)
    XCTAssertEqual(summary.distanceCm, 5_800)
  }

  /// Idle samples below the moving threshold are excluded from average speed by the Metric
  /// Sanitizers, exactly as they are while recording — a trimmed Favorite must not average them in.
  func testSummaryExcludesIdleSamplesFromAverageSpeed() {
    let idle = ridePoints(startMs: 0, count: 10, speedCentiKmh: 0, intervalMs: 1_000)
    let moving = ridePoints(startMs: 10_000, count: 10, speedCentiKmh: 2_000, intervalMs: 1_000)

    let summary = TelemetryRepository.favoriteSummary(idle + moving, config: MetricSanitizerConfig())

    XCTAssertEqual(summary.sampleCount, 20)
    XCTAssertEqual(summary.avgSpeedCentiKmh, 2_000)
    XCTAssertEqual(summary.movingDurationMs, 9_000)
  }

  /// A range with no samples at all (deleted telemetry, wrong device) yields an empty summary
  /// instead of crashing the create path.
  func testSummaryOfAnEmptyRangeIsZeroed() {
    let summary = TelemetryRepository.favoriteSummary([], config: MetricSanitizerConfig())

    XCTAssertEqual(summary.sampleCount, 0)
    XCTAssertEqual(summary.movingDurationMs, 0)
    XCTAssertNil(summary.distanceCm)
  }

  // MARK: - Fixtures

  private func makeFavorite(
    id: String,
    boardId: String? = nil,
    name: String? = nil,
    startMs: Int64,
    endMs: Int64,
    updatedAtMs: Int64 = 1_700_000_000_000,
    summary: FavoriteSummary = FavoriteSummary()
  ) -> Favorite {
    Favorite(
      id: id,
      boardId: boardId,
      name: name,
      startMs: startMs,
      endMs: endMs,
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: updatedAtMs,
      summary: summary
    )
  }

  /// A steady ride: constant speed, odometer advancing 1 m per interval, no GPS (so the free-spin
  /// sanitizer has nothing to compare against and leaves max speed alone).
  private func ridePoints(
    startMs: Int64,
    count: Int,
    speedCentiKmh: Int,
    intervalMs: Int64
  ) -> [BucketTelemetryPoint] {
    (0..<count).map { index in
      let offset = Int64(index) * intervalMs
      return BucketTelemetryPoint(
        capturedAtMs: startMs + offset,
        boardId: "board-1",
        speedCentiKmh: speedCentiKmh,
        batteryVoltageMv: 50_000,
        motorCurrentMa: 10_000,
        batteryCurrentMa: 5_000,
        dutyPermille: 400,
        odometerCm: (startMs + offset) / 10,
        tempMosfetDeciC: nil,
        tempMotorDeciC: nil,
        gpsSpeedCentiMps: nil,
        gpsTimestampMs: nil,
        gpsAccuracyCm: nil,
        latitudeE7: nil,
        longitudeE7: nil,
        bearingCentiDeg: nil,
        altitudeCm: nil,
        preciseGps: false
      )
    }
  }
}
