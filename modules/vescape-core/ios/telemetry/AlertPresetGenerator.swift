import Foundation

struct PresetPoint: Decodable {
  let threshold: Double
  var thresholdMax: Double? = nil
  var repeatEverySeconds: Int64? = nil
}
struct PresetRelation {
  let fieldId: String
  let offset: Double
  let maxOffset: Double?
}
struct GeneratedPresetRule {
  let point: PresetPoint
  let spec: String
  var relation: PresetRelation? = nil
}
struct PresetInput {
  var topSpeedKmh: Double = 50
  var hasBatteryConfig = false
  var speedUnitSystem = "metric"
  /// Base of the metric's config-relative points; read only when its spec has `match=on`.
  var configBase: Double? = nil
}

private struct PresetDefinition: Decodable {
  enum Family: String, Decodable { case geiger, discrete }
  struct Range: Decodable {
    let start: Double
    let ceiling: Double
  }
  let spec: String?
  let fieldId: String?
  let scaledByTopSpeed: Bool
  let requiresBatteryConfig: Bool
  let levels: [String: [PresetPoint]]

  enum CodingKeys: String, CodingKey { case family, spec, fieldId, scaledByTopSpeed, requiresBatteryConfig, levels }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    spec = try values.decodeIfPresent(String.self, forKey: .spec)
    fieldId = try values.decodeIfPresent(String.self, forKey: .fieldId)
    scaledByTopSpeed = try values.decodeIfPresent(Bool.self, forKey: .scaledByTopSpeed) ?? false
    requiresBatteryConfig = try values.decodeIfPresent(Bool.self, forKey: .requiresBatteryConfig) ?? false
    let family = try values.decode(Family.self, forKey: .family)
    guard !scaledByTopSpeed || family == .geiger else { throw AlertPresetGenerator.InvalidPreset.invalidDefinition }
    switch family {
    case .geiger:
      let ranges = try values.decode([String: Range].self, forKey: .levels)
      levels = ranges.mapValues { [PresetPoint(threshold: $0.start, thresholdMax: $0.ceiling)] }
    case .discrete:
      levels = try values.decode([String: [PresetPoint]].self, forKey: .levels)
    }
    for level in AlertPresetGenerator.activeLevels {
      guard let points = levels[level], !points.isEmpty else { throw AlertPresetGenerator.InvalidPreset.invalidDefinition }
      for point in points {
        guard point.threshold.isFinite, point.thresholdMax?.isFinite != false,
              point.repeatEverySeconds.map({ $0 > 0 }) != false else { throw AlertPresetGenerator.InvalidPreset.invalidDefinition }
      }
    }
  }
}

/// Typed catalog and pure expansion of a preset spec, shared by saved rows and unsaved wizard previews.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AlertPresetGenerator.kt
final class AlertPresetGenerator {
  static let metrics = ["speed", "duty", "motor-temp", "controller-temp", "battery"]
  static let activeLevels = ["safe", "normal", "minimal"]
  static let levels = activeLevels + ["off"]
  private static let kmhPerMph = 1.609344
  enum InvalidPreset: Error { case invalidIntent, invalidDefinition, missingResource }
  private struct Catalog: Decodable {
    let metrics: [String: PresetDefinition]
    let match: [String: PresetDefinition]
  }
  private struct CellCatalog: Decodable {
    struct Cell: Decodable { let id: String }
    let cells: [Cell]
  }
  private static func resource<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let module = Bundle(for: AlertPresetGenerator.self)
    let bundle = module.url(forResource: "VescapeCoreAssets", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? module
    #endif
    guard let url = bundle.url(forResource: name, withExtension: "json") else { throw InvalidPreset.missingResource }
    return try JSONDecoder().decode(type, from: Data(contentsOf: url))
  }
  private static let catalog = Result { () throws -> Catalog in
    let value = try resource("alert-preset-definitions", as: Catalog.self)
    guard metrics.allSatisfy({ value.metrics[$0]?.spec != nil }),
          value.match.allSatisfy({ metrics.contains($0.key) && $0.value.fieldId != nil }) else { throw InvalidPreset.invalidDefinition }
    return value
  }
  private static let cellIds = Result { Set(try resource("cell-presets", as: CellCatalog.self).cells.map(\.id)) }

  static func matchField(_ metric: String) throws -> String? { try catalog.get().match[metric]?.fieldId }

