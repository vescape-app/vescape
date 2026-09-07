import Foundation

/// Voltage → State-of-Charge estimator for the battery gauge. Interpolates a per-cell discharge
/// curve (preset mode) or a normalized curve (manual mode), with IR-sag correction from the
/// battery current so the SoC doesn't dip under load. Pure once `loadPresets` (or `ensureLoaded`)
/// has run.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/BatterySocEstimator.kt
/// @platform-diff Android is a singleton `object` loaded from an Android asset; iOS is an instance
/// (owned by the coordinator) loaded from a CocoaPods resource bundle. Curve math is identical.
internal final class BatterySocEstimator {
  struct SocPoint { let voltage: Double; let soc: Double }
  private struct NormPoint { let norm: Double; let soc: Double }
  struct CellPreset { let id: String; let socCurve: [SocPoint]; let internalResistanceMilliOhm: Int }

  private static let manualCurve: [NormPoint] = [
    NormPoint(norm: 1.0, soc: 100.0),
    NormPoint(norm: 0.95, soc: 90.0),
    NormPoint(norm: 0.9, soc: 75.0),
    NormPoint(norm: 0.82, soc: 55.0),
    NormPoint(norm: 0.72, soc: 35.0),
    NormPoint(norm: 0.55, soc: 18.0),
    NormPoint(norm: 0.35, soc: 7.0),
    NormPoint(norm: 0.15, soc: 2.0),
    NormPoint(norm: 0.0, soc: 0.0),
  ]

  private static let defaultInternalResistanceMilliOhm = 18

  private var presetById: [String: CellPreset] = [:]
  private var loadAttempted = false
  private let presetLoader: () -> String?

  init(presetLoader: @escaping () -> String? = BatterySocEstimator.bundledPresetsJson) {
    self.presetLoader = presetLoader
  }

  var isLoaded: Bool { !presetById.isEmpty }

  /// Load presets from the bundled `cell-presets.json` once. No-op if already loaded.
  func ensureLoaded() {
    guard presetById.isEmpty, !loadAttempted else { return }
    loadAttempted = true
    guard let json = presetLoader() else {
      UnexpectedNativeError.report(
        operation: "battery_soc_catalog_load", category: "bundled_asset", error: CocoaError(.fileNoSuchFile)
      )
      return
    }
    loadPresets(json)
    if presetById.isEmpty {
      UnexpectedNativeError.report(
        operation: "battery_soc_catalog_parse", category: "bundled_asset", error: CocoaError(.fileReadCorruptFile)
      )
    }
  }

  func loadPresets(_ json: String) {
    loadAttempted = true
    guard
      let data = json.data(using: .utf8),
      // intentional-suppression: catalog owner reports unavailable estimator data
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let curvesObj = root["curves"] as? [String: Any],
      let cellsArr = root["cells"] as? [[String: Any]]
    else { return }

    var curves: [String: [SocPoint]] = [:]
    for (key, value) in curvesObj {
      guard let arr = value as? [[String: Any]] else { continue }
      curves[key] = arr.compactMap { point in
        guard
          let voltage = (point["voltage"] as? NSNumber)?.doubleValue,
          let soc = (point["soc"] as? NSNumber)?.doubleValue
        else { return nil }
        return SocPoint(voltage: voltage, soc: soc)
      }
    }

    var map: [String: CellPreset] = [:]
    for obj in cellsArr {
      guard
        let id = obj["id"] as? String,
        let ir = (obj["internalResistanceMilliOhm"] as? NSNumber)?.intValue,
        let curveId = obj["curveId"] as? String,
        let curve = curves[curveId]
      else { continue }
      map[id] = CellPreset(id: id, socCurve: curve, internalResistanceMilliOhm: ir)
    }
    presetById = map
  }

  func getCellPreset(_ id: String) -> CellPreset? { presetById[id] }

