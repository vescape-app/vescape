import Foundation
import GRDB

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AlertPresetPersistence.kt
final class AlertPresetPersistence {
  let writer: any DatabaseWriter
  init(writer: any DatabaseWriter) { self.writer = writer }
  static let metrics = AlertPresetGenerator.metrics
  private static let defaultSpec = AlertPresetSpec(level: "normal")
  enum InvalidPreset: Error { case invalidIntent, missingBoard }

  private static func rowId(_ metric: String) -> String { presetRulePrefix + metric }

  static func isPresetId(_ id: String) -> Bool { id.hasPrefix(presetRulePrefix) }

  static func preview(
    metric: String,
    spec: String,
    topSpeedKmh: Double?,
    hasBatteryConfig: Bool,
    distanceUnit: String
  ) throws -> [PersistedAlertRule] {
    guard let parsed = AlertPresetSpec.parse(spec) else { throw InvalidPreset.invalidIntent }
    let input = PresetInput(topSpeedKmh: topSpeedKmh ?? 50, hasBatteryConfig: hasBatteryConfig, distanceUnit: distanceUnit)
    let specs = try AlertPresetGenerator.generate(metric: metric, spec: parsed, input: input)
    return records(boardId: "", metric: metric, rules: specs, createdAt: 0)
  }

  private static func object(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }
  private static func decode(_ json: String) throws -> Any {
    try JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed)
  }
  private static func settings(_ db: Database, _ boardId: String) throws -> [String: Any] {
    try Dictionary(uniqueKeysWithValues: PersistedBoardSetting.filter(Column("board_id") == boardId).fetchAll(db).map { ($0.key, try decode($0.valueJson)) })
  }
  private static func rows(_ db: Database, _ boardId: String) throws -> [PersistedAlertRule] {
    try PersistedAlertRule.filter(Column("board_id") == boardId).order(Column("created_at")).fetchAll(db)
  }
  private static func presetRows(_ rows: [PersistedAlertRule]) -> [String: PersistedAlertRule] {
    Dictionary(rows.filter { $0.id == rowId($0.controlId) }.map { ($0.controlId, $0) }, uniquingKeysWith: { first, _ in first })
  }

  static func specs(_ db: Database, boardId: String) throws -> [String: String] {
    let presets = presetRows(try rows(db, boardId))
    return Dictionary(uniqueKeysWithValues: metrics.map { ($0, presets[$0]?.spec ?? defaultSpec.encode()) })
  }

  static func expandedRules(_ db: Database, boardId: String, reportFailure: (Error) -> Void) throws -> [PersistedAlertRule] {
    let stored = try rows(db, boardId)
    let riderRules = stored.filter { !isPresetId($0.id) }
    guard let board = try PersistedBoard.fetch(db, id: boardId), board.deletedAt == nil else { return riderRules }
    let presets = presetRows(stored)
    let values = try settings(db, boardId)
    let rawUnits = try PersistedAppSetting.fetchOne(db, key: "distanceUnit")
    let units = validDistanceUnit(try rawUnits.map { try decode($0.valueJson) } as? String) ?? "km"
    let expanded = metrics.flatMap { metric -> [PersistedAlertRule] in
      do {
        let spec = presets[metric].map { AlertPresetSpec.parse($0.spec) ?? AlertPresetSpec(level: "off") } ?? defaultSpec
        let field = spec.option("match") == "on" ? try AlertPresetGenerator.matchField(metric) : nil
        let input = PresetInput(
          topSpeedKmh: (values["topSpeedKmh"] as? NSNumber)?.doubleValue ?? 50,
          hasBatteryConfig: try AlertPresetGenerator.validBattery(values["batteryConfig"]),
          distanceUnit: units,
          configBase: try field.flatMap { try resolveBase(db, boardId, $0) }
        )
        let rules = try AlertPresetGenerator.generate(metric: metric, spec: spec, input: input)
        return records(boardId: boardId, metric: metric, rules: rules, createdAt: presets[metric]?.createdAt ?? 0)
      } catch {
        reportFailure(error)
        return []
      }
    }
    return riderRules + expanded
  }

  func apply(boardId: String, metric: String, level: String?, geiger: String?, match: Bool?) throws {
    try writer.write { db in
      guard Self.metrics.contains(metric),
            [level != nil, geiger != nil, match != nil].filter({ $0 }).count == 1 else { throw InvalidPreset.invalidIntent }
      guard let board = try PersistedBoard.fetch(db, id: boardId), board.deletedAt == nil else { throw InvalidPreset.missingBoard }
      let current = AlertPresetSpec.parse(try Self.specs(db, boardId: boardId)[metric]!) ?? Self.defaultSpec
      var next = current
      if let level {
        guard AlertPresetGenerator.levels.contains(level) else { throw InvalidPreset.invalidIntent }
        next.level = level
      } else if let geiger {
        guard try AlertPresetGenerator.hasGeiger(metric), GeigerLevel(rawValue: geiger) != nil else { throw InvalidPreset.invalidIntent }
        next = current.withOption("geiger", geiger)
      } else {
        guard try AlertPresetGenerator.matchField(metric) != nil else { throw InvalidPreset.invalidIntent }
        next = current.withOption("match", match == true ? "on" : nil)
      }
      if let row = try Self.presetRow(boardId: boardId, metric: metric, spec: next.encode(), createdAt: Int64(Date().timeIntervalSince1970 * 1000)) {
        try row.save(db)
      } else {
        _ = try PersistedAlertRule.deleteOne(db, key: ["board_id": boardId, "id": Self.rowId(metric)])
      }
    }
  }

  static func presetRow(boardId: String, metric: String, spec: String, createdAt: Int64) throws -> PersistedAlertRule? {
    guard metrics.contains(metric), let parsed = AlertPresetSpec.parse(spec) else { throw InvalidPreset.invalidIntent }
    if parsed == defaultSpec { return nil }
    return PersistedAlertRule(
      boardId: boardId, id: rowId(metric), controlId: metric,
      threshold: 0, thresholdMax: nil, enabled: true,
      spec: spec, createdAt: createdAt,
      repeatEverySeconds: nil, thresholdKind: "fixed", configFieldId: nil,
      thresholdOffset: nil, thresholdMaxOffset: nil
    )
  }

  private static func resolveBase(_ db: Database, _ boardId: String, _ field: String) throws -> Double? {
    func values(_ table: String) throws -> [String: Any] {
      let json = try String.fetchOne(db, sql: "SELECT values_json FROM \(table) WHERE board_id = ? ORDER BY captured_at DESC LIMIT 1", arguments: [boardId])
      return try json.map { object(try decode($0)) } ?? [:]
    }
    return try resolveConfigRelativeBase(field, refloat: values("board_config_values"), motor: values("motor_config_values"))
  }

  private static func records(
    boardId: String,
    metric: String,
    rules: [GeneratedPresetRule],
    createdAt: Int64
  ) -> [PersistedAlertRule] {
    rules.enumerated().map { index, rule in
      PersistedAlertRule(
        boardId: boardId,
        id: "\(rowId(metric)):\(index)",
        controlId: metric,
        threshold: rule.point.threshold,
        thresholdMax: rule.point.thresholdMax,
        enabled: true,
        spec: rule.spec,
        createdAt: createdAt,
        repeatEverySeconds: rule.point.repeatEverySeconds,
        thresholdKind: rule.relation == nil ? "fixed" : "config-relative",
        configFieldId: rule.relation?.fieldId,
        thresholdOffset: rule.relation?.offset,
        thresholdMaxOffset: rule.relation?.maxOffset
      )
    }
  }
}