  static func validBattery(_ raw: Any?) throws -> Bool {
    guard let config = raw as? [String: Any] else { return false }
    switch config["mode"] as? String {
    case "manual":
      guard let minimum = config["minVoltage"] as? Double, let maximum = config["maxVoltage"] as? Double else { return false }
      return maximum > minimum
    case "preset":
      guard let id = config["cellPresetId"] as? String else { return false }
      return try cellIds.get().contains(id)
    default: return false
    }
  }

  /// True when `metric`'s definition ticks, so its spec may carry a `geiger=` option.
  static func hasGeiger(_ metric: String) throws -> Bool {
    try catalog.get().metrics[metric]?.spec?.hasPrefix("geiger:") == true
  }

  /// The rules `spec` stands for. `off`, an unknown level (from a newer app), or a guard failure
  /// expands to none. `match=on` gives config-relative points; `geiger=` replaces the tick level.
  static func generate(metric: String, spec: AlertPresetSpec, input: PresetInput) throws -> [GeneratedPresetRule] {
    guard metrics.contains(metric), ["metric", "imperial"].contains(input.speedUnitSystem) else { throw InvalidPreset.invalidIntent }
    guard activeLevels.contains(spec.level) else { return [] }
    let catalog = try catalog.get()
    guard let definition = catalog.metrics[metric], let defaultSound = definition.spec else { throw InvalidPreset.invalidDefinition }
    let geiger = spec.option("geiger").flatMap(GeigerLevel.init(rawValue:))
    let ruleSpec = geiger != nil && defaultSound.hasPrefix("geiger:") ? "geiger:\(geiger!.rawValue)" : defaultSound
    if spec.option("match") == "on", let match = catalog.match[metric] {
      return relativeRules(ruleSpec, match: match, level: spec.level, base: input.configBase)
    }
    if definition.requiresBatteryConfig && !input.hasBatteryConfig { return [] }
    return fixedRules(definition, spec: ruleSpec, level: spec.level, input: input)
  }

  private static func fixedRules(_ definition: PresetDefinition, spec: String, level: String, input: PresetInput) -> [GeneratedPresetRule] {
    let points = definition.levels[level]!
    return points.enumerated().map { index, point in
      let threshold = definition.scaledByTopSpeed ? speedRange(point, input: input) : point
      return GeneratedPresetRule(point: threshold, spec: pointSpec(spec, index: index, count: points.count))
    }
  }

  private static func relativeRules(
    _ spec: String,
    match: PresetDefinition,
    level: String,
    base: Double?
  ) -> [GeneratedPresetRule] {
    let offsets = match.levels[level]!
    return offsets.enumerated().map { index, offset in
      let relation = PresetRelation(fieldId: match.fieldId!, offset: offset.threshold, maxOffset: offset.thresholdMax)
      let point: PresetPoint
      if let base {
        point = PresetPoint(
          threshold: roundTenth(base + offset.threshold),
          thresholdMax: offset.thresholdMax.map { roundTenth(base + $0) },
          repeatEverySeconds: offset.repeatEverySeconds
        )
      } else {
        // No anchor yet: keep the relationship, but no firing threshold.
        point = PresetPoint(threshold: 0, repeatEverySeconds: offset.repeatEverySeconds)
      }
      return GeneratedPresetRule(
        point: point,
        spec: pointSpec(spec, index: index, count: offsets.count),
        relation: relation
      )
    }
  }

  /// Sound of a ladder's point `index` of `count`. A `voice:<key>` definition speaks each point with a
  /// severity by rank: the last (most severe) point `critical`, the first `info`, the rest `warning`;
  /// a one-point ladder is `critical`.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/AlertPresetGenerator.kt `pointSpec`
  private static func pointSpec(_ spec: String, index: Int, count: Int) -> String {
    guard spec.hasPrefix("voice:") else { return spec }
    let severity = index == count - 1 ? "critical" : index == 0 ? "info" : "warning"
    return "voice(\(severity)):\(spec.dropFirst("voice:".count))"
  }

  private static func speedRange(_ point: PresetPoint, input: PresetInput) -> PresetPoint {
    let top = input.topSpeedKmh.isFinite && input.topSpeedKmh > 0 ? input.topSpeedKmh : 50
    let unitScale = input.speedUnitSystem == "imperial" ? kmhPerMph : 1.0
    let ceiling = max(1, min(floor(top / unitScale), floor(point.thresholdMax! * top / unitScale + 0.5)))
    let start = max(0, min(ceiling - 1, floor(point.threshold * top / unitScale + 0.5)))
    return PresetPoint(threshold: start * unitScale, thresholdMax: ceiling * unitScale)
  }

  private static func roundTenth(_ value: Double) -> Double { floor(value * 10 + 0.5) / 10 }
}
