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
  @Test fun sharedGenerationContract(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    val fixture = JSONObject(java.io.File("../shared/alert-preset-contract.json").readText()).getJSONArray("cases")
    for (i in 0 until fixture.length()) {
      val case = fixture.getJSONObject(i)
      val id = case.getString("name")
      val metric = case.getString("metric")
      case.optJSONObject("refloat")?.let { dao.upsertBoardConfigValues(BoardConfigValuesEntity(id, "test", it.toString(), 1)) }
      case.optJSONObject("motor")?.let { dao.upsertMotorConfigValues(MotorConfigValuesEntity(id, 1, "test", it.toString(), 1)) }
      val settings = mutableMapOf<String, Any?>("alertPreset" to mapOf("speedUnitSystem" to case.optString("speedUnitSystem", "metric")), "topSpeedKmh" to case.optDouble("topSpeedKmh", 50.0), "matchBoardConfig" to mapOf(metric to case.optBoolean("matchBoardConfig")))
      case.optJSONObject("batteryConfig")?.let { settings["batteryConfig"] = jsonValue(it) }
      val actual = AlertPresetPersistence.generate(dao, id, metric, case.getString("level"), settings)
      if (!case.optBoolean("matchBoardConfig")) {
        val preview = AlertPresetPersistence.preview(metric, case.getString("level"), case.optDouble("topSpeedKmh", 50.0), AlertPresetGenerator.validBattery(settings["batteryConfig"]), case.optString("speedUnitSystem", "metric"))
        assertEquals(actual, preview.mapIndexed { index, rule -> rule.copy(boardId = id, createdAt = actual[index].createdAt) })
        assertTrue(dao.getAlertRules(id).isEmpty())
      }
      val expected = case.getJSONArray("expected")
      assertEquals(id, expected.length(), actual.size)
      actual.forEachIndexed { n, rule ->
        val target = expected.getJSONObject(n)
        assertEquals(id, target.getDouble("threshold"), rule.threshold, 0.00000001)
        if (target.isNull("thresholdMax")) assertNull(rule.thresholdMax) else assertEquals(id, target.getDouble("thresholdMax"), rule.thresholdMax!!, 0.00000001)
        assertEquals(if (target.has("repeatEverySeconds")) target.getLong("repeatEverySeconds") else null, rule.repeatEverySeconds)
        assertEquals(target.optString("fieldId", "").ifEmpty { null }, rule.configFieldId)
        if (target.has("thresholdOffset")) assertEquals(target.getDouble("thresholdOffset"), rule.thresholdOffset!!, 0.0)
        if (target.has("thresholdMaxOffset")) assertEquals(target.getDouble("thresholdMaxOffset"), rule.thresholdMaxOffset!!, 0.0)
      }
    }
    db.close()
  }

  @Test fun previewsAreDeterministicAndImperialRangesStayWhole() {
    for (top in listOf(5.0, 10.0, 50.0)) {
      for (level in AlertPresetGenerator.activeLevels) {
        val first = AlertPresetPersistence.preview("speed", level, top, false, "imperial")
        assertEquals(first, AlertPresetPersistence.preview("speed", level, top, false, "imperial"))
        val rule = first.single()
        val start = rule.threshold / 1.609344
        val end = rule.thresholdMax!! / 1.609344
        assertEquals(kotlin.math.round(start), start, 0.00000001)
        assertEquals(kotlin.math.round(end), end, 0.00000001)
        assertTrue(start >= 0 && start < end)
        assertTrue(rule.thresholdMax <= top)
      }
    }
    for ((metric, level, units) in listOf(Triple("unknown", "normal", "metric"), Triple("speed", "unknown", "metric"), Triple("speed", "normal", "unknown"))) {
      var rejected = false
      try { AlertPresetPersistence.preview(metric, level, 50.0, false, units) } catch (_: IllegalArgumentException) { rejected = true }
      assertTrue(rejected)
    }
  }

  @Test fun presetIntentIsAtomicAndSurvivesReopen(): Unit = runBlocking {
    val path = Files.createTempFile("preset-contract", ".db"); Files.delete(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open(); var dao = db.telemetryDao()
    val board = BoardEntity("board", "Board", null, 1)
    fun setting(key: String, json: String) = BoardSettingEntity(board.id, key, json, 1)
    dao.upsertBoardWithSettings(board, listOf(setting("alertPreset", "{\"speed\":\"normal\",\"duty\":\"normal\"}"), setting("topSpeedKmh", "50")), emptyList())
    val duty = dao.getAlertRules(board.id).single { it.controlId == "duty" }
    val manual = duty.copy(id = "manual", controlId = "speed", threshold = 12.0, source = null)
    dao.upsertAlertRule(manual)
    dao.upsertAppSetting(AppSettingEntity("unitSystem", "\"imperial\"", 1))
    dao.applyAlertPreset(board.id, "speed", "select", "safe", null)
    val selected = dao.getAlertRules(board.id).single { it.controlId == "speed" && it.source == "preset" }
    assertEquals(30.577536, selected.threshold, 0.0000001)
    dao.upsertBoardWithSettings(board.copy(name = "Renamed"), listOf(setting("alertPreset", "{\"speed\":\"minimal\"}")), emptyList())
    dao.setAlertRuleEnabled(board.id, selected.id, false)
    dao.upsertBoardWithSettings(board.copy(name = "Renamed"), listOf(setting("topSpeedKmh", "50.0")), emptyList())
    assertFalse(dao.getAlertRules(board.id).single { it.id == selected.id }.enabled)
    dao.setAlertRuleEnabled(board.id, selected.id, true)
    assertEquals(selected, dao.getAlertRules(board.id).single { it.id == selected.id })
    assertEquals(duty, dao.getAlertRules(board.id).single { it.id == duty.id })
    db.close()
    val connection = BundledSQLiteDriver().open(path.toString())
    connection.execSQL("CREATE TRIGGER fail_preset BEFORE INSERT ON alerts WHEN NEW.source = 'preset' BEGIN SELECT RAISE(ABORT, 'test preset write'); END")
    connection.close()
    db = open(); dao = db.telemetryDao()
    val before = dao.getBoardSettings(board.id)
    var failed = false
    try { dao.applyAlertPreset(board.id, "speed", "select", "minimal", null) } catch (_: Exception) { failed = true }
    assertTrue(failed)
    failed = false
    try { dao.upsertBoardWithSettings(board.copy(name = "Must rollback"), listOf(setting("topSpeedKmh", "60")), emptyList()) } catch (_: Exception) { failed = true }
    assertTrue(failed)
    assertEquals("Renamed", dao.getBoard(board.id)!!.name)
    assertEquals(before, dao.getBoardSettings(board.id))
    assertEquals(selected, dao.getAlertRules(board.id).single { it.id == selected.id })
    db.close()
    val reset = BundledSQLiteDriver().open(path.toString()); reset.execSQL("DROP TRIGGER fail_preset"); reset.close()
    db = open(); dao = db.telemetryDao()
    dao.applyAlertPreset(board.id, "speed", "customize", null, null)
    val custom = dao.getAlertRules(board.id).filter { it.controlId == "speed" }
    assertEquals(2, custom.size); assertTrue(custom.none { it.source == "preset" }); assertTrue(custom.any { it.threshold == selected.threshold })
    dao.applyAlertPreset(board.id, "speed", "discard-custom", null, null)
    assertEquals(1, dao.getAlertRules(board.id).count { it.controlId == "speed" })
    dao.upsertBoardWithSettings(board, listOf(setting("topSpeedKmh", "60")), emptyList())
    assertEquals(43.452288, dao.getAlertRules(board.id).single { it.controlId == "speed" }.threshold, 0.0000001)
    assertEquals(duty, dao.getAlertRules(board.id).single { it.id == duty.id })
    dao.applyAlertPreset(board.id, "duty", "match-board-config", null, true)
    val dormant = dao.getAlertRules(board.id).single { it.controlId == "duty" }
    assertEquals("config-relative", dormant.thresholdKind); assertEquals(-10.0, dormant.thresholdOffset!!, 0.0)
    dao.deleteAlertRule(board.id, dormant.id)
    assertTrue(dao.repairMissingAlertPresetRelations(board.id))
    val repaired = dao.getAlertRules(board.id).single { it.controlId == "duty" }
    dao.setAlertRuleEnabled(board.id, repaired.id, false)
    assertFalse(dao.repairMissingAlertPresetRelations(board.id))
    assertFalse(dao.getAlertRules(board.id).single { it.id == repaired.id }.enabled)
    dao.setAlertRuleEnabled(board.id, repaired.id, true)
    db.close(); db = open(); dao = db.telemetryDao()
    assertEquals(repaired, dao.getAlertRules(board.id).single { it.controlId == "duty" })
    dao.applyAlertPreset(board.id, "duty", "customize", null, null)
    assertTrue(dao.getAlertRules(board.id).none { it.controlId == "duty" })
    db.close(); Files.deleteIfExists(path)
  }
}
