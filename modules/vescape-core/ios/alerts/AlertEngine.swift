import Foundation

/// Floor on an Alert Rule's repeat cadence, in seconds.
/// @parity /modules/vescape-core/src/index.ts `ALERT_REPEAT_MIN_SECONDS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_REPEAT_MIN_SECONDS`
internal let alertRepeatMinSeconds: Int64 = 3

/// Inclusive bounds on an Alert Rule's beep count.
/// @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_RANGE`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_BEEP_COUNT_RANGE`
internal let alertBeepCountRange = 1...5

/// Beeps per announcement when nothing says otherwise.
/// @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_DEFAULT`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `ALERT_BEEP_COUNT_DEFAULT`
internal let alertBeepCountDefault = 3

/// Gap between beeps of one announcement — tight enough that a burst reads as a single signal.
internal let alertBeepSpacingMs: Double = 200

/// Clamp a repeat cadence coming from JS. Anything non-positive means one-shot; everything else is
/// floored, so no rule written by any path can announce fast enough to become noise.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `normalizedAlertRepeatSeconds`
internal func normalizedAlertRepeatSeconds(_ raw: Double?) -> Int64? {
  guard let raw, raw.isFinite, raw > 0 else { return nil }
  return max(alertRepeatMinSeconds, Int64(raw.rounded()))
}

/// Clamp a beep count coming from JS; absent or out of range falls back to the default.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `normalizedAlertBeepCount`
internal func normalizedAlertBeepCount(_ raw: Int?) -> Int {
  guard let raw else { return alertBeepCountDefault }
  return min(max(raw, alertBeepCountRange.lowerBound), alertBeepCountRange.upperBound)
}

/// Alert rule persisted in GRDB (`alerts` table). Mirrors Android `AlertRuleEntity`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt
internal struct AlertRule {
  let boardId: String
  let id: String
  let controlId: String
  let threshold: Double
  let thresholdMax: Double?
  var thresholdKind: String = "fixed"
  var configFieldId: String? = nil
  var thresholdOffset: Double? = nil
  var thresholdMaxOffset: Double? = nil
  let enabled: Bool
  let soundType: String
  let createdAt: Int64
  /// Repeat cadence in seconds for a single-threshold rule; nil is one-shot. Ignored for range
  /// rules. Mirrors TS `AlertRule.repeatEverySeconds`.
  var repeatEverySeconds: Int64? = nil
  /// Sound repeats per announcement. Mirrors TS `AlertRule.beepCount`.
  var beepCount: Int = alertBeepCountDefault
  /// Free-text provenance tag mirroring TS `AlertRule.source`: `manual` (or nil) or `preset`.
  /// JS authors and regenerates preset rules; native only persists the string.
  let source: String?
}

/// Adds Legal Mode's per-Board speed warning to in-memory rules. No Alert Rule row is materialized.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `withLegalModeOverlay`
internal func withLegalModeOverlay(
  _ rules: [AlertRule],
  boardId: String,
  enabled: Bool,
  warningSpeedKmh: Double?,
  limitSpeedKmh: Double?
) -> [AlertRule] {
  guard
    enabled,
    let warningSpeedKmh,
    let limitSpeedKmh,
    warningSpeedKmh > 0,
    limitSpeedKmh > warningSpeedKmh
  else { return rules }

  return rules + [
    AlertRule(
      boardId: boardId,
      id: "native:legal-mode:speed",
      controlId: "speed",
      threshold: warningSpeedKmh,
      thresholdMax: limitSpeedKmh,
      thresholdKind: "fixed", configFieldId: nil, thresholdOffset: nil, thresholdMaxOffset: nil,
      enabled: true,
      soundType: "preset:tick",
      createdAt: 0,
      source: nil
    ),
  ]
}

/// One fired alert surfaced to JS through the telemetry event payload.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `FiredAlert`
internal struct FiredAlert {
  let ruleId: String
  let controlId: String
  let value: Double
  let threshold: Double
  let thresholdMax: Double?
  let soundType: String
  let rangeDepth: Double?
  let beepCount: Int
  let firedAt: Int64

  func toMap() -> [String: Any?] {
    [
      "ruleId": ruleId,
      "controlId": controlId,
      "value": value,
      "threshold": threshold,
      "thresholdMax": thresholdMax,
      "soundType": soundType,
      "rangeDepth": rangeDepth,
      "beepCount": beepCount,
      "firedAt": firedAt,
    ]
  }
}

