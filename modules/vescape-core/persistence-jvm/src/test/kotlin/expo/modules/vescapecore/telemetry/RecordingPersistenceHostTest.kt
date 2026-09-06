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
import org.junit.Assert.assertTrue

/** Production Room DAO contract on host SQLite. No Android framework, emulator, or test DAO. */
class RecordingPersistenceHostTest {
  @Test
  fun tuneHistoryAndBoardAlertsSurviveReopenAndRollbackAtomically(): Unit = runBlocking {
    val fixture = JSONObject(checkNotNull(javaClass.classLoader?.getResource("tune-alert-persistence-contract.json")).readText())
    assertEquals("tune-history-alert-close-reopen-rollback", fixture.getString("scenario"))
    val boardId = fixture.getString("boardId")
    val profileValues = fixture.getJSONObject("profile")
    val alertValues = fixture.getJSONObject("alert")
    val expected = fixture.getJSONObject("expected")
    val path = Files.createTempFile("vescape-tune-alert-contract", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    val profile = TuneProfileEntity(profileValues.getString("id"), boardId, profileValues.getString("refloatBaseVersion"), profileValues.getString("name"), fieldsJson = profileValues.getString("initialFieldsJson"), createdAt = 1, updatedAt = 1)
    var db = open()
    var dao = db.telemetryDao()
    var persistence = TuneAlertPersistence(dao)
    persistence.createProfile(profile)
    persistence.saveProfile(profile.id, profileValues.getString("updatedFieldsJson"), 2)
    persistence.saveAlert(AlertRuleEntity(boardId, alertValues.getString("id"), alertValues.getString("controlId"), alertValues.getDouble("threshold"), null, enabled = true, soundType = alertValues.getString("soundType"), createdAt = 1, source = alertValues.getString("source")))
    persistence.setAlertEnabled(boardId, alertValues.getString("id"), false)
    db.close()

    db = open(); dao = db.telemetryDao(); persistence = TuneAlertPersistence(dao)
    assertEquals(profileValues.getString("updatedFieldsJson"), dao.getTuneProfile(profile.id)?.fieldsJson)
    assertEquals(expected.getInt("historyCount"), dao.getTuneHistoryEntries(profile.id).size)
    assertEquals(alertValues.getString("id"), persistence.alertRules(boardId).single().id)
    assertEquals(expected.getBoolean("alertEnabled"), persistence.alertRules(boardId).single().enabled)
    assertEquals(null, persistence.profile("absent"))
    db.close()

    var connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("CREATE TRIGGER fail_tune_update BEFORE UPDATE ON tune_profiles BEGIN SELECT RAISE(FAIL, 'late tune failure'); END")
    connection.close()
    db = open(); dao = db.telemetryDao(); persistence = TuneAlertPersistence(dao)
    var failed = false
    try { persistence.saveProfile(profile.id, profileValues.getString("failedFieldsJson"), 3) } catch (_: Exception) { failed = true }
    assertTrue(failed)
    assertEquals(profileValues.getString("updatedFieldsJson"), dao.getTuneProfile(profile.id)?.fieldsJson)
    assertEquals(expected.getInt("historyCount"), dao.getTuneHistoryEntries(profile.id).size)
    db.close()
    connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TRIGGER fail_tune_update")
    connection.execSQL("UPDATE tune_profiles SET fields_json = 'not-json' WHERE id = '${profile.id}'")
    connection.close()
    db = open(); persistence = TuneAlertPersistence(db.telemetryDao())
    var malformedFailed = false
    try { persistence.profile(profile.id) } catch (_: Exception) { malformedFailed = true }
    assertTrue(malformedFailed)
    db.close()
    connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TABLE alerts")
    connection.close()
    db = open(); persistence = TuneAlertPersistence(db.telemetryDao())
    var queryFailed = false
    try { persistence.alertRules(boardId) } catch (_: Exception) { queryFailed = true }
    assertTrue(queryFailed)
    db.close()
    Files.deleteIfExists(path)
  }

  @Test
  fun favoriteCreateRenameTrimDeleteAndReopen(): Unit = runBlocking {
    val contract = JSONObject(checkNotNull(javaClass.classLoader?.getResource("favorite-persistence-contract.json")).readText())
    assertEquals("favorite-create-rename-trim-delete-reopen", contract.getString("scenario"))
    val input = contract.getJSONObject("input")
    val expected = contract.getJSONObject("expected")
    val samples = input.getJSONArray("samples")
    val points = (0 until samples.length()).map { index ->
      val sample = samples.getJSONObject(index)
      BucketTelemetryPoint(sample.getLong("capturedAtMs"), null, sample.getInt("speedCentiKmh"),
        80_000, 0, 0, 100, sample.getLong("odometerCm"), 300, 300)
    }
    val summary = buildFavoriteSummary(buildTelemetryBuckets(points, emptyList()))
    assertEquals(expected.getInt("sampleCount"), summary.sampleCount)
    assertEquals(expected.getLong("distanceCm"), summary.distanceCm)
    assertEquals(expected.getInt("avgSpeedCentiKmh"), summary.avgSpeedCentiKmh)
    val path = Files.createTempFile("vescape-favorite-contract", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open()
    val createdRange = TelemetryTimeRange(input.getLong("startMs"), input.getLong("endMs"))
    val created = persistFavorite(db.telemetryDao(), null, createdRange, input.getString("boardId"), input.getString("name"), input.getLong("startMs"), { input.getString("id") }) { requested, boardId ->
      assertEquals(createdRange, requested); assertEquals(input.getString("boardId"), boardId); summary
    }!!
    val trimmedRange = TelemetryTimeRange(input.getLong("trimmedStartMs"), input.getLong("trimmedEndMs"))
    val trimmed = persistFavorite(db.telemetryDao(), created.id, trimmedRange, null, input.getString("renamed"), created.updatedAt + 1, { error("must preserve id") }) { requested, boardId ->
      assertEquals(trimmedRange, requested); assertEquals(input.getString("boardId"), boardId); summary
    }!!
    assertEquals(input.getString("boardId"), trimmed.boardId)
    val conflicting = persistFavorite(db.telemetryDao(), created.id, trimmedRange, "conflicting-board", input.getString("renamed"), trimmed.updatedAt + 1, { error("must preserve id") }) { _, boardId ->
      assertEquals(input.getString("boardId"), boardId); summary
    }!!
    assertEquals(input.getString("boardId"), conflicting.boardId)
    val ownerless = persistFavorite(db.telemetryDao(), null, createdRange, null, null, created.updatedAt, { "ownerless-favorite" }) { _, boardId ->
      assertEquals(null, boardId); summary
    }!!
    val ownerlessUpdated = persistFavorite(db.telemetryDao(), ownerless.id, trimmedRange, "conflicting-board", null, ownerless.updatedAt + 1, { error("must preserve id") }) { _, boardId ->
      assertEquals(null, boardId); summary
    }!!
    assertEquals(null, ownerlessUpdated.boardId)
    assertEquals(1, db.telemetryDao().deleteFavorite(ownerless.id))
    db.close()
    db = open()
    val reopened = db.telemetryDao().getFavorite(created.id)!!
    assertEquals(created.id, reopened.id)
    assertEquals(created.createdAt, reopened.createdAt)
    assertEquals(input.getString("renamed"), reopened.name)
    assertEquals(input.getLong("trimmedStartMs"), reopened.startMs)
    assertEquals(expected.getInt("sampleCount"), reopened.sampleCount)
    val protectedRange = expandTelemetryRangeToBuckets(TelemetryTimeRange(reopened.startMs, reopened.endMs))
    val deletable = subtractProtectedTelemetryRanges(TelemetryTimeRange(0, 120_000), listOf(protectedRange))
    assertTrue(deletable.all { it.endMs < protectedRange.startMs || it.startMs > protectedRange.endMs })
    db.telemetryDao().insertFavoriteMedia(FavoriteMediaEntity(
      "owned-media", created.id, null, "image/jpeg", "photo", 1, "00", created.createdAt,
    ))
    db.close()
    var connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("CREATE TRIGGER fail_favorite_delete BEFORE DELETE ON favorites BEGIN SELECT RAISE(FAIL, 'late Favorite delete failure'); END")
    connection.close()
    db = open()
    var deleteFailed = false
    try { db.telemetryDao().deleteFavorite(created.id) } catch (_: Exception) { deleteFailed = true }
    assertTrue(deleteFailed)
    assertEquals(1, db.telemetryDao().getFavoriteMedia(created.id).size)
    db.close()
    connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TRIGGER fail_favorite_delete")
    connection.close()
    db = open()
    assertEquals(1, db.telemetryDao().deleteFavorite(created.id))
    assertEquals(null, db.telemetryDao().getFavorite(created.id))
    db.close()
    Files.deleteIfExists(path)
  }
  @Test
  fun boardAndSettingsSurviveReopenAndFailuresStayExplicit(): Unit = runBlocking {
    val fixture = JSONObject(
      checkNotNull(javaClass.classLoader?.getResource("board-settings-persistence-contract.json")).readText(),
    )
    assertEquals("board-settings-close-reopen", fixture.getString("scenario"))
    val board = fixture.getJSONObject("board")
    val setting = fixture.getJSONObject("setting")
    val path = Files.createTempFile("vescape-board-settings", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()

    var db = open()
    var persistence = BoardSettingsPersistence(db.telemetryDao())
    val boardId = board.getString("id")
    val createdAt = board.getLong("createdAt")
    persistence.upsertBoard(
      BoardEntity(boardId, board.getString("name"), "AA:BB", createdAt),
      listOf(BoardSettingEntity(boardId, "description", JSONObject.quote(board.getString("description")), createdAt)),
      emptyList(),
    )
    db.telemetryDao().upsertBoardConfigValues(BoardConfigValuesEntity("delete-rollback", "1.0", "{}", createdAt))
    db.telemetryDao().upsertBoardConfigChangeNotice(BoardConfigChangeNoticeEntity("delete-rollback", createdAt, "[]"))
    persistence.upsertSetting(AppSettingEntity(setting.getString("key"), setting.getString("valueJson"), createdAt))
    persistence.upsertBoard(BoardEntity(boardId, board.getString("renamed"), "AA:BB", createdAt), emptyList(), emptyList())
    persistence.upsertSetting(AppSettingEntity(setting.getString("key"), setting.getString("updatedValueJson"), createdAt + 1))
    db.close()

    db = open()
    persistence = BoardSettingsPersistence(db.telemetryDao())
    assertEquals(board.getString("renamed"), persistence.getBoards().single().name)
    assertEquals(JSONObject.quote(board.getString("description")), persistence.getBoardSettings(boardId).single().valueJson)
    assertEquals(setting.getString("updatedValueJson"), persistence.getSettings().single { it.key == setting.getString("key") }.valueJson)
    persistence.deleteSetting(setting.getString("key"))
    assertTrue(persistence.getSettings().none { it.key == setting.getString("key") })
    assertEquals("system", persistence.getSettings(mapOf(setting.getString("key") to "system"))[setting.getString("key")])
    persistence.upsertSetting(AppSettingEntity(setting.getString("key"), setting.getString("malformedValueJson"), createdAt + 2))
    var malformedFailed = false
    try { persistence.getSettings(mapOf(setting.getString("key") to "system")) } catch (_: Exception) { malformedFailed = true }
    assertTrue(malformedFailed)
    persistence.deleteSetting(setting.getString("key"))
    persistence.deleteBoard(boardId, createdAt + 2)
    assertTrue(persistence.getBoards().isEmpty())
    assertEquals(boardId, persistence.getBoard(boardId)?.id)
    assertTrue(persistence.getBoardSettings(boardId).isEmpty())
    db.close()

    var connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("CREATE TRIGGER fail_board_setting BEFORE INSERT ON board_settings BEGIN SELECT RAISE(FAIL, 'deterministic failure'); END")
    connection.close()
    db = open()
    persistence = BoardSettingsPersistence(db.telemetryDao())
    var saveFailed = false
    try {
      persistence.upsertBoard(
        BoardEntity("rollback", "Must Roll Back", null, createdAt),
        listOf(BoardSettingEntity("rollback", "description", "\"fail\"", createdAt)),
        emptyList(),
      )
    } catch (_: Exception) { saveFailed = true }
    assertTrue(saveFailed)
    assertEquals(null, persistence.getBoard("rollback"))
    db.close()
    connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TRIGGER fail_board_setting")
    connection.execSQL("CREATE TRIGGER fail_board_tombstone BEFORE INSERT ON boards WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'late delete failure'); END")
    connection.close()
    db = open()
    persistence = BoardSettingsPersistence(db.telemetryDao())
    persistence.upsertBoard(
      BoardEntity("delete-rollback", "Keep", null, createdAt),
      listOf(BoardSettingEntity("delete-rollback", "description", "\"keep\"", createdAt)),
      emptyList(),
    )
    var deleteFailed = false
    try { persistence.deleteBoard("delete-rollback", createdAt + 3) } catch (_: Exception) { deleteFailed = true }
    assertTrue(deleteFailed)
    assertEquals("Keep", persistence.getBoards().single().name)
    assertEquals(1, persistence.getBoardSettings("delete-rollback").size)
    assertEquals("{}", db.telemetryDao().getBoardConfigValues("delete-rollback", "1.0")?.valuesJson)
    assertEquals("[]", db.telemetryDao().getBoardConfigChangeNotice("delete-rollback")?.diffsJson)
    db.close()
    connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TRIGGER fail_board_tombstone")
    connection.execSQL("DROP TABLE app_settings")
    connection.close()
    db = open()
    persistence = BoardSettingsPersistence(db.telemetryDao())
    var readFailed = false
    try { persistence.getSettings() } catch (_: Exception) { readFailed = true }
    assertTrue(readFailed)
    db.close()
    Files.deleteIfExists(path)
  }

  @Test
  fun historyReadsDistinguishEmptyCurrentPagedAndFailure(): Unit = runBlocking {
    val contract = JSONObject(
      checkNotNull(javaClass.classLoader?.getResource("history-read-contract.json")).readText(),
    )
    assertEquals("precomputed-history-reads", contract.getString("scenario"))
    val expected = contract.getJSONObject("expected")
    val gapMs = contract.getLong("gapMs")
    val path = Files.createTempFile("vescape-history-read", ".db")
    Files.deleteIfExists(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()

    var db = open()
    val emptyPage = readRideHistoryPage(db.telemetryDao(), mapOf("limit" to contract.getInt("pageSize")), gapMs)
    assertEquals(expected.getInt("emptySessionCount"), (emptyPage["sessions"] as List<*>).size)
    val emptyStats = readProfileStatsSnapshot(db.telemetryDao(), emptyMap(), gapMs)
    assertEquals(expected.getInt("emptyRideCount"), (emptyStats["total"] as Map<*, *>)["rideCount"])

    val recording = JSONObject(
      checkNotNull(javaClass.classLoader?.getResource("recording-persistence-contract.json")).readText(),
    )
    val boardId = recording.getString("boardId")
    val samples = recording.getJSONArray("samples")
    val points = (0 until samples.length()).map { index ->
      val sample = samples.getJSONObject(index)
      BucketTelemetryPoint(sample.getLong("capturedAtMs"), boardId, sample.getInt("speedCentiKmh"),
        sample.getInt("batteryVoltageMv"), 5000, 2000, 200, sample.getLong("odometerCm"), 300, 350)
    }
    val current = buildTelemetryBuckets(points, emptyList()).single()
    val nextPoints = points.map { point ->
      point.copy(capturedAtMs = point.capturedAtMs + 60_000L, odometerCm = point.odometerCm?.plus(100L))
    }
    val currentNext = buildTelemetryBuckets(nextPoints, emptyList()).single()
    val offset = contract.getLong("olderRideOffsetMs")
    val older = current.copy(
      bucketStartMs = current.bucketStartMs - offset,
      firstSampleAtMs = current.firstSampleAtMs - offset,
      lastSampleAtMs = current.lastSampleAtMs - offset,
      firstMovingAtMs = current.firstMovingAtMs?.minus(offset),
      lastMovingAtMs = current.lastMovingAtMs?.minus(offset),
    )
    RecordingPersistence(db.telemetryDao()).commit(emptyList(), listOf(current, currentNext, older), emptyList())
    assertEquals(3, db.telemetryDao().getAllHistoryBucketsAsc().size)
    assertEquals(2, (readRideHistoryPage(db.telemetryDao(), mapOf("limit" to 50), gapMs)["sessions"] as List<*>).size)
    val first = readRideHistoryPage(db.telemetryDao(), mapOf("limit" to contract.getInt("pageSize")), gapMs)
    assertEquals(expected.getInt("firstPageSessionCount"), (first["sessions"] as List<*>).size)
    assertEquals(expected.getBoolean("firstPageHasMore"), first["hasMore"])
    val firstSession = (first["sessions"] as List<Map<String, Any?>>).single()
    assertEquals(expected.getLong("currentStartAtMs"), firstSession["startAtMs"])
    assertEquals(expected.getLong("currentEndAtMs"), firstSession["endAtMs"])
    assertEquals(expected.getInt("currentSampleCount"), firstSession["sampleCount"])
    assertEquals(expected.getDouble("currentDistanceM"), firstSession["distanceM"])
    val second = readRideHistoryPage(
      db.telemetryDao(),
      mapOf("limit" to contract.getInt("pageSize"), "cursorBeforeMs" to first["nextCursorBeforeMs"]),
      gapMs,
    )
    assertEquals(expected.getInt("secondPageSessionCount"), (second["sessions"] as List<*>).size)
    assertEquals(expected.getBoolean("secondPageHasMore"), second["hasMore"])
    assertEquals(older.firstSampleAtMs, (second["sessions"] as List<Map<String, Any?>>).single()["startAtMs"])
    val stats = readProfileStatsSnapshot(db.telemetryDao(), emptyMap(), gapMs)
    val total = stats["total"] as Map<*, *>
    assertEquals(expected.getInt("profileRideCount"), total["rideCount"])
    assertEquals(expected.getLong("profileRideTimeMs"), total["rideTimeMs"])
    assertEquals(expected.getDouble("profileDistanceM"), total["distanceM"])
    assertEquals(expected.getDouble("profileTopSpeedKmh"), total["topSpeedKmh"])
    assertEquals(expected.getDouble("profileAvgSpeedKmh"), total["avgSpeedKmh"])
    assertEquals(expected.getInt("profileMonthCount"), (stats["months"] as List<*>).size)
    assertEquals(expected.getInt("selectedYear"), (stats["selectedMonth"] as Map<*, *>)["year"])
    assertEquals(expected.getInt("selectedMonth"), (stats["selectedMonth"] as Map<*, *>)["month"])

    db.close()
    val connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("DROP TABLE telemetry_minute_buckets")
    connection.close()
    db = open()
    var pageFailed = false
    try { readRideHistoryPage(db.telemetryDao(), emptyMap(), gapMs) } catch (_: Exception) { pageFailed = true }
    assertTrue(pageFailed)
    var profileFailed = false
    try { readProfileStatsSnapshot(db.telemetryDao(), emptyMap(), gapMs) } catch (_: Exception) { profileFailed = true }
    assertTrue(profileFailed)
    db.close()
    Files.deleteIfExists(path)
  }

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
