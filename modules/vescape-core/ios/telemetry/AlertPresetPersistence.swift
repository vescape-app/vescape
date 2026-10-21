import Foundation
import GRDB

/// An Alert Preset is one `alerts` row per Board and metric, id `preset:<metric>`, whose spec is
/// `preset(<level>)[:key=value,…]`. Native expands the rows whenever it loads rules; the expanded
/// rules are never stored.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AlertPresetPersistence.kt
final class AlertPresetPersistence {
  let writer: any DatabaseWriter
  init(writer: any DatabaseWriter) { self.writer = writer }
  static let metrics = AlertPresetGenerator.metrics
  /// A metric without a preset row: the app default.
  private static let defaultSpec = AlertPresetSpec(level: "normal")
  enum InvalidPreset: Error { case invalidIntent, missingBoard }

  private static func rowId(_ metric: String) -> String { presetRulePrefix + metric }

  /// True for a stored preset row or an expanded preset rule: neither is a rider's rule.
  static func isPresetId(_ id: String) -> Bool { id.hasPrefix(presetRulePrefix) }

  /// Expand an unsaved draft `spec` for the add-board wizard, without touching the database.
  static func preview(
    metric: String,
    spec: String,
    topSpeedKmh: Double?,
    hasBatteryConfig: Bool,
    speedUnitSystem: String
  ) throws -> [PersistedAlertRule] {
    guard let parsed = AlertPresetSpec.parse(spec) else { throw InvalidPreset.invalidIntent }
    let input = PresetInput(topSpeedKmh: topSpeedKmh ?? 50, hasBatteryConfig: hasBatteryConfig, speedUnitSystem: speedUnitSystem)
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

  /// Each metric's stored spec, or the app default when it has no row.
  static func specs(_ db: Database, boardId: String) throws -> [String: String] {
    let presets = presetRows(try rows(db, boardId))
    return Dictionary(uniqueKeysWithValues: metrics.map { ($0, presets[$0]?.spec ?? defaultSpec.encode()) })
  }

  /// The Board's rules as native evaluates them and JS reads them: rider rules plus expanded presets.
  /// A missing or tombstoned Board expands nothing. A metric that fails to expand is passed to
  /// `reportFailure` and skipped, so the rider rules and the other metrics still load.
  static func expandedRules(_ db: Database, boardId: String, reportFailure: (Error) -> Void) throws -> [PersistedAlertRule] {
    let stored = try rows(db, boardId)
    let riderRules = stored.filter { !isPresetId($0.id) }
    guard let board = try PersistedBoard.fetchOne(db, key: boardId), board.deletedAt == nil else { return riderRules }
    let presets = presetRows(stored)
    let values = try settings(db, boardId)
    let rawUnits = try PersistedAppSetting.fetchOne(db, key: "unitSystem")
    let units = validUnitSystem(try rawUnits.map { try decode($0.valueJson) } as? String) ?? "metric"
    let expanded = metrics.flatMap { metric -> [PersistedAlertRule] in
      do {
        // A row this app cannot read expands to nothing rather than the default.
        let spec = presets[metric].map { AlertPresetSpec.parse($0.spec) ?? AlertPresetSpec(level: "off") } ?? defaultSpec
        let field = spec.option("match") == "on" ? try AlertPresetGenerator.matchField(metric) : nil
        let input = PresetInput(
          topSpeedKmh: (values["topSpeedKmh"] as? NSNumber)?.doubleValue ?? 50,
          hasBatteryConfig: try AlertPresetGenerator.validBattery(values["batteryConfig"]),
          speedUnitSystem: units,
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

  /// Rewrite `metric`'s preset row with exactly one of a new level, geiger level, or match choice.
  func apply(boardId: String, metric: String, level: String?, geiger: String?, match: Bool?) throws {
    try writer.write { db in
      guard Self.metrics.contains(metric),
            [level != nil, geiger != nil, match != nil].filter({ $0 }).count == 1 else { throw InvalidPreset.invalidIntent }
      guard let board = try PersistedBoard.fetchOne(db, key: boardId), board.deletedAt == nil else { throw InvalidPreset.missingBoard }
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
      try Self.presetRow(boardId: boardId, metric: metric, spec: next.encode(), createdAt: Int64(Date().timeIntervalSince1970 * 1000)).save(db)
    }
  }

  /// `metric`'s stored preset row holding `spec`; rejects an unknown metric or a non-preset spec.
  static func presetRow(boardId: String, metric: String, spec: String, createdAt: Int64) throws -> PersistedAlertRule {
    guard metrics.contains(metric), AlertPresetSpec.parse(spec) != nil else { throw InvalidPreset.invalidIntent }
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