  /// Estimate battery percent (0–100) from pack voltage and the board's battery config, or `nil`
  /// when the config is missing/invalid or a preset curve isn't loaded. `config` is the normalized
  /// Board `batteryConfig` (canonical keys — see `VescapeCoreModule.normalizeBatteryConfig`).
  func estimateBatteryPercent(
    voltageV: Double,
    config: [String: Any]?,
    batteryCurrentA: Double = 0.0
  ) -> Double? {
    guard let config, let mode = config["mode"] as? String else { return nil }

    switch mode {
    case "preset":
      guard
        let cellPresetId = config["cellPresetId"] as? String, !cellPresetId.isEmpty,
        let seriesCount = intValue(config["seriesCount"]), seriesCount >= 1,
        let parallelCount = intValue(config["parallelCount"]), parallelCount >= 1,
        let preset = presetById[cellPresetId]
      else { return nil }
      let rPackOhm = computeRPackOhm(preset.internalResistanceMilliOhm, seriesCount, parallelCount)
      let correctedV = voltageV + batteryCurrentA * rPackOhm
      return interpolateCurve(correctedV / Double(seriesCount), preset.socCurve)
    case "manual":
      guard
        let minVoltage = doubleValue(config["minVoltage"]), minVoltage.isFinite,
        let maxVoltage = doubleValue(config["maxVoltage"]), maxVoltage.isFinite
      else { return nil }
      let estimatedSeries = max(1, Int((maxVoltage / 4.2).rounded()))
      let rPackOhm = computeRPackOhm(Self.defaultInternalResistanceMilliOhm, estimatedSeries, 2)
      let correctedV = voltageV + batteryCurrentA * rPackOhm
      return estimateManualBatteryPercent(correctedV, minVoltage, maxVoltage)
    default:
      return nil
    }
  }

  // MARK: - Curve math

  private func interpolateCurve(_ voltage: Double, _ curve: [SocPoint]) -> Double {
    guard let first = curve.first, let last = curve.last else { return 0.0 }
    if voltage >= first.voltage { return 100.0 }
    if voltage <= last.voltage { return 0.0 }
    for i in 0..<(curve.count - 1) {
      let hi = curve[i]
      let lo = curve[i + 1]
      if voltage <= hi.voltage && voltage >= lo.voltage {
        let span = hi.voltage - lo.voltage
        let t = span > 0.0 ? (voltage - lo.voltage) / span : 0.0
        return lo.soc + t * (hi.soc - lo.soc)
      }
    }
    return 0.0
  }

  private func estimateManualBatteryPercent(
    _ voltageV: Double,
    _ minVoltage: Double,
    _ maxVoltage: Double
  ) -> Double? {
    if maxVoltage <= minVoltage { return nil }
    let norm = (voltageV - minVoltage) / (maxVoltage - minVoltage)
    if norm >= 1.0 { return 100.0 }
    if norm <= 0.0 { return 0.0 }
    let curve = Self.manualCurve
    for i in 0..<(curve.count - 1) {
      let hi = curve[i]
      let lo = curve[i + 1]
      if norm <= hi.norm && norm >= lo.norm {
        let span = hi.norm - lo.norm
        let t = span > 0.0 ? (norm - lo.norm) / span : 0.0
        return lo.soc + t * (hi.soc - lo.soc)
      }
    }
    return 0.0
  }

  private func computeRPackOhm(_ resistanceMilliOhm: Int, _ seriesCount: Int, _ parallelCount: Int) -> Double {
    Double(resistanceMilliOhm) / 1000.0 * Double(seriesCount) / Double(parallelCount)
  }

  private func intValue(_ raw: Any?) -> Int? {
    if let value = raw as? Int { return value }
    if let value = raw as? NSNumber { return value.intValue }
    return nil
  }

  private func doubleValue(_ raw: Any?) -> Double? {
    if let value = raw as? Double { return value }
    if let value = raw as? NSNumber { return value.doubleValue }
    return nil
  }

  /// Locate `cell-presets.json`, whether it landed as a CocoaPods resource bundle (`VescapeCoreAssets`)
  /// or directly in the module bundle.
  private static func bundledPresetsJson() -> String? {
    let moduleBundle = Bundle(for: BatterySocEstimator.self)
    let candidates: [URL?] = [
      moduleBundle.url(forResource: "cell-presets", withExtension: "json"),
      moduleBundle.url(forResource: "VescapeCoreAssets", withExtension: "bundle").flatMap {
        Bundle(url: $0)?.url(forResource: "cell-presets", withExtension: "json")
      },
    ]
    for case let url? in candidates {
      // intentional-suppression: catalog owner reports unavailable estimator data
      if let text = try? String(contentsOf: url, encoding: .utf8) { return text }
    }
    return nil
  }
}
