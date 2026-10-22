import Foundation
import GRDB

/// Host contracts expect every preset to expand; a failure is a contract break.
let unexpectedPresetFailure: (Error) -> Void = { fatalError("Alert Preset expansion failed: \($0)") }

private func presetRow(_ boardId: String, _ metric: String, _ spec: String) -> PersistedAlertRule {
  PersistedAlertRule(
    boardId: boardId, id: "preset:\(metric)", controlId: metric, threshold: 0, thresholdMax: nil,
    enabled: true, spec: spec, createdAt: 1, repeatEverySeconds: nil, thresholdKind: "fixed",
    configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil
  )
}

private func storedRules(_ queue: DatabaseQueue, _ boardId: String) throws -> Data {
  let rows = try queue.read { db in
    try PersistedAlertRule.filter(Column("board_id") == boardId).order(Column("id")).fetchAll(db)
  }
  let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
  return try encoder.encode(rows)
}

func runAlertPresetContract() throws {
  try runAlertPresetUnitSwitchContract()
  try runAlertPresetBoardLifecycleContract()
  let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/alert-preset-contract.json"))) as! [String: Any]
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("alert-presets-\(UUID()).db")
  defer { try? FileManager.default.removeItem(at: url) }
  var queue = try DatabaseQueue(path: url.path)
  try TelemetryDatabase.migrator.migrate(queue)
  for item in fixture["cases"] as! [[String: Any]] {
    let name = item["name"] as! String; let metric = item["metric"] as! String; let spec = item["spec"] as! String
    let units = item["speedUnitSystem"] as? String ?? "metric"
    try queue.write { db in
      if let refloat = item["refloat"] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: refloat), as: UTF8.self)
        try db.execute(sql: "INSERT INTO board_config_values VALUES (?, 'test', ?, 1)", arguments: [name, json])
      }
      if let motor = item["motor"] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: motor), as: UTF8.self)
        try db.execute(sql: "INSERT INTO motor_config_values VALUES (?, 1, 'test', ?, 1)", arguments: [name, json])
      }
      let unitsJson = String(decoding: try JSONSerialization.data(withJSONObject: units, options: [.fragmentsAllowed]), as: UTF8.self)
      try PersistedAppSetting(key: "unitSystem", valueJson: unitsJson, updatedAt: 1).save(db)
    }
    var settings = [PersistedBoardSetting(boardId: name, key: "topSpeedKmh", valueJson: String((item["topSpeedKmh"] as? NSNumber)?.doubleValue ?? 50), updatedAt: 1)]
    if let battery = item["batteryConfig"] {
      settings.append(.init(boardId: name, key: "batteryConfig", valueJson: String(decoding: try JSONSerialization.data(withJSONObject: battery), as: UTF8.self), updatedAt: 1))
    }
    try BoardSettingsPersistence(writer: queue).upsertBoard(PersistedBoard(id: name, name: name, bleId: nil, transport: nil, createdAt: 1, deletedAt: nil), settings: settings, deletedKeys: [])
    try queue.write { try presetRow(name, metric, spec).save($0) }
    let stored = try storedRules(queue, name)
    let rules = try AlertRulePersistence(writer: queue).rules(boardId: name, reportPresetFailure: unexpectedPresetFailure).filter { $0.controlId == metric }
    try require(try storedRules(queue, name) == stored, name + " expansion never writes")
    if !spec.contains("match=on") {
      let preview = try AlertPresetPersistence.preview(
        metric: metric, spec: spec,
        topSpeedKmh: (item["topSpeedKmh"] as? NSNumber)?.doubleValue,
        hasBatteryConfig: AlertPresetGenerator.validBattery(item["batteryConfig"]),
        speedUnitSystem: units
      )
      try require(preview.count == rules.count, name + " preview count")
      for (draft, saved) in zip(preview, rules) {
        try require(draft.id == saved.id && draft.threshold == saved.threshold && draft.thresholdMax == saved.thresholdMax, name + " preview thresholds")
        try require(draft.spec == saved.spec && draft.repeatEverySeconds == saved.repeatEverySeconds, name + " preview sound")
        try require(draft.createdAt == 0 && draft.boardId == "", name + " preview deterministic metadata")
      }
    }
    let expected = item["expected"] as! [[String: Any]]
    try require(rules.count == expected.count, name + " count")
    for (index, (rule, point)) in zip(rules, expected).enumerated() {
      try require(rule.id == "preset:\(metric):\(index)", name + " deterministic id")
      try require(abs(rule.threshold - (point["threshold"] as! NSNumber).doubleValue) < 0.00000001, name + " threshold")
      if let end = point["thresholdMax"] as? NSNumber { try require(abs(rule.thresholdMax! - end.doubleValue) < 0.00000001, name + " max") }
      else { try require(rule.thresholdMax == nil, name + " null max") }
      try require(rule.repeatEverySeconds == (point["repeatEverySeconds"] as? NSNumber)?.int64Value, name + " repeat")
      try require(rule.configFieldId == point["fieldId"] as? String, name + " field")
      try require(rule.thresholdOffset == (point["thresholdOffset"] as? NSNumber)?.doubleValue, name + " offset")
      try require(rule.thresholdMaxOffset == (point["thresholdMaxOffset"] as? NSNumber)?.doubleValue, name + " max offset")
      if let sound = point["spec"] as? String { try require(rule.spec == sound, name + " sound") }
    }
  }
  for top in [5.0, 10.0, 50.0] {
    for level in AlertPresetGenerator.activeLevels {
      let rule = try AlertPresetPersistence.preview(metric: "speed", spec: "preset(\(level))", topSpeedKmh: top, hasBatteryConfig: false, speedUnitSystem: "imperial").first!
      let start = rule.threshold / 1.609344
      let end = rule.thresholdMax! / 1.609344
      try require(abs(start - start.rounded()) < 0.00000001 && abs(end - end.rounded()) < 0.00000001, "imperial preview whole mph")
      try require(start >= 0 && start < end && rule.thresholdMax! <= top, "imperial preview valid range")
    }
  }
  for (metric, spec, units) in [("unknown", "preset(normal)", "metric"), ("speed", "normal", "metric"), ("speed", "preset(normal)", "unknown")] {
    var rejected = false
    do { _ = try AlertPresetPersistence.preview(metric: metric, spec: spec, topSpeedKmh: 50, hasBatteryConfig: false, speedUnitSystem: units) } catch { rejected = true }
    try require(rejected, "invalid preview rejected")
  }

  let board = PersistedBoard(id: "board", name: "Board", bleId: nil, transport: nil, createdAt: 1, deletedAt: nil)
  func apply(_ metric: String, level: String? = nil, geiger: String? = nil, match: Bool? = nil, board id: String = "board") throws {
    try AlertPresetPersistence(writer: queue).apply(boardId: id, metric: metric, level: level, geiger: geiger, match: match)
  }
  func spec(_ metric: String) throws -> String { try AlertRulePersistence(writer: queue).presets(boardId: board.id)[metric]! }
  func expanded(_ metric: String) throws -> [PersistedAlertRule] { try AlertRulePersistence(writer: queue).rules(boardId: board.id, reportPresetFailure: unexpectedPresetFailure).filter { $0.controlId == metric } }
  try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [.init(boardId: board.id, key: "topSpeedKmh", valueJson: "50", updatedAt: 1)], deletedKeys: [])
  try require(try spec("speed") == "preset(normal)", "missing row is the app default")
  try require(try expanded("duty").first?.spec == "geiger:hard", "default expands")
  let manual = PersistedAlertRule(
    boardId: board.id, id: "manual", controlId: "speed", threshold: 12, thresholdMax: nil, enabled: true,
    spec: "alert:warning", createdAt: 1, repeatEverySeconds: nil, thresholdKind: "fixed",
    configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil
  )
  try AlertRulePersistence(writer: queue).save(manual)
  try queue.write { try $0.execute(sql: "INSERT OR REPLACE INTO app_settings VALUES ('unitSystem', '\"imperial\"', 1)") }

  try apply("speed", level: "safe")
  try require(try spec("speed") == "preset(safe)", "level rewrite")
  try require(abs(try expanded("speed").first { $0.id == "preset:speed:0" }!.threshold - 30.577536) < 0.000001, "imperial expansion")
  try require(try expanded("speed").contains { $0.id == "manual" }, "rider rule beside preset")
  try require(try queue.read { try Int.fetchOne($0, sql: "SELECT count(*) FROM alerts WHERE board_id = 'board' AND id LIKE 'preset:%'") } == 1, "one preset row")

  try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [.init(boardId: board.id, key: "topSpeedKmh", valueJson: "60", updatedAt: 1)], deletedKeys: [])
  try require(try spec("speed") == "preset(safe)", "board save keeps the row")
  try require(abs(try expanded("speed").first { $0.id == "preset:speed:0" }!.threshold - 30.577536) > 0.000001, "top speed read at expansion")

  func hasRow(_ metric: String) throws -> Bool {
    try queue.read { try Int.fetchOne($0, sql: "SELECT count(*) FROM alerts WHERE board_id = 'board' AND id = ?", arguments: ["preset:" + metric]) } == 1
  }
  try apply("speed", level: "normal")
  try require(try !hasRow("speed") && spec("speed") == "preset(normal)", "Normal with no options removes the row")
  try apply("speed", level: "safe")

  try apply("speed", geiger: "mid")
  try apply("speed", level: "off")
  try require(try spec("speed") == "preset(off):geiger=mid", "Off keeps options")
  try require(try expanded("speed").map(\.id) == ["manual"], "Off expands to none")
  try apply("speed", level: "normal")
  try require(try hasRow("speed"), "Normal with an option keeps its row")
  try require(try expanded("speed").first { $0.id == "preset:speed:0" }!.spec == "geiger:mid", "geiger option survives Off and back")

  try queue.write { try presetRow(board.id, "duty", "preset(normal):future=1").save($0) }
  try apply("duty", match: true)
  try require(try spec("duty") == "preset(normal):future=1,match=on", "unknown keys preserved")
  let dormant = try expanded("duty").first!
  try require(dormant.thresholdKind == "config-relative" && dormant.thresholdOffset == -10, "match expands config-relative")
  try apply("duty", match: false)
  try require(try spec("duty") == "preset(normal):future=1", "match off removes the option")

  let invalid: [() throws -> Void] = [
    { try apply("motor-temp", geiger: "mid") },
    { try apply("speed", geiger: "loud") },
    { try apply("speed", match: true) },
    { try apply("speed", level: "custom") },
    { try apply("speed", level: "safe", geiger: "mid") },
    { try apply("speed", level: "safe", board: "missing") },
    { try AlertRulePersistence(writer: queue).setEnabled(boardId: board.id, id: "preset:speed:0", enabled: false) },
    { try AlertRulePersistence(writer: queue).save(presetRow(board.id, "speed", "preset(off)")) },
    { try AlertRulePersistence(writer: queue).save(PersistedAlertRule(boardId: board.id, id: "rider", controlId: "speed", threshold: 1, thresholdMax: nil, enabled: true, spec: "preset(normal)", createdAt: 1, repeatEverySeconds: nil, thresholdKind: "fixed", configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil)) },
  ]
  for change in invalid {
    var rejected = false
    do { try change() } catch { rejected = true }
    try require(rejected, "invalid preset change rejected")
  }
  try require(try spec("speed") == "preset(normal):geiger=mid", "rejections leave the row")

  try queue.close(); queue = try DatabaseQueue(path: url.path)
  try queue.write { db in
    // GRDB saves an existing row with UPDATE, a new one with INSERT: fail both.
    for event in ["INSERT", "UPDATE"] {
      try db.execute(sql: "CREATE TRIGGER fail_preset_\(event) BEFORE \(event) ON alerts WHEN NEW.id LIKE 'preset:%' BEGIN SELECT RAISE(ABORT, 'test preset write'); END")
    }
  }
  var failed = false
  do { try apply("speed", level: "minimal") } catch { failed = true }
  try require(failed, "late preset failure")
  try require(try spec("speed") == "preset(normal):geiger=mid", "row rollback and reopen")
  try require(try expanded("speed").contains { $0.id == "manual" }, "rider rule survives")
  try queue.close()
  print("PASS alert-preset-close-reopen-rollback")
}

