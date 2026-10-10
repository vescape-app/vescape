import Foundation
import GRDB

/// Native-owned preset intent, persisted with its rules in one transaction.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AlertPresetPersistence.kt
final class AlertPresetPersistence {
  let writer: any DatabaseWriter
  init(writer: any DatabaseWriter) { self.writer = writer }
  static let metrics = AlertPresetGenerator.metrics
  private static let levels = AlertPresetGenerator.levels
  enum InvalidPreset: Error { case invalidIntent, missingBoard }

  static func preview(
    metric: String,
    level: String,
    topSpeedKmh: Double?,
    hasBatteryConfig: Bool,
    speedUnitSystem: String
  ) throws -> [PersistedAlertRule] {
    let input = PresetInput(topSpeedKmh: topSpeedKmh ?? 50, hasBatteryConfig: hasBatteryConfig, speedUnitSystem: speedUnitSystem)
    let specs = try AlertPresetGenerator.generate(metric: metric, level: level, input: input)
    return records(boardId: "", metric: metric, specs: specs, createdAt: 0)
  }

  private static func object(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }
  private static func decode(_ json: String) throws -> Any {
    try JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed)
  }
  static func settings(_ db: Database, _ boardId: String) throws -> [String: Any] {
    try Dictionary(uniqueKeysWithValues: PersistedBoardSetting.filter(Column("board_id") == boardId).fetchAll(db).map { ($0.key, try decode($0.valueJson)) })
  }
  private static func save(_ db: Database, _ boardId: String, _ key: String, _ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    try PersistedBoardSetting(boardId: boardId, key: key, valueJson: String(decoding: data, as: UTF8.self), updatedAt: Int64(Date().timeIntervalSince1970 * 1000)).save(db)
  }
  /// Legacy JS omitted unresolved relations; repair missing slots without replacing existing rules.
  func repairMissingRelations(boardId: String) throws -> Bool {
    try writer.write { try Self.repairMissingRelations($0, boardId: boardId) }
  }
  private static func repairMissingRelations(_ db: Database, boardId: String) throws -> Bool {
    let values = try settings(db, boardId)
    let selection = object(values["alertPreset"])
    let match = object(values["matchBoardConfig"])
    let ids = Set(try PersistedAlertRule.filter(Column("board_id") == boardId).fetchAll(db).map(\.id))
    var changed = false
    for metric in metrics where match[metric] as? Bool == true {
      for rule in try generate(db, boardId: boardId, metric: metric, level: selection[metric] as? String ?? "off", settings: values) {
        if rule.thresholdKind == "config-relative", !ids.contains(rule.id) {
          try rule.save(db)
          changed = true
        }
      }
    }
    return changed
  }
  static func regenerateChanged(_ db: Database, boardId: String, before: [String: Any]) throws {
    let after = try settings(db, boardId)
    for metric in metrics where inputsChanged(metric, before: before, after: after) {
      try regenerate(db, boardId: boardId, metric: metric)
    }
  }

  private static func inputsChanged(_ metric: String, before: [String: Any], after: [String: Any]) -> Bool {
    let previous = object(before["alertPreset"])
    let next = object(after["alertPreset"])
    if (previous[metric] as? String ?? "off") != (next[metric] as? String ?? "off") { return true }
    let oldMatch = object(before["matchBoardConfig"])[metric] as? Bool ?? false
    let newMatch = object(after["matchBoardConfig"])[metric] as? Bool ?? false
    if oldMatch != newMatch { return true }
    switch metric {
    case "speed":
      let oldTop = (before["topSpeedKmh"] as? NSNumber)?.doubleValue
      let newTop = (after["topSpeedKmh"] as? NSNumber)?.doubleValue
      return oldTop != newTop
    case "battery":
      return !NSDictionary(dictionary: object(before["batteryConfig"])).isEqual(to: object(after["batteryConfig"]))
    default: return false
    }
  }

  static func regenerate(_ db: Database, boardId: String, metric: String? = nil) throws {
    let values = try settings(db, boardId)
    let selection = object(values["alertPreset"])
    for metric in metric.map({ [$0] }) ?? metrics {
      try db.execute(sql: "DELETE FROM alerts WHERE board_id = ? AND control_id = ? AND source = 'preset'", arguments: [boardId, metric])
      for rule in try generate(db, boardId: boardId, metric: metric, level: selection[metric] as? String ?? "off", settings: values) { try rule.save(db) }
    }
  }
  func apply(
    boardId: String,
    metric: String,
    action: String,
    level: String?,
    matchBoardConfig: Bool?
  ) throws {
    try writer.write { db in
      guard Self.metrics.contains(metric) else { throw InvalidPreset.invalidIntent }
      guard let board = try PersistedBoard.fetchOne(db, key: boardId), board.deletedAt == nil else { throw InvalidPreset.missingBoard }
      let values = try Self.settings(db, boardId)
      var selection = Self.object(values["alertPreset"])
      for key in Self.metrics where !Self.levels.contains(selection[key] as? String ?? "") { selection[key] = "off" }
      var customized: [PersistedAlertRule] = []
      switch action {
      case "select":
        guard let level, Self.levels.contains(level), level != "custom" else { throw InvalidPreset.invalidIntent }
        selection[metric] = level
      case "customize":
        _ = try Self.repairMissingRelations(db, boardId: boardId)
        if selection[metric] as? String == "custom" { return }
        customized = try Self.materializeRules(db, boardId: boardId, metric: metric)
        selection[metric] = "custom"
      case "discard-custom":
        try db.execute(sql: "DELETE FROM alerts WHERE board_id = ? AND control_id = ? AND (source IS NULL OR source != 'preset')", arguments: [boardId, metric])
        selection[metric] = "normal"
      case "match-board-config":
        guard let matchBoardConfig, try AlertPresetGenerator.matchField(metric) != nil else { throw InvalidPreset.invalidIntent }
        var match = Self.object(values["matchBoardConfig"])
        match[metric] = matchBoardConfig
        try Self.save(db, boardId, "matchBoardConfig", match)
      default: throw InvalidPreset.invalidIntent
      }
      try Self.save(db, boardId, "alertPreset", selection)
      try Self.regenerate(db, boardId: boardId, metric: metric)
      for rule in customized { try rule.save(db) }
    }
  }
  private static func materializeRules(_ db: Database, boardId: String, metric: String) throws -> [PersistedAlertRule] {
    let saved = try PersistedAlertRule
      .filter(Column("board_id") == boardId && Column("control_id") == metric && Column("source") == "preset")
      .fetchAll(db)
    return try saved.compactMap { rule in
      var threshold = rule.threshold
      var thresholdMax = rule.thresholdMax
      if rule.thresholdKind == "config-relative" {
        guard let base = try resolveBase(db, boardId, rule.configFieldId), let offset = rule.thresholdOffset else { return nil }
        threshold = base + offset
        thresholdMax = rule.thresholdMaxOffset.map { base + $0 }
      }
      return PersistedAlertRule(
        boardId: boardId, id: UUID().uuidString, controlId: metric,
        threshold: threshold, thresholdMax: thresholdMax, enabled: rule.enabled,
        soundType: rule.soundType, createdAt: rule.createdAt,
        repeatEverySeconds: rule.repeatEverySeconds, beepCount: rule.beepCount,
        source: nil, thresholdKind: "fixed", configFieldId: nil,
        thresholdOffset: nil, thresholdMaxOffset: nil
      )
    }
  }

  private static func resolveBase(_ db: Database, _ boardId: String, _ field: String?) throws -> Double? {
    func values(_ table: String) throws -> [String: Any] {
      let json = try String.fetchOne(db, sql: "SELECT values_json FROM \(table) WHERE board_id = ? ORDER BY captured_at DESC LIMIT 1", arguments: [boardId])
      return try json.map { object(try decode($0)) } ?? [:]
    }
    return try resolveConfigRelativeBase(field, refloat: values("board_config_values"), motor: values("motor_config_values"))
  }
  static func generate(
    _ db: Database,
    boardId: String,
    metric: String,
    level: String,
    settings: [String: Any]
  ) throws -> [PersistedAlertRule] {
    let rawUnits = try PersistedAppSetting.fetchOne(db, key: "unitSystem")
    let units = try rawUnits.map { try decode($0.valueJson) } as? String
    let matched = object(settings["matchBoardConfig"])[metric] as? Bool == true
    let field = matched ? try AlertPresetGenerator.matchField(metric) : nil
    let input = PresetInput(
      topSpeedKmh: (settings["topSpeedKmh"] as? NSNumber)?.doubleValue ?? 50,
      hasBatteryConfig: try AlertPresetGenerator.validBattery(settings["batteryConfig"]),
      speedUnitSystem: validUnitSystem(units) ?? "metric",
      matchBoardConfig: matched,
      configBase: try field.flatMap { try resolveBase(db, boardId, $0) }
    )
    let savedLevel = levels.contains(level) ? level : "off"
    let specs = try AlertPresetGenerator.generate(metric: metric, level: savedLevel, input: input)
    return records(boardId: boardId, metric: metric, specs: specs, createdAt: Int64(Date().timeIntervalSince1970 * 1000))
  }

  private static func records(
    boardId: String,
    metric: String,
    specs: [GeneratedPresetRule],
    createdAt: Int64
  ) -> [PersistedAlertRule] {
    specs.enumerated().map { index, spec in
      PersistedAlertRule(
        boardId: boardId,
        id: "preset:\(metric):\(index)",
        controlId: metric,
        threshold: spec.point.threshold,
        thresholdMax: spec.point.thresholdMax,
        enabled: true,
        soundType: spec.soundType,
        createdAt: createdAt,
        repeatEverySeconds: spec.point.repeatEverySeconds,
        beepCount: 3,
        source: "preset",
        thresholdKind: spec.relation == nil ? "fixed" : "config-relative",
        configFieldId: spec.relation?.fieldId,
        thresholdOffset: spec.relation?.offset,
        thresholdMaxOffset: spec.relation?.maxOffset
      )
    }
  }
}
