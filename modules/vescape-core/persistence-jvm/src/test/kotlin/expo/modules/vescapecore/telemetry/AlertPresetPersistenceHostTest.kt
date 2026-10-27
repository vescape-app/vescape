package expo.modules.vescapecore.telemetry

import androidx.room.Room
import androidx.room.execSQL
import androidx.room.useWriterConnection
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
    AlertRuleEntity(boardId, "preset:$metric", metric, 0.0, null, enabled = true, spec = spec, createdAt = 1)

  @Test fun sharedExpansionContract(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    val cases = fixture.getJSONArray("cases")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val id = case.getString("name")
      val metric = case.getString("metric")
      val spec = case.getString("spec")
      val units = case.optString("distanceUnit", "km")
      case.optJSONObject("refloat")?.let { dao.upsertBoardConfigValues(BoardConfigValuesEntity(id, "test", it.toString(), 1)) }
      case.optJSONObject("motor")?.let { dao.upsertMotorConfigValues(MotorConfigValuesEntity(id, 1, "test", it.toString(), 1)) }
      dao.upsertAppSetting(AppSettingEntity("distanceUnit", JSONObject.quote(units), 1))
      val settings = mutableListOf(BoardSettingEntity(id, "topSpeedKmh", case.optDouble("topSpeedKmh", 50.0).toString(), 1))
      case.optJSONObject("batteryConfig")?.let { settings += BoardSettingEntity(id, "batteryConfig", it.toString(), 1) }
      dao.upsertBoardWithSettings(BoardEntity(id, id, null, 1), settings, emptyList(), emptyList())
      dao.upsertAlertRule(presetRow(id, metric, spec))
      val stored = dao.getAlertRules(id)
      val actual = AlertPresetPersistence.expandedRules(dao, id) { throw it }.filter { it.controlId == metric }
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
        if (target.has("spec")) assertEquals(id, target.getString("spec"), rule.spec)
      }
    }
    db.close()
  }

  @Test fun previewsAreDeterministicAndImperialRangesStayWhole() {
    for (top in listOf(5.0, 10.0, 50.0)) {
      for (level in AlertPresetGenerator.activeLevels) {
        val first = AlertPresetPersistence.preview("speed", "preset($level)", top, false, "mi")
        assertEquals(first, AlertPresetPersistence.preview("speed", "preset($level)", top, false, "mi"))
        val rule = first.single()
        val start = rule.threshold / 1.609344
        val end = rule.thresholdMax!! / 1.609344
        assertEquals(kotlin.math.round(start), start, 0.00000001)
        assertEquals(kotlin.math.round(end), end, 0.00000001)
        assertTrue(start >= 0 && start < end)
        assertTrue(rule.thresholdMax <= top)
      }
    }
    for ((metric, spec, units) in listOf(Triple("unknown", "preset(normal)", "km"), Triple("speed", "normal", "km"), Triple("speed", "preset(normal)", "unknown"))) {
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
      dao.upsertBoardWithSettings(BoardEntity(id, id, null, 1), listOf(BoardSettingEntity(id, "topSpeedKmh", switch.getDouble("topSpeedKmh").toString(), 1)), emptyList(), emptyList())
    }
    dao.upsertAlertRule(presetRow("first", "speed", "preset(normal)"))
    val stored = listOf("first", "second").associateWith { dao.getAlertRules(it) }
    for (units in listOf("mi", "km", "mi")) {
      dao.updateDistanceUnit(units)
      val expected = switch.getJSONArray(units)
      for (id in listOf("first", "second")) {
        // `second` has no row: the app default, normal, expands the same way.
        val rule = AlertPresetPersistence.expandedRules(dao, id) { throw it }.single { it.controlId == "speed" }
        assertEquals(expected.getDouble(0), rule.threshold, 0.0000001)
        assertEquals(expected.getDouble(1), rule.thresholdMax!!, 0.0000001)
        assertEquals(stored[id], dao.getAlertRules(id))
      }
    }
    db.close()
  }

  /** @parity /modules/vescape-core/persistence-macos/AlertPresetContract.swift `runAlertPresetBoardLifecycleContract` */
  @Test fun missingOrTombstonedBoardExpandsNothing(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    val rider = AlertRuleEntity("ghost", "rider", "speed", 12.0, null, enabled = true, spec = "alert:warning", createdAt = 1)
    dao.upsertAlertRule(rider)
    dao.upsertAlertRule(presetRow("ghost", "speed", "preset(safe)"))
    assertEquals("missing Board", listOf(rider), AlertPresetPersistence.expandedRules(dao, "ghost") { throw it })
    dao.upsertBoardWithSettings(BoardEntity("gone", "Gone", null, 1), emptyList(), emptyList(), emptyList())
    dao.deleteBoardWithSettings("gone", 2)
    assertEquals("tombstoned Board", emptyList<AlertRuleEntity>(), AlertPresetPersistence.expandedRules(dao, "gone") { throw it })
    db.close()
  }

  /** @parity /modules/vescape-core/persistence-macos/AlertPresetContract.swift `runAlertPresetBoardLifecycleContract` */
  @Test fun oneMetricFailingToExpandKeepsTheRest(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    dao.upsertBoardWithSettings(BoardEntity("board", "Board", null, 1), emptyList(), emptyList(), emptyList())
    val rider = AlertRuleEntity("board", "rider", "speed", 12.0, null, enabled = true, spec = "alert:warning", createdAt = 1)
    dao.upsertAlertRule(rider)
    dao.upsertAlertRule(presetRow("board", "duty", "preset(normal):match=on"))
    dao.upsertBoardConfigValues(BoardConfigValuesEntity("board", "test", "not json", 1))
    val failures = mutableListOf<Throwable>()
    val rules = AlertPresetPersistence.expandedRules(dao, "board") { failures += it }
    assertEquals(1, failures.size)
    assertTrue(rider in rules)
    assertTrue(rules.none { it.controlId == "duty" })
    assertTrue(rules.any { it.id == "preset:speed:0" })
    db.close()
  }

  /** @parity /modules/vescape-core/persistence-macos/AlertPresetContract.swift `runAlertPresetBoardLifecycleContract` */
  @Test fun boardIsSavedWithItsInitialAlertsAtomically(): Unit = runBlocking {
    val db = Room.inMemoryDatabaseBuilder<TelemetryRoomDatabase>().setDriver(BundledSQLiteDriver()).build()
    val dao = db.telemetryDao()
    val persistence = BoardSettingsPersistence(dao)
    val rider = AlertRuleEntity("new", "rider", "battery", 20.0, null, enabled = true, spec = "alert:warning", createdAt = 1)
    val alerts = listOf(AlertPresetPersistence.presetRow("new", "speed", "preset(safe)", 1)!!, rider)
    db.useWriterConnection { it.execSQL("CREATE TRIGGER fail_rider BEFORE INSERT ON alerts WHEN NEW.id = 'rider' BEGIN SELECT RAISE(ABORT, 'test'); END") }
    var failed = false
    try { persistence.upsertBoard(BoardEntity("new", "New", null, 1), emptyList(), emptyList(), alerts) } catch (_: Exception) { failed = true }
    assertTrue(failed)
    assertNull("Board rolls back with its alerts", dao.getBoard("new"))
    assertEquals(emptyList<AlertRuleEntity>(), dao.getAlertRules("new"))
    db.useWriterConnection { it.execSQL("DROP TRIGGER fail_rider") }
    persistence.upsertBoard(BoardEntity("new", "New", null, 1), emptyList(), emptyList(), alerts)
    assertEquals("preset(safe)", AlertPresetPersistence.specs(dao, "new").getValue("speed"))
    assertTrue(rider in AlertPresetPersistence.expandedRules(dao, "new") { throw it })
    assertNull("a default spec writes no row", AlertPresetPersistence.presetRow("new", "duty", "preset(normal)", 1))
    var rejected = false
    try { AlertPresetPersistence.presetRow("new", "speed", "geiger:mid", 1) } catch (_: IllegalArgumentException) { rejected = true }
    assertTrue("non-preset spec rejected", rejected)
    db.close()
  }

  @Test fun presetIntentRewritesOneRowAndSurvivesReopen(): Unit = runBlocking {
    val path = Files.createTempFile("preset-contract", ".db"); Files.delete(path)
    fun open() = Room.databaseBuilder<TelemetryRoomDatabase>(path.toString()).setDriver(BundledSQLiteDriver()).build()
    var db = open(); var dao = db.telemetryDao()
    val board = BoardEntity("board", "Board", null, 1)
    suspend fun spec(metric: String) = AlertPresetPersistence.specs(dao, board.id).getValue(metric)
    suspend fun expanded(metric: String) = TuneAlertPersistence(dao).alertRules(board.id) { throw it }.filter { it.controlId == metric }
    dao.upsertBoardWithSettings(board, listOf(BoardSettingEntity(board.id, "topSpeedKmh", "50", 1)), emptyList(), emptyList())
    assertEquals("preset(normal)", spec("speed"))
    assertEquals("geiger:hard", expanded("duty").single().spec)
    val manual = AlertRuleEntity(board.id, "manual", "speed", 12.0, null, enabled = true, spec = "alert:warning", createdAt = 1)
    TuneAlertPersistence(dao).saveAlert(manual)
    dao.upsertAppSetting(AppSettingEntity("distanceUnit", "\"mi\"", 1))

    dao.applyAlertPreset(board.id, "speed", "safe", null, null)
    assertEquals("preset(safe)", spec("speed"))
    assertEquals(30.577536, expanded("speed").single { it.id == "preset:speed:0" }.threshold, 0.0000001)
    assertEquals(manual, expanded("speed").single { it.id == "manual" })
    assertEquals(1, dao.getAlertRules(board.id).count { it.id.startsWith("preset:") })

    // Board Top Speed is read at expansion: a board save changes the rules, not the row.
    dao.upsertBoardWithSettings(board, listOf(BoardSettingEntity(board.id, "topSpeedKmh", "60", 1)), emptyList(), emptyList())
    assertEquals("preset(safe)", spec("speed"))
    assertNotEquals(30.577536, expanded("speed").single { it.id == "preset:speed:0" }.threshold, 0.0000001)

    // Normal with no options is the default: no row.
    dao.applyAlertPreset(board.id, "speed", "normal", null, null)
    assertTrue(dao.getAlertRules(board.id).none { it.id == "preset:speed" })
    assertEquals("preset(normal)", spec("speed"))
    dao.applyAlertPreset(board.id, "speed", "safe", null, null)

    dao.applyAlertPreset(board.id, "speed", null, "mid", null)
    dao.applyAlertPreset(board.id, "speed", "off", null, null)
    assertEquals("preset(off):geiger=mid", spec("speed"))
    assertEquals(listOf(manual), expanded("speed"))
    dao.applyAlertPreset(board.id, "speed", "normal", null, null)
    assertEquals("Normal with an option keeps its row", 1, dao.getAlertRules(board.id).count { it.id == "preset:speed" })
    assertEquals("geiger:mid", expanded("speed").single { it.id == "preset:speed:0" }.spec)

    dao.upsertAlertRule(AlertRuleEntity(board.id, "preset:duty", "duty", 0.0, null, enabled = true, spec = "preset(normal):future=1", createdAt = 1))
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
      { TuneAlertPersistence(dao).saveAlert(manual.copy(spec = "preset(normal)")) },
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
