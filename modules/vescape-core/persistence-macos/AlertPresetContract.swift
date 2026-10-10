import Foundation
import GRDB

func runAlertPresetContract() throws {
  try runAlertPresetUnitSwitchContract()
  let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/alert-preset-contract.json"))) as! [String: Any]
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("alert-presets-\(UUID()).db")
  defer { try? FileManager.default.removeItem(at: url) }
  var queue = try DatabaseQueue(path: url.path)
  try TelemetryDatabase.migrator.migrate(queue)
  try queue.write { db in
    for item in fixture["cases"] as! [[String: Any]] {
      let name = item["name"] as! String; let metric = item["metric"] as! String
      if let refloat = item["refloat"] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: refloat), as: UTF8.self)
        try db.execute(sql: "INSERT INTO board_config_values VALUES (?, 'test', ?, 1)", arguments: [name, json])
      }
      if let motor = item["motor"] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: motor), as: UTF8.self)
        try db.execute(sql: "INSERT INTO motor_config_values VALUES (?, 1, 'test', ?, 1)", arguments: [name, json])
      }
      let unitsJson = String(decoding: try JSONSerialization.data(withJSONObject: item["speedUnitSystem"] ?? "metric", options: [.fragmentsAllowed]), as: UTF8.self)
      try PersistedAppSetting(key: "unitSystem", valueJson: unitsJson, updatedAt: 1).save(db)
      var settings: [String: Any] = [ "topSpeedKmh": item["topSpeedKmh"] ?? 50, "matchBoardConfig": [metric: item["matchBoardConfig"] ?? false]]
      settings["batteryConfig"] = item["batteryConfig"]
      let rules = try AlertPresetPersistence.generate(db, boardId: name, metric: metric, level: item["level"] as! String, settings: settings)
      if item["matchBoardConfig"] as? Bool != true {
        let preview = try AlertPresetPersistence.preview(
          metric: metric, level: item["level"] as! String,
          topSpeedKmh: (item["topSpeedKmh"] as? NSNumber)?.doubleValue,
          hasBatteryConfig: AlertPresetGenerator.validBattery(item["batteryConfig"]),
          speedUnitSystem: item["speedUnitSystem"] as? String ?? "metric"
        )
        try require(preview.count == rules.count, name + " preview count")
        for (draft, saved) in zip(preview, rules) {
          try require(draft.id == saved.id && draft.threshold == saved.threshold && draft.thresholdMax == saved.thresholdMax, name + " preview thresholds")
          try require(draft.soundType == saved.soundType && draft.repeatEverySeconds == saved.repeatEverySeconds && draft.beepCount == saved.beepCount, name + " preview sound")
          try require(draft.createdAt == 0 && draft.boardId == "", name + " preview deterministic metadata")
        }
        try require(try Int.fetchOne(db, sql: "SELECT count(*) FROM alerts") == 0, "preview must not write")
      }
      let expected = item["expected"] as! [[String: Any]]
      try require(rules.count == expected.count, name + " count")
      for (rule, point) in zip(rules, expected) {
        try require(abs(rule.threshold - (point["threshold"] as! NSNumber).doubleValue) < 0.00000001, name + " threshold")
        if let end = point["thresholdMax"] as? NSNumber { try require(abs(rule.thresholdMax! - end.doubleValue) < 0.00000001, name + " max") }
        else { try require(rule.thresholdMax == nil, name + " null max") }
        try require(rule.repeatEverySeconds == (point["repeatEverySeconds"] as? NSNumber)?.int64Value, name + " repeat")
        try require(rule.configFieldId == point["fieldId"] as? String, name + " field")
        try require(rule.thresholdOffset == (point["thresholdOffset"] as? NSNumber)?.doubleValue, name + " offset")
        try require(rule.thresholdMaxOffset == (point["thresholdMaxOffset"] as? NSNumber)?.doubleValue, name + " max offset")
      }
    }
  }
  for top in [5.0, 10.0, 50.0] {
    for level in AlertPresetGenerator.activeLevels {
      let rule = try AlertPresetPersistence.preview(metric: "speed", level: level, topSpeedKmh: top, hasBatteryConfig: false, speedUnitSystem: "imperial").first!
      let start = rule.threshold / 1.609344
      let end = rule.thresholdMax! / 1.609344
      try require(abs(start - start.rounded()) < 0.00000001 && abs(end - end.rounded()) < 0.00000001, "imperial preview whole mph")
      try require(start >= 0 && start < end && rule.thresholdMax! <= top, "imperial preview valid range")
    }
  }
  for (metric, level, units) in [("unknown", "normal", "metric"), ("speed", "unknown", "metric"), ("speed", "normal", "unknown")] {
    var rejected = false
    do { _ = try AlertPresetPersistence.preview(metric: metric, level: level, topSpeedKmh: 50, hasBatteryConfig: false, speedUnitSystem: units) } catch { rejected = true }
    try require(rejected, "invalid preview rejected")
  }
  let board = PersistedBoard(id: "board", name: "Board", bleId: nil, transport: nil, createdAt: 1, deletedAt: nil)
  func setting(_ key: String, _ json: String) -> PersistedBoardSetting { .init(boardId: board.id, key: key, valueJson: json, updatedAt: 1) }
  func apply(_ metric: String, _ action: String, _ level: String? = nil, _ match: Bool? = nil) throws {
    try AlertPresetPersistence(writer: queue).apply(boardId: board.id, metric: metric, action: action, level: level, matchBoardConfig: match)
  }
  func rules() throws -> [PersistedAlertRule] { try AlertRulePersistence(writer: queue).rules(boardId: board.id) }
  try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [setting("alertPreset", "{\"speed\":\"normal\",\"duty\":\"normal\"}"), setting("topSpeedKmh", "50")], deletedKeys: [])
  let duty = try rules().first { $0.controlId == "duty" }!
  try queue.write { db in
    try db.execute(sql: "INSERT OR REPLACE INTO app_settings VALUES ('unitSystem', '\"imperial\"', 1)")
    try db.execute(sql: "INSERT INTO alerts (board_id,id,control_id,threshold,threshold_max,enabled,sound_type,created_at,beep_count,threshold_kind) VALUES ('board','manual','speed',12,NULL,1,'preset:tick',1,3,'fixed')")
  }
  try apply("speed", "select", "safe")
  let selected = try rules().first { $0.controlId == "speed" && $0.source == "preset" }!
  try require(abs(selected.threshold - 30.577536) < 0.000001, "imperial selection")
  try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [setting("alertPreset", "{\"speed\":\"minimal\"}")], deletedKeys: [])
  try require(try rules().first { $0.id == selected.id }!.threshold == selected.threshold, "stale board cannot overwrite selection")
  try AlertRulePersistence(writer: queue).setEnabled(boardId: board.id, id: selected.id, enabled: false)
  try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [setting("topSpeedKmh", "50.0")], deletedKeys: [])
  try require(try rules().first { $0.id == selected.id }!.enabled == false, "numeric representation preserves disabled rule")
  try AlertRulePersistence(writer: queue).setEnabled(boardId: board.id, id: selected.id, enabled: true)
  try require(try rules().first { $0.id == duty.id }!.createdAt == duty.createdAt, "unrelated preset preserved")
  try queue.close(); queue = try DatabaseQueue(path: url.path)
  try queue.write { try $0.execute(sql: "CREATE TRIGGER fail_preset BEFORE INSERT ON alerts WHEN NEW.source = 'preset' BEGIN SELECT RAISE(ABORT, 'test preset write'); END") }
  let before = try BoardSettingsPersistence(writer: queue).boardSettings(ids: [board.id]).first { $0.key == "alertPreset" }!.valueJson
  var failed = false
  do { try apply("speed", "select", "minimal") } catch { failed = true }
  try require(failed, "late preset failure")
  failed = false
  do { try BoardSettingsPersistence(writer: queue).upsertBoard(PersistedBoard(id: board.id, name: "Must rollback", bleId: nil, transport: nil, createdAt: 1, deletedAt: nil), settings: [setting("topSpeedKmh", "60")], deletedKeys: []) } catch { failed = true }
  try require(failed, "late Board preset failure")
  try require(try BoardSettingsPersistence(writer: queue).board(id: board.id)?.name == "Board", "Board name rollback")
  try require(try BoardSettingsPersistence(writer: queue).boardSettings(ids: [board.id]).first { $0.key == "topSpeedKmh" }!.valueJson == "50.0", "top speed rollback")
  try require(try BoardSettingsPersistence(writer: queue).boardSettings(ids: [board.id]).first { $0.key == "alertPreset" }!.valueJson == before, "selection rollback")
  try require(try rules().first { $0.id == selected.id }!.threshold == selected.threshold, "rules rollback")
  try queue.write { try $0.execute(sql: "DROP TRIGGER fail_preset") }
  try apply("speed", "customize")
  let custom = try rules().filter { $0.controlId == "speed" }
  try require(custom.count == 2 && custom.allSatisfy { $0.source != "preset" }, "customize preserves existing manual")
  try require(custom.contains { $0.threshold == selected.threshold }, "customize freezes saved speed")
  try apply("speed", "discard-custom")
  try require(try rules().filter { $0.controlId == "speed" }.count == 1, "discard removes manual")
  try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [setting("topSpeedKmh", "60")], deletedKeys: [])
  try require(abs(try rules().first { $0.controlId == "speed" }!.threshold - 43.452288) < 0.000001, "top-speed native regeneration")
  try apply("duty", "match-board-config", nil, true)
  try queue.write { try $0.execute(sql: "DELETE FROM alerts WHERE board_id = 'board' AND control_id = 'duty'") }
  try require(try AlertPresetPersistence(writer: queue).repairMissingRelations(boardId: board.id), "legacy missing relation repair")
  try AlertRulePersistence(writer: queue).setEnabled(boardId: board.id, id: "preset:duty:0", enabled: false)
  try require(try !AlertPresetPersistence(writer: queue).repairMissingRelations(boardId: board.id), "repair idempotent")
  try require(try rules().first { $0.id == "preset:duty:0" }!.enabled == false, "repair preserves disabled")
  try queue.close(); queue = try DatabaseQueue(path: url.path)
  let dormant = try rules().first { $0.controlId == "duty" }!
  try require(dormant.thresholdKind == "config-relative" && dormant.thresholdOffset == -10, "dormant relationship persists")
  try apply("duty", "customize")
  try require(try rules().allSatisfy { $0.controlId != "duty" }, "dormant relation not frozen")
  try queue.close()
  print("PASS alert-preset-close-reopen-rollback")
}