func runAlertPresetUnitSwitchContract() throws {
  let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "shared/alert-preset-contract.json"))) as! [String: Any]
  let switchCase = fixture["unitSwitch"] as! [String: Any]
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("preset-units-\(UUID()).db")
  defer { try? FileManager.default.removeItem(at: url) }
  let queue = try DatabaseQueue(path: url.path)
  try TelemetryDatabase.migrator.migrate(queue)
  for id in ["first", "second"] {
    let board = PersistedBoard(id: id, name: id, bleId: nil, transport: nil, createdAt: 1, deletedAt: nil)
    try BoardSettingsPersistence(writer: queue).upsertBoard(board, settings: [
      .init(boardId: id, key: "topSpeedKmh", valueJson: String((switchCase["topSpeedKmh"] as! NSNumber).doubleValue), updatedAt: 1),
    ], deletedKeys: [])
  }
  try queue.write { try presetRow("first", "speed", "preset(normal)").save($0) }
  let stored = try ["first", "second"].map { try storedRules(queue, $0) }
  for units in ["imperial", "metric", "imperial"] {
    try BoardSettingsPersistence(writer: queue).updateUnitSystem(units)
    let expected = switchCase[units] as! [Double]
    for (index, id) in ["first", "second"].enumerated() {
      // `second` has no row: the app default, normal, expands the same way.
      let rule = try AlertRulePersistence(writer: queue).rules(boardId: id, reportPresetFailure: unexpectedPresetFailure).first { $0.controlId == "speed" }!
      try require(abs(rule.threshold - expected[0]) < 0.0000001 && abs(rule.thresholdMax! - expected[1]) < 0.0000001, "unit switch changes every board's expansion")
      try require(try storedRules(queue, id) == stored[index], "unit switch writes no rules")
    }
  }
  try queue.close()
}

