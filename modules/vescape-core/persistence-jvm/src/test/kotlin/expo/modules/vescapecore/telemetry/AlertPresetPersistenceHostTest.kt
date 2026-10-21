package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AlertPresetPersistenceHostTest {
  private val fixture = JSONObject(java.io.File("../shared/alert-preset-contract.json").readText())

  private fun presetRow(boardId: String, metric: String, spec: String) =
    AlertRuleEntity(boardId, "preset:$metric", metric, 0.0, null, enabled = true, soundType = spec, createdAt = 1)

  @Test fun sharedExpansionContract(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    val cases = fixture.getJSONArray("cases")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val id = case.getString("name")
      val metric = case.getString("metric")
      val spec = case.getString("spec")
      val units = case.optString("speedUnitSystem", "metric")
      case.optJSONObject("refloat")?.let { dao.upsertBoardConfigValues(BoardConfigValuesEntity(id, "test", it.toString(), 1)) }
      case.optJSONObject("motor")?.let { dao.upsertMotorConfigValues(MotorConfigValuesEntity(id, 1, "test", it.toString(), 1)) }
      dao.upsertAppSetting(AppSettingEntity("unitSystem", JSONObject.quote(units), 1))
      val settings = mutableListOf(BoardSettingEntity(id, "topSpeedKmh", case.optDouble("topSpeedKmh", 50.0).toString(), 1))
      case.optJSONObject("batteryConfig")?.let { settings += BoardSettingEntity(id, "batteryConfig", it.toString(), 1) }
      dao.upsertBoardWithSettings(BoardEntity(id, id, null, 1), settings, emptyList())
      dao.upsertAlertRule(presetRow(id, metric, spec))
      val stored = dao.getAlertRules(id)
      val actual = AlertPresetPersistence.expandedRules(dao, id).filter { it.controlId == metric }
      assertEquals("expansion never writes", stored, dao.getAlertRules(id))
      if (!spec.contains("match=on")) {
        val battery = case.optJSONObject("batteryConfig")?.let { jsonValue(it) }
        val preview = AlertPresetPersistence.preview(metric, spec, case.optDouble("topSpeedKmh", 50.0), AlertPresetGenerator.validBattery(battery), units)
        assertEquals(id, actual, preview.map { it.copy(boardId = id, createdAt = 1) })
      }
      val expected = case.getJSONArray("expected")
      assertEquals(id, expected.length(), actual.size)
      actual.forEachIndexed { n, rule ->
        val target = expected.getJSONObject(n)
        assertEquals(id, "preset:$metric:$n", rule.id)
        assertEquals(id, target.getDouble("threshold"), rule.threshold, 0.00000001)
        if (target.isNull("thresholdMax")) assertNull(rule.thresholdMax) else assertEquals(id, target.getDouble("thresholdMax"), rule.thresholdMax!!, 0.00000001)
        assertEquals(if (target.has("repeatEverySeconds")) target.getLong("repeatEverySeconds") else null, rule.repeatEverySeconds)
        assertEquals(target.optString("fieldId", "").ifEmpty { null }, rule.configFieldId)
        if (target.has("thresholdOffset")) assertEquals(target.getDouble("thresholdOffset"), rule.thresholdOffset!!, 0.0)
        if (target.has("thresholdMaxOffset")) assertEquals(target.getDouble("thresholdMaxOffset"), rule.thresholdMaxOffset!!, 0.0)
        if (target.has("soundType")) assertEquals(id, target.getString("soundType"), rule.soundType)
      }
    }
    db.close()
  }

  @Test fun previewsAreDeterministicAndImperialRangesStayWhole() {
    for (top in listOf(5.0, 10.0, 50.0)) {
      for (level in AlertPresetGenerator.activeLevels) {
        val first = AlertPresetPersistence.preview("speed", "preset($level)", top, false, "imperial")
        assertEquals(first, AlertPresetPersistence.preview("speed", "preset($level)", top, false, "imperial"))
        val rule = first.single()
        val start = rule.threshold / 1.609344
        val end = rule.thresholdMax!! / 1.609344
        assertEquals(kotlin.math.round(start), start, 0.00000001)
        assertEquals(kotlin.math.round(end), end, 0.00000001)
        assertTrue(start >= 0 && start < end)
        assertTrue(rule.thresholdMax <= top)
      }
    }
    for ((metric, spec, units) in listOf(Triple("unknown", "preset(normal)", "metric"), Triple("speed", "normal", "metric"), Triple("speed", "preset(normal)", "unknown"))) {
      var rejected = false
      try { AlertPresetPersistence.preview(metric, spec, 50.0, false, units) } catch (_: IllegalArgumentException) { rejected = true }
      assertTrue(rejected)
    }
  }

  @Test fun unitSwitchChangesExpansionWithoutWrites(): Unit = runBlocking {
    val switch = fixture.getJSONObject("unitSwitch")
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    for (id in listOf("first", "second")) {
      dao.upsertBoardWithSettings(BoardEntity(id, id, null, 1), listOf(BoardSettingEntity(id, "topSpeedKmh", switch.getDouble("topSpeedKmh").toString(), 1)), emptyList())
    }
    dao.upsertAlertRule(presetRow("first", "speed", "preset(normal)"))
    val stored = listOf("first", "second").associateWith { dao.getAlertRules(it) }
    for (units in listOf("imperial", "metric", "imperial")) {
      dao.updateUnitSystem(units)
      val expected = switch.getJSONArray(units)
      for (id in listOf("first", "second")) {
        // `second` has no row: the app default, normal, expands the same way.
        val rule = AlertPresetPersistence.expandedRules(dao, id).single { it.controlId == "speed" }
        assertEquals(expected.getDouble(0), rule.threshold, 0.0000001)
        assertEquals(expected.getDouble(1), rule.thresholdMax!!, 0.0000001)
        assertEquals(stored[id], dao.getAlertRules(id))
      }
    }
    db.close()
  }

  @Test fun presetIntentRewritesOneRowAndSurvivesReopen(): Unit = runBlocking {
    val path = Files.createTempFile("preset-contract", ".db"); Files.delete(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open(); var dao = db.telemetryDao()
    val board = BoardEntity("board", "Board", null, 1)
    suspend fun spec(metric: String) = AlertPresetPersistence.specs(dao, board.id).getValue(metric)
    suspend fun expanded(metric: String) = TuneAlertPersistence(dao).alertRules(board.id).filter { it.controlId == metric }
    dao.upsertBoardWithSettings(board, listOf(BoardSettingEntity(board.id, "topSpeedKmh", "50", 1)), emptyList())
    assertEquals("preset(normal)", spec("speed"))
    assertEquals("geiger:hard", expanded("duty").single().soundType)
    val manual = AlertRuleEntity(board.id, "manual", "speed", 12.0, null, enabled = true, soundType = "alert:warning", createdAt = 1)
    TuneAlertPersistence(dao).saveAlert(manual)
    dao.upsertAppSetting(AppSettingEntity("unitSystem", "\"imperial\"", 1))

    dao.applyAlertPreset(board.id, "speed", "safe", null, null)
    assertEquals("preset(safe)", spec("speed"))
    assertEquals(30.577536, expanded("speed").single { it.id == "preset:speed:0" }.threshold, 0.0000001)
    assertEquals(manual, expanded("speed").single { it.id == "manual" })
    assertEquals(1, dao.getAlertRules(board.id).count { it.id.startsWith("preset:") })

    // Board Top Speed is read at expansion: a board save changes the rules, not the row.
    dao.upsertBoardWithSettings(board, listOf(BoardSettingEntity(board.id, "topSpeedKmh", "60", 1)), emptyList())
    assertEquals("preset(safe)", spec("speed"))
    assertNotEquals(30.577536, expanded("speed").single { it.id == "preset:speed:0" }.threshold, 0.0000001)

    dao.applyAlertPreset(board.id, "speed", null, "mid", null)
    dao.applyAlertPreset(board.id, "speed", "off", null, null)
    assertEquals("preset(off):geiger=mid", spec("speed"))
    assertEquals(listOf(manual), expanded("speed"))
    dao.applyAlertPreset(board.id, "speed", "normal", null, null)
    assertEquals("geiger:mid", expanded("speed").single { it.id == "preset:speed:0" }.soundType)

    dao.upsertAlertRule(AlertRuleEntity(board.id, "preset:duty", "duty", 0.0, null, enabled = true, soundType = "preset(normal):future=1", createdAt = 1))
    dao.applyAlertPreset(board.id, "duty", null, null, true)
    assertEquals("preset(normal):future=1,match=on", spec("duty"))
    val dormant = expanded("duty").single()
    assertEquals("config-relative", dormant.thresholdKind); assertEquals(-10.0, dormant.thresholdOffset!!, 0.0)
    dao.applyAlertPreset(board.id, "duty", null, null, false)
    assertEquals("preset(normal):future=1", spec("duty"))

    for (invalid in listOf<suspend () -> Unit>(
      { dao.applyAlertPreset(board.id, "motor-temp", null, "mid", null) },
      { dao.applyAlertPreset(board.id, "speed", null, "loud", null) },
      { dao.applyAlertPreset(board.id, "speed", null, null, true) },
      { dao.applyAlertPreset(board.id, "speed", "custom", null, null) },
      { dao.applyAlertPreset(board.id, "speed", "safe", "mid", null) },
      { dao.applyAlertPreset("missing", "speed", "safe", null, null) },
      { TuneAlertPersistence(dao).setAlertEnabled(board.id, "preset:speed:0", false) },
      { TuneAlertPersistence(dao).saveAlert(manual.copy(id = "preset:speed")) },
      { TuneAlertPersistence(dao).saveAlert(manual.copy(soundType = "preset(normal)")) },
    )) {
      var rejected = false
      try { invalid() } catch (_: IllegalArgumentException) { rejected = true }
      assertTrue(rejected)
    }
    assertEquals("preset(normal):geiger=mid", spec("speed"))

    db.close()
    val connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("CREATE TRIGGER fail_preset BEFORE INSERT ON alerts WHEN NEW.id LIKE 'preset:%' BEGIN SELECT RAISE(ABORT, 'test preset write'); END")
    connection.close()
    db = open(); dao = db.telemetryDao()
    var failed = false
    try { dao.applyAlertPreset(board.id, "speed", "minimal", null, null) } catch (_: Exception) { failed = true }
    assertTrue(failed)
    assertEquals("preset(normal):geiger=mid", spec("speed"))
    assertEquals(manual, expanded("speed").single { it.id == "manual" })
    db.close(); Files.deleteIfExists(path)
  }
}
