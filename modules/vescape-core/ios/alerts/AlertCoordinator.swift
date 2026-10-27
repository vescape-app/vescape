import Foundation

/// Bridges the pure alert evaluator with the side-effectful audio player. Each telemetry frame is
/// evaluated against the loaded rules; geiger loops update/stop to track live rule activity, and
/// one-shot alerts play a triple-beep pattern (plus optional TTS message). Returns the fired
/// alert maps so the connection layer can attach them to the telemetry event payload.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertCoordinator.kt
internal final class AlertCoordinator {
  var distanceUnit = "km"
  var temperatureUnit = "celsius"
  private let engine = AlertEngine()
  private let player: AlertAudioPlayer
  private let vibrateSingles: Bool
  private var rules: [AlertRule] = []
  private var activeGeigerRuleIds: Set<String> = []
  func updateBoardConfigValues(_ values: [String: Any]) { engine.updateBoardConfigValues(values) }

  func updateMotorConfigValues(_ values: [String: Any]) { engine.updateMotorConfigValues(values) }

  init(player: AlertAudioPlayer, vibrateSingles: Bool = true) {
    self.player = player
    self.vibrateSingles = vibrateSingles
  }

  func replaceRules(_ value: [AlertRule]) {
    let geigerRuleIds = Set(value.compactMap { $0.thresholdMax == nil ? nil : $0.id })
    let stale = activeGeigerRuleIds.subtracting(geigerRuleIds)
    for ruleId in stale { player.stopGeiger(ruleId: ruleId) }
    activeGeigerRuleIds = activeGeigerRuleIds.intersection(geigerRuleIds).subtracting(stale)
    rules = value
    player.prepare(Specs: value.map(\.spec))
    engine.resetAlertState()
  }

  func evaluate(
    telemetry: RefloatTelemetry,
    batteryPercent: Double?,
    onDiagnostic: @escaping DiagnosticSink
  ) -> [[String: Any?]] {
    let fired = engine.evaluate(rules: rules, telemetry: telemetry, batteryPercent: batteryPercent)
    return deliver(
      fired: fired,
      batteryPercent: batteryPercent,
      batteryVoltage: telemetry.batteryVoltage,
      batteryCurrent: telemetry.batteryCurrent,
      onDiagnostic: onDiagnostic
    )
  }

  /// Isolated alert tests call the same evaluator + feedback path with synthetic metric values.
  func evaluateValues(
    _ values: [String: Double],
    batteryPercent: Double?,
    onDiagnostic: @escaping DiagnosticSink
  ) -> [[String: Any?]] {
    let fired = engine.evaluateValues(rules: rules, values: values, batteryPercent: batteryPercent)
    return deliver(
      fired: fired,
      batteryPercent: batteryPercent,
      batteryVoltage: values["battery"],
      batteryCurrent: nil,
      onDiagnostic: onDiagnostic
    )
  }

  private func deliver(
    fired: [FiredAlert],
    batteryPercent: Double?,
    batteryVoltage: Double?,
    batteryCurrent: Double?,
    onDiagnostic: @escaping DiagnosticSink
  ) -> [[String: Any?]] {

    for alert in fired where alert.controlId == "battery" && alert.rangeDepth == nil {
      onDiagnostic("battery_alert_fired", [
        "rule_id": alert.ruleId,
        "used_ir_compensated_percent": (batteryPercent != nil) as Any,
        "battery_percent": batteryPercent as Any,
        "battery_voltage": batteryVoltage as Any,
        "battery_current": batteryCurrent as Any,
        "threshold": alert.threshold,
        "threshold_max": alert.thresholdMax as Any,
      ])
    }

    let geiger = fired.filter { $0.rangeDepth != nil }
    let ids = Set(geiger.map { $0.ruleId })
    for ruleId in activeGeigerRuleIds.subtracting(ids) {
      player.stopGeiger(ruleId: ruleId)
    }
    activeGeigerRuleIds = ids
    for alert in geiger {
      player.updateGeiger(ruleId: alert.ruleId, spec: alert.spec, rangeDepth: alert.rangeDepth ?? 0)
    }

    let single = fired.filter { $0.rangeDepth == nil }
    if !single.isEmpty {
      // Preset voice rules at Voice level Off play their severity sound only and leave the spoken
      // slot to the rest.
      let mutedPresets = player.presetVoiceEnabled ? [] : single.filter {
        $0.ruleId.hasPrefix(presetRulePrefix) && parseVoiceAlertSound($0.spec) != nil
      }.map(\.ruleId)
      // One spoken announcement per evaluation: the most severe, which sorts first.
      if let alert = single.first(where: {
        $0.thresholdMax == nil && isSpokenSpec($0.spec) && !mutedPresets.contains($0.ruleId)
      }) {
        if let voice = parseVoiceAlertSound(alert.spec) {
          // A repeat speaks where the metric is now, not the threshold it crossed.
          let spoken = alert.controlId == "battery" ? batteryPercent ?? alert.threshold : alert.value
          player.speakVoice(
            voiceAnnouncement(
              voice,
              controlId: alert.controlId,
              reading: spoken,
              percentAvailable: batteryPercent != nil,
              distanceUnit: distanceUnit,
              temperatureUnit: temperatureUnit
            )
          )
        } else if let tts = parseTtsAlertSound(alert.spec) {
          let text = renderAlertMessageTemplate(tts.text, alert: alert, batteryPercent: batteryPercent, onDiagnostic: onDiagnostic, distanceUnit: distanceUnit)
          if !text.isEmpty { player.speakAfterSeverity(tts.severity, text: text) }
        }
      }
      for alert in single where !isSpokenSpec(alert.spec) || mutedPresets.contains(alert.ruleId) {
        let severity = parseVoiceAlertSound(alert.spec)?.severity
        player.playSingle(spec: severity.map { "alert:\($0.rawValue)" } ?? alert.spec)
      }
      if vibrateSingles { player.vibrate(rangeDepth: nil) }
    }

    return fired.map { $0.toMap() }
  }

  func stopAllGeiger() {
    player.stopAllGeiger()
    activeGeigerRuleIds.removeAll(keepingCapacity: true)
  }
}