/// A missing or tombstoned Board expands nothing, one failing metric leaves the rest, and a new
/// Board's initial alerts commit or roll back with it.
/// @parity /modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/telemetry/AlertPresetPersistenceHostTest.kt
func runAlertPresetBoardLifecycleContract() throws {
  let queue = try DatabaseQueue()
  try TelemetryDatabase.migrator.migrate(queue)
  let boards = BoardSettingsPersistence(writer: queue)
  func rider(_ boardId: String) -> PersistedAlertRule {
    PersistedAlertRule(
      boardId: boardId, id: "rider", controlId: "speed", threshold: 12, thresholdMax: nil, enabled: true,
      spec: "alert:warning", createdAt: 1, repeatEverySeconds: nil, thresholdKind: "fixed",
      configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil
    )
  }
  func expanded(_ boardId: String, _ report: (Error) -> Void = unexpectedPresetFailure) throws -> [String] {
    try AlertRulePersistence(writer: queue).rules(boardId: boardId, reportPresetFailure: report).map(\.id)
  }

  try queue.write { db in
    try rider("ghost").save(db)
    try presetRow("ghost", "speed", "preset(safe)").save(db)
  }
  try require(try expanded("ghost") == ["rider"], "missing Board expands nothing")
  try boards.upsertBoard(PersistedBoard(id: "gone", name: "Gone", bleId: nil, transport: nil, createdAt: 1, deletedAt: nil), settings: [], deletedKeys: [])
  try boards.tombstoneBoard(id: "gone", deletedAt: 2)
  try require(try expanded("gone").isEmpty, "tombstoned Board expands nothing")

  try boards.upsertBoard(PersistedBoard(id: "board", name: "Board", bleId: nil, transport: nil, createdAt: 1, deletedAt: nil), settings: [], deletedKeys: [])
  try queue.write { db in
    try rider("board").save(db)
    try presetRow("board", "duty", "preset(normal):match=on").save(db)
    try db.execute(sql: "INSERT INTO board_config_values VALUES ('board', 'test', 'not json', 1)")
  }
  var failures = 0
  let isolated = try expanded("board") { _ in failures += 1 }
  try require(failures == 1, "failing metric reported once")
  try require(isolated.contains("rider") && isolated.contains("preset:speed:0") && !isolated.contains { $0.hasPrefix("preset:duty") }, "failing metric skipped, the rest expand")

  let fresh = PersistedBoard(id: "new", name: "New", bleId: nil, transport: nil, createdAt: 1, deletedAt: nil)
  let alerts = [try AlertPresetPersistence.presetRow(boardId: "new", metric: "speed", spec: "preset(safe)", createdAt: 1)!, rider("new")]
  try queue.write { try $0.execute(sql: "CREATE TRIGGER fail_rider BEFORE INSERT ON alerts WHEN NEW.id = 'rider' BEGIN SELECT RAISE(ABORT, 'test'); END") }
  var failed = false
  do { try boards.upsertBoard(fresh, settings: [], deletedKeys: [], alerts: alerts) } catch { failed = true }
  try require(failed, "initial alert failure")
  try require(try boards.board(id: "new") == nil, "Board rolls back with its alerts")
  try queue.write { try $0.execute(sql: "DROP TRIGGER fail_rider") }
  try boards.upsertBoard(fresh, settings: [], deletedKeys: [], alerts: alerts)
  try require(try AlertRulePersistence(writer: queue).presets(boardId: "new")["speed"] == "preset(safe)", "initial preset saved")
  try require(try expanded("new").contains("rider"), "initial rider rule saved")
  try require(try AlertPresetPersistence.presetRow(boardId: "new", metric: "duty", spec: "preset(normal)", createdAt: 1) == nil, "a default spec writes no row")
  var rejected = false
  do { _ = try AlertPresetPersistence.presetRow(boardId: "new", metric: "speed", spec: "geiger:mid", createdAt: 1) } catch { rejected = true }
  try require(rejected, "non-preset spec rejected")
  print("PASS alert-preset-board-lifecycle")
}