/// Per-control unit / decimal / direction definition for alert value extraction and message
/// template rendering. Mirrors Android `telemetryMetricByControlId`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryMetrics.kt
internal struct TelemetryMetricDef {
  let controlId: String
  let unit: String
  let decimals: Int
  let alertAbove: Bool
  /// How far back past its threshold, in this metric's own unit, a fired single-threshold Alert
  /// Rule must travel before it can announce again.
  let alertRearmMargin: Double

  func formatValue(_ value: Double) -> String {
    String(format: "%.\(decimals)f", value)
  }
}

internal let telemetryMetricDefs: [TelemetryMetricDef] = [
  .init(controlId: "speed", unit: "km/h", decimals: 0, alertAbove: true, alertRearmMargin: 3.0),
  .init(controlId: "battery", unit: "V", decimals: 1, alertAbove: false, alertRearmMargin: 10.0),
  .init(controlId: "duty", unit: "%", decimals: 0, alertAbove: true, alertRearmMargin: 5.0),
  .init(controlId: "motor-temp", unit: "°C", decimals: 0, alertAbove: true, alertRearmMargin: 3.0),
  .init(controlId: "motor-current", unit: "A", decimals: 0, alertAbove: true, alertRearmMargin: 5.0),
  .init(controlId: "controller-temp", unit: "°C", decimals: 0, alertAbove: true, alertRearmMargin: 3.0),
  .init(controlId: "batt-current", unit: "A", decimals: 0, alertAbove: true, alertRearmMargin: 5.0),
  .init(controlId: "imu", unit: "°", decimals: 1, alertAbove: true, alertRearmMargin: 2.0),
]

internal let telemetryMetricByControlId: [String: TelemetryMetricDef] = Dictionary(
  uniqueKeysWithValues: telemetryMetricDefs.map { ($0.controlId, $0) }
)

internal func alertControlUnit(_ controlId: String) -> String {
  telemetryMetricByControlId[controlId]?.unit ?? ""
}

internal func formatAlertValue(_ value: Double, _ controlId: String) -> String {
  telemetryMetricByControlId[controlId]?.formatValue(value) ?? String(format: "%.0f", value)
}

internal typealias DiagnosticSink = (String, [String: Any?]) -> Void

private func collectUnknownPlaceholders(in text: String) -> [String] {
  var results: [String] = []
  var current = ""
  var inside = false
  for ch in text {
    if ch == "{" {
      inside = true
      current = "{"
    } else if inside {
      current.append(ch)
      if ch == "}" {
        if !results.contains(current) { results.append(current) }
        inside = false
        current = ""
      }
    }
  }
  return results
}

private func stripPlaceholders(in text: String) -> String {
  var result = ""
  var skip = false
  for ch in text {
    if ch == "{" { skip = true; continue }
    if skip {
      if ch == "}" { skip = false }
      continue
    }
    result.append(ch)
  }
  return result
}

/// Render an Alert Message Template against a fired alert. Mirrors Android
/// `renderAlertMessageTemplate`; reports unavailable/unknown placeholders through the diagnostic
/// sink so missing values surface in the diagnostic stream instead of silently truncating text.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `renderAlertMessageTemplate`
internal func renderAlertMessageTemplate(
  _ template: String,
  alert: FiredAlert,
  batteryPercent: Double?,
  onDiagnostic: DiagnosticSink? = nil
) -> String {
  let isBattery = alert.controlId == "battery"
  var text = template
  text = text.replacingOccurrences(
    of: "{value}",
    with: formatAlertValue(alert.value, alert.controlId)
  )
  text = text.replacingOccurrences(
    of: "{threshold}",
    with: formatAlertValue(alert.threshold, alert.controlId)
  )
  text = text.replacingOccurrences(of: "{unit}", with: alertControlUnit(alert.controlId))
  if isBattery {
    text = text.replacingOccurrences(
      of: "{voltage}",
      with: formatAlertValue(alert.value, alert.controlId)
    )
    if let batteryPercent {
      text = text.replacingOccurrences(of: "{percent}", with: String(format: "%.0f", batteryPercent))
    } else if text.contains("{percent}") {
      onDiagnostic?("alert_template_placeholder_unavailable", [
        "placeholder": "{percent}",
        "rule_id": alert.ruleId,
        "control_id": alert.controlId,
      ])
      text = text.replacingOccurrences(of: "{percent}", with: "")
    }
  } else {
    for placeholder in ["{voltage}", "{percent}"] {
      if text.contains(placeholder) {
        onDiagnostic?("alert_template_placeholder_unavailable", [
          "placeholder": placeholder,
          "rule_id": alert.ruleId,
          "control_id": alert.controlId,
        ])
        text = text.replacingOccurrences(of: placeholder, with: "")
      }
    }
  }
  if text.contains("{") {
    let unknowns = collectUnknownPlaceholders(in: text)
    if !unknowns.isEmpty {
      onDiagnostic?("alert_template_unknown_placeholder", [
        "placeholders": unknowns.joined(separator: ","),
        "rule_id": alert.ruleId,
      ])
      text = stripPlaceholders(in: text)
    }
  }
  return text.trimmingCharacters(in: .whitespaces)
}