func runAlertPresetUnitSwitchContract() throws {
  let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/alert-preset-contract.json"))) as! [String: Any]
  let switchCase = fixture["unitSwitch"] as! [String: Any]
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("preset-units-\(UUID()).db")
  defer { try? FileManager.default.removeItem(at: url) }
  var queue = try DatabaseQueue(path: url.path)
  try TelemetryDatabase.migrator.migrate(queue)
  for id in ["first", "second", "custom"] {
    let board = PersistedBoard(id: id, name: id, bleId: nil, transport: nil, createdAt: 1, deletedAt: nil)
    try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [
      .init(boardId: id, key: "alertPreset", valueJson: "{\"speed\":\"normal\",\"duty\":\"normal\",\"speedUnitSystem\":\"imperial\"}", updatedAt: 1),
      .init(boardId: id, key: "topSpeedKmh", valueJson: String((switchCase["topSpeedKmh"] as! NSNumber).doubleValue), updatedAt: 1),
    ], deletedKeys: [])
  }
  try AlertPresetPersistence(writer: queue).apply(boardId: "custom", metric: "speed", action: "customize", level: nil, matchBoardConfig: nil)
  func rules(_ id: String) throws -> [PersistedAlertRule] { try AlertRulePersistence(writer: queue).rules(boardId: id) }
  func snapshot(_ id: String) throws -> Data {
    let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
    return try encoder.encode(rules(id))
  }
  let frozen = try snapshot("custom")
  let duty = try rules("first").first { $0.controlId == "duty" }!
  let custom = switchCase["custom"] as! [Double]
  try queue.write { db in
    try db.execute(sql: "INSERT INTO alerts (board_id,id,control_id,threshold,threshold_max,enabled,sound_type,created_at,beep_count,threshold_kind) VALUES ('first','manual','speed',?,?,1,'preset:tick',1,3,'fixed')", arguments: [custom[0], custom[1]])
  }
  for units in ["imperial", "metric", "imperial"] {
    try BoardSettingsPersistence(writer: queue).updateUnitSystem(units)
    let expected = switchCase[units] as! [Double]
    for id in ["first", "second"] {
      let rule = try rules(id).first { $0.controlId == "speed" && $0.source == "preset" }!
      try require(abs(rule.threshold - expected[0]) < 0.0000001 && abs(rule.thresholdMax! - expected[1]) < 0.0000001, "unit switch regenerates every board")
    }
    try require(try snapshot("custom") == frozen, "custom board stays exact")
    let manual = try rules("first").first { $0.id == "manual" }!
    try require(manual.threshold == custom[0] && manual.thresholdMax == custom[1], "manual range stays exact")
    try require(try rules("first").first { $0.id == duty.id }!.threshold == duty.threshold, "other metrics unchanged")
  }
  let saved = try snapshot("first")
  try BoardSettingsPersistence(writer: queue).updateUnitSystem("imperial")
  try require(try snapshot("first") == saved, "same units preserve rules")
  try queue.close()
  queue = try DatabaseQueue(path: url.path)
  try require(try snapshot("first") == saved, "unit switch survives reopen")
  try queue.write { db in
    try db.execute(sql: "CREATE TRIGGER fail_unit_switch BEFORE INSERT ON alerts WHEN NEW.source = 'preset' AND NEW.board_id = 'second' BEGIN SELECT RAISE(ABORT, 'test unit switch'); END")
  }
  var failed = false
  do { try BoardSettingsPersistence(writer: queue).updateUnitSystem("metric") } catch { failed = true }
  try require(failed, "unit switch failure injected")
  let units = try BoardSettingsPersistence(writer: queue).setting("unitSystem")!
  try require(units.valueJson == "\"imperial\"", "unit switch rolls back preference")
  try require(try snapshot("first") == saved, "unit switch rolls back regenerated rules")
  try require(try snapshot("custom") == frozen, "unit switch failure preserves custom")
}
