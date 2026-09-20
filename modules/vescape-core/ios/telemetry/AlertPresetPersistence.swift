import Foundation
import GRDB

/// Native-owned preset intent, persisted with its rules in one transaction.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AlertPresetPersistence.kt
/// @parity /src/modules/alerts/lib/alertPresets.ts
final class AlertPresetPersistence {
  let writer: any DatabaseWriter
  init(writer: any DatabaseWriter) { self.writer = writer }
  static let metrics = ["speed", "duty", "motor-temp", "controller-temp", "battery"]
  private static let levels = ["off", "safe", "normal", "minimal", "custom"]
  enum InvalidPreset: Error { case invalidIntent, missingBoard, missingResource }

  private static func resource(_ name: String) throws -> [String: Any] {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let module = Bundle(for: AlertPresetPersistence.self)
    let bundle = module.url(forResource: "VescapeCoreAssets", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? module
    #endif
    guard let url = bundle.url(forResource: name, withExtension: "json") else { throw InvalidPreset.missingResource }
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] ?? [:]
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
    let selection = object(values["alertPreset"]); let match = object(values["matchBoardConfig"])
    let ids = Set(try PersistedAlertRule.filter(Column("board_id") == boardId).fetchAll(db).map(\.id))
    var changed = false
    for metric in metrics where match[metric] as? Bool == true {
      for rule in try generate(db, boardId: boardId, metric: metric, level: selection[metric] as? String ?? "off", settings: values) {
        if rule.thresholdKind == "config-relative", !ids.contains(rule.id) { try rule.save(db); changed = true }
      }
    }
    return changed
  }
  static func regenerateChanged(_ db: Database, boardId: String, before: [String: Any]) throws {
    let after = try settings(db, boardId)
    let previous = object(before["alertPreset"]); let next = object(after["alertPreset"])
    let previousMatch = object(before["matchBoardConfig"]); let nextMatch = object(after["matchBoardConfig"])
    func same(_ a: Any?, _ b: Any?) -> Bool {
      NSDictionary(dictionary: ["v": a ?? NSNull()]).isEqual(to: ["v": b ?? NSNull()])
    }
    for metric in metrics {
      let changed = (previous[metric] as? String ?? "off") != (next[metric] as? String ?? "off") ||
        (previousMatch[metric] as? Bool ?? false) != (nextMatch[metric] as? Bool ?? false) ||
        (metric == "speed" && (!same(before["topSpeedKmh"], after["topSpeedKmh"]) || !same(previous["speedUnitSystem"], next["speedUnitSystem"]))) ||
        (metric == "battery" && !same(before["batteryConfig"], after["batteryConfig"]))
      if changed { try regenerate(db, boardId: boardId, metric: metric) }
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
  func apply(boardId: String, metric: String, action: String, level: String?, matchBoardConfig: Bool?) throws {
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
        customized = try PersistedAlertRule.filter(Column("board_id") == boardId && Column("control_id") == metric && Column("source") == "preset").fetchAll(db).compactMap { rule in
          var threshold = rule.threshold; var thresholdMax = rule.thresholdMax
          if rule.thresholdKind == "config-relative" {
            guard let base = try Self.resolveBase(db, boardId, rule.configFieldId), let offset = rule.thresholdOffset else { return nil }
            threshold = base + offset; thresholdMax = rule.thresholdMaxOffset.map { base + $0 }
          }
          return PersistedAlertRule(boardId: boardId, id: UUID().uuidString, controlId: metric, threshold: threshold, thresholdMax: thresholdMax, enabled: rule.enabled, soundType: rule.soundType, createdAt: rule.createdAt, repeatEverySeconds: rule.repeatEverySeconds, beepCount: rule.beepCount, source: nil, thresholdKind: "fixed", configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil)
        }
        selection[metric] = "custom"
      case "discard-custom":
        try db.execute(sql: "DELETE FROM alerts WHERE board_id = ? AND control_id = ? AND (source IS NULL OR source != 'preset')", arguments: [boardId, metric])
        selection[metric] = "normal"
      case "match-board-config":
        guard let matchBoardConfig, Self.object(try Self.resource("alert-preset-definitions")["match"])[metric] != nil else { throw InvalidPreset.invalidIntent }
        var match = Self.object(values["matchBoardConfig"]); match[metric] = matchBoardConfig
        try Self.save(db, boardId, "matchBoardConfig", match)
      default: throw InvalidPreset.invalidIntent
      }
      if metric == "speed", ["select", "discard-custom"].contains(action), !["off", "custom"].contains(selection[metric] as? String ?? "") {
        let raw = try PersistedAppSetting.fetchOne(db, key: "unitSystem")
        let unit = try raw.map { try Self.decode($0.valueJson) } as? String
        selection["speedUnitSystem"] = unit == "imperial" ? "imperial" : "metric"
      }
      try Self.save(db, boardId, "alertPreset", selection)
      try Self.regenerate(db, boardId: boardId, metric: metric)
      for rule in customized { try rule.save(db) }
    }
  }
  private static func resolveBase(_ db: Database, _ boardId: String, _ field: String?) throws -> Double? {
    func values(_ table: String) throws -> [String: Any] {
      let json = try String.fetchOne(db, sql: "SELECT values_json FROM \(table) WHERE board_id = ? ORDER BY captured_at DESC LIMIT 1", arguments: [boardId])
      return try json.map { object(try decode($0)) } ?? [:]
    }
    return try resolveConfigRelativeBase(field, refloat: values("board_config_values"), motor: values("motor_config_values"))
  }
  static func generate(_ db: Database, boardId: String, metric: String, level: String, settings: [String: Any]) throws -> [PersistedAlertRule] {
    guard ["safe", "normal", "minimal"].contains(level) else { return [] }
    let definitions = try resource("alert-preset-definitions")
    let config = object(object(definitions["metrics"])[metric])
    let match = (object(settings["matchBoardConfig"])[metric] as? Bool == true) ? object(object(definitions["match"])[metric]) : [:]
    let chosen = match.isEmpty ? config : match
    let field = match["fieldId"] as? String
    let base = try field.flatMap { try resolveBase(db, boardId, $0) }
    if match.isEmpty, config["requiresBatteryConfig"] as? Bool == true, try !validBattery(settings["batteryConfig"]) { return [] }
    func tenth(_ value: Double) -> Double { floor(value * 10 + 0.5) / 10 }
    func rule(_ index: Int, _ start: Double, _ end: Double?, _ repeatSeconds: Int64?) -> PersistedAlertRule {
      PersistedAlertRule(boardId: boardId, id: "preset:\(metric):\(index)", controlId: metric,
        threshold: field == nil ? start : base.map { tenth($0 + start) } ?? 0,
        thresholdMax: field == nil ? end : base.flatMap { b in end.map { tenth(b + $0) } },
        enabled: true, soundType: config["soundType"] as? String ?? "", createdAt: Int64(Date().timeIntervalSince1970 * 1000),
        repeatEverySeconds: repeatSeconds, beepCount: 3, source: "preset", thresholdKind: field == nil ? "fixed" : "config-relative", configFieldId: field,
        thresholdOffset: field == nil ? nil : start, thresholdMaxOffset: field == nil ? nil : end)
    }
    let levels = object(chosen["levels"])
    if chosen["family"] as? String == "discrete" {
      return (levels[level] as? [[String: Any]] ?? []).enumerated().map { i, point in
        rule(i, (point["threshold"] as? NSNumber)?.doubleValue ?? 0, nil, (point["repeatEverySeconds"] as? NSNumber)?.int64Value)
      }
    }
    let range = object(levels[level])
    var start = (range["start"] as? NSNumber)?.doubleValue ?? 0
    var end = (range["ceiling"] as? NSNumber)?.doubleValue ?? 0
    if match.isEmpty, config["scaledByTopSpeed"] as? Bool == true {
      let raw = (settings["topSpeedKmh"] as? NSNumber)?.doubleValue ?? 50
      let top = raw.isFinite && raw > 0 ? raw : 50
      start = tenth(start * top); end = tenth(end * top)
      if object(settings["alertPreset"])["speedUnitSystem"] as? String == "imperial" {
        end = max(1, min(floor(top / 1.609344), floor(end / 1.609344 + 0.5)))
        start = max(0, min(end - 1, floor(start / 1.609344 + 0.5)))
        start *= 1.609344; end *= 1.609344
      }
    }
    return [rule(0, start, end, nil)]
  }
  private static func validBattery(_ raw: Any?) throws -> Bool {
    let value = object(raw)
    switch value["mode"] as? String {
    case "manual": return ((value["maxVoltage"] as? NSNumber)?.doubleValue ?? .nan) > ((value["minVoltage"] as? NSNumber)?.doubleValue ?? .nan)
    case "preset":
      let cells = try resource("cell-presets")["cells"] as? [[String: Any]] ?? []
      return cells.contains { $0["id"] as? String == value["cellPresetId"] as? String }
    default: return false
    }
  }
}