private func alertEngineNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

/// Pure alert evaluator. No audio, no side effects. Mirrors Android `AlertEngine`.
///
/// - Parameter now: Wall clock in ms. Injected so repeat cadence is testable without sleeping.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `AlertEngine`
internal final class AlertEngine {
  private let now: () -> Int64

  init(now: @escaping () -> Int64 = { alertEngineNowMs() }) {
    self.now = now
  }

  private var lastFiredAt: [String: Int64] = [:]
  private var armedState: [String: Bool] = [:]
  private var configValues: [String: Any] = [:]
  private var motorConfigValues: [String: Any] = [:]

  func updateBoardConfigValues(_ values: [String: Any]) { configValues = values }

  /// VESC motor config (MCCONF), the other half of what a config-relative rule may anchor to.
  func updateMotorConfigValues(_ values: [String: Any]) { motorConfigValues = values }


  /// Forget every latch and repeat clock. Called when a new Board Session starts.
  func resetAlertState() {
    lastFiredAt.removeAll(keepingCapacity: true)
    armedState.removeAll(keepingCapacity: true)
  }

  func evaluate(
    rules: [AlertRule],
    telemetry t: RefloatTelemetry,
    batteryPercent: Double? = nil
  ) -> [FiredAlert] {
    evaluateRules(rules: rules, batteryPercent: batteryPercent) { self.extractAlertValue($0, t) }
  }

  /// Evaluate already-normalized metric values. Production telemetry and the UI alert test both
  /// enter the same stateful arm/re-arm path; callers isolate state by owning separate
  /// `AlertEngine` instances.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `evaluateValues`
  func evaluateValues(
    rules: [AlertRule],
    values: [String: Double],
    batteryPercent: Double? = nil
  ) -> [FiredAlert] {
    evaluateRules(rules: rules, batteryPercent: batteryPercent) { values[$0] }
  }

  private func evaluateRules(
    rules: [AlertRule],
    batteryPercent: Double?,
    valueFor: (String) -> Double?
  ) -> [FiredAlert] {
    guard !rules.isEmpty else { return [] }
    let now = now()
    var fired: [FiredAlert] = []

    for rule in rules {
      guard let effective = effectiveThresholds(rule) else { continue }
      guard let value = valueFor(rule.controlId) else { continue }
      let compareValue = (rule.controlId == "battery" && batteryPercent != nil) ? batteryPercent! : value
      let aboveDir = alertDirectionIsAbove(rule.controlId)
      let triggered = aboveDir ? compareValue >= effective.0 : compareValue <= effective.0

      if let ceiling = effective.1, aboveDir ? ceiling > effective.0 : ceiling < effective.0 {
        if !triggered { continue }
        fired.append(firedAlert(
          rule,
          value: value,
          rangeDepth: alertRangeDepth(compareValue, threshold: effective.0, thresholdMax: ceiling, aboveDir: aboveDir),
          now: now, effective: effective
        ))
        continue
      }

      // Single-threshold rule: announce on crossing, then stay latched until the metric travels
      // back past the threshold by this metric's re-arm margin.
      let armed = armedState[rule.id] ?? true
      if !triggered {
        if !armed && hasRearmed(compareValue, rule: rule, effectiveThreshold: effective.0, aboveDir: aboveDir) {
          armedState[rule.id] = true
          lastFiredAt.removeValue(forKey: rule.id)
        }
        continue
      }
      if !armed {
        guard let repeatSeconds = rule.repeatEverySeconds else { continue }
        if now - (lastFiredAt[rule.id] ?? 0) < repeatSeconds * 1_000 { continue }
      }
      armedState[rule.id] = false
      lastFiredAt[rule.id] = now
      fired.append(firedAlert(rule, value: value, rangeDepth: nil, now: now, effective: effective))
    }

    let sorted = fired.sorted { a, b in
      let aDepth = a.rangeDepth != nil
      let bDepth = b.rangeDepth != nil
      if aDepth != bDepth { return aDepth && !bDepth }
      let aAbove = alertDirectionIsAbove(a.controlId)
      let bAbove = alertDirectionIsAbove(b.controlId)
      let aKey = aAbove ? a.threshold : -a.threshold
      let bKey = bAbove ? b.threshold : -b.threshold
      return aKey > bKey
    }
    return coalesceByControl(sorted)
  }

  private func effectiveThresholds(_ rule: AlertRule) -> (Double, Double?)? {
    guard rule.thresholdKind == "config-relative" else { return (rule.threshold, rule.thresholdMax) }
    guard
      let base = resolveConfigRelativeBase(rule.configFieldId, refloat: configValues, motor: motorConfigValues),
      let offset = rule.thresholdOffset
    else { return nil }
    return (base + offset, rule.thresholdMaxOffset.map { base + $0 })
  }

  /// Keep one single-threshold announcement per metric — the most severe, which the caller has
  /// already sorted first. A fast climb crosses several rungs in one evaluation; the rider wants
  /// the worst news, not a stutter of speech cut off mid-word. The dropped rules stay latched, so
  /// they are spent rather than pending.
  ///
  /// Range rules pass through untouched: their feedback is a continuous loop keyed by rule id,
  /// not an announcement.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `coalesceByControl`
  private func coalesceByControl(_ sorted: [FiredAlert]) -> [FiredAlert] {
    var announced = Set<String>()
    return sorted.filter { alert in
      alert.rangeDepth != nil || announced.insert(alert.controlId).inserted
    }
  }

  private func firedAlert(_ rule: AlertRule, value: Double, rangeDepth: Double?, now: Int64, effective: (Double, Double?)? = nil) -> FiredAlert {
    let thresholds = effective ?? (rule.threshold, rule.thresholdMax)
    return FiredAlert(
      ruleId: rule.id,
      controlId: rule.controlId,
      value: value,
      threshold: thresholds.0,
      thresholdMax: thresholds.1,
      soundType: rule.soundType,
      rangeDepth: rangeDepth,
      beepCount: rule.beepCount,
      firedAt: now
    )
  }

  /// True once a fired rule's metric has travelled back past its effective threshold by the re-arm margin.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertEngine.kt `hasRearmed`
  private func hasRearmed(_ compareValue: Double, rule: AlertRule, effectiveThreshold: Double, aboveDir: Bool) -> Bool {
    let margin = alertRearmMargin(rule.controlId, effectiveThreshold)
    return aboveDir ? compareValue < effectiveThreshold - margin : compareValue > effectiveThreshold + margin
  }

  private func alertRearmMargin(_ controlId: String, _ threshold: Double) -> Double {
    // Controls with no metric definition (footpad) get a relative margin rather than none: zero
    // would let a value dithering on the threshold announce on every telemetry tick.
    telemetryMetricByControlId[controlId]?.alertRearmMargin ?? (abs(threshold) * 0.02)
  }

  private func isRangeRule(_ rule: AlertRule, aboveDir: Bool) -> Bool {
    guard let max = rule.thresholdMax else { return false }
    return aboveDir ? max > rule.threshold : max < rule.threshold
  }

  private func alertDirectionIsAbove(_ controlId: String) -> Bool {
    telemetryMetricByControlId[controlId]?.alertAbove ?? true
  }

  private func alertRangeDepth(
    _ value: Double,
    threshold: Double,
    thresholdMax: Double?,
    aboveDir: Bool
  ) -> Double? {
    guard let thresholdMax, thresholdMax != threshold else { return nil }
    let span = aboveDir ? (thresholdMax - threshold) : (threshold - thresholdMax)
    guard span > 0 else { return nil }
    let depth = aboveDir ? (value - threshold) : (threshold - value)
    return min(max(depth / span, 0.0), 1.0)
  }

  private func extractAlertValue(_ controlId: String, _ t: RefloatTelemetry) -> Double? {
    switch controlId {
    case "speed": return abs(t.speed)
    case "battery": return t.batteryVoltage
    case "duty": return abs(t.dutyCycle) * 100.0
    case "motor-temp": return t.tempMotor.flatMap { $0 > 0 ? $0 : nil }
    case "motor-current": return t.motorCurrent
    case "controller-temp": return t.tempMosfet
    case "batt-current": return t.batteryCurrent
    case "imu": return t.pitch
    case "footpad": return t.adc1
    default: return nil
    }
  }

}
