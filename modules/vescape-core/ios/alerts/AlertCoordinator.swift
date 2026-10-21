import Foundation

/// Id prefix of generated preset rules (`preset:<metric>:<index>`), the rules Voice level applies to.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertCoordinator.kt `PRESET_RULE_PREFIX`
internal let presetRulePrefix = "preset:"

/// Packs one preset pins (#583), from the board's `alertPresetSound` setting; nil follows the
/// app-wide choice. Resolution per slot: My sound override > pinned pack > app-wide.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertCoordinator.kt `PresetSoundPin`
internal struct PresetSoundPin: Equatable {
  var effects: String?
  var voice: String?

  /// Pins per preset metric in a decoded `alertPresetSound` setting; unknown pack ids follow the default.
  static func from(_ raw: Any?) -> [String: PresetSoundPin] {
    var pins: [String: PresetSoundPin] = [:]
    for (metric, value) in raw as? [String: Any] ?? [:] {
      guard let sound = value as? [String: Any] else { continue }
      let pin = PresetSoundPin(
        effects: (sound["effects"] as? String).flatMap { effectsPackIds.contains($0) ? $0 : nil },
        voice: (sound["voice"] as? String).flatMap { voicePackIds.contains($0) ? $0 : nil }
      )
      if pin != PresetSoundPin() { pins[metric] = pin }
    }
    return pins
  }
}

/// Bridges the pure alert evaluator with the side-effectful audio player. Each telemetry frame is
/// evaluated against the loaded rules; geiger loops update/stop to track live rule activity, and
/// one-shot alerts play a triple-beep pattern (plus optional TTS message). Returns the fired
/// alert maps so the connection layer can attach them to the telemetry event payload.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertCoordinator.kt
internal final class AlertCoordinator {
  var unitSystem = "metric"
  private let engine = AlertEngine()
  private let player: AlertAudioPlayer
  private let vibrateSingles: Bool
  private var rules: [AlertRule] = []
  private var pins: [String: PresetSoundPin] = [:]
  private var activeGeigerRuleIds: Set<String> = []
  func updateBoardConfigValues(_ values: [String: Any]) { engine.updateBoardConfigValues(values) }

  func updateMotorConfigValues(_ values: [String: Any]) { engine.updateMotorConfigValues(values) }

  init(player: AlertAudioPlayer, vibrateSingles: Bool = true) {
    self.player = player
    self.vibrateSingles = vibrateSingles
  }

  func replaceRules(_ value: [AlertRule], presetPins: [String: PresetSoundPin] = [:]) {
    let geigerRuleIds = Set(value.compactMap { $0.thresholdMax == nil ? nil : $0.id })
    for ruleId in activeGeigerRuleIds.subtracting(geigerRuleIds) {
      player.stopGeiger(ruleId: ruleId)
    }
    activeGeigerRuleIds.formIntersection(geigerRuleIds)
    rules = value
    pins = presetPins
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
      player.updateGeiger(ruleId: alert.ruleId, soundType: alert.soundType, rangeDepth: alert.rangeDepth ?? 0, pin: pin(alert))
    }

    let single = fired.filter { $0.rangeDepth == nil }
    if !single.isEmpty {
      // Preset voice rules at Voice level Off play their severity sound only and leave the spoken
      // slot to the rest.
      let mutedPresets = player.presetVoiceEnabled ? [] : single.filter {
        $0.ruleId.hasPrefix(presetRulePrefix) && parseVoiceAlertSound($0.soundType) != nil
      }.map(\.ruleId)
      // One spoken announcement per evaluation: the most severe, which sorts first.
      if let alert = single.first(where: {
        $0.thresholdMax == nil && isSpokenSoundType($0.soundType) && !mutedPresets.contains($0.ruleId)
      }) {
        if let voice = parseVoiceAlertSound(alert.soundType) {
          player.speakVoice(
            voiceAnnouncement(
              voice,
              controlId: alert.controlId,
              threshold: alert.threshold,
              percentAvailable: batteryPercent != nil,
              unitSystem: unitSystem
            ),
            pin: pin(alert)
          )
        } else if let tts = parseTtsAlertSound(alert.soundType) {
          let text = renderAlertMessageTemplate(tts.text, alert: alert, batteryPercent: batteryPercent, onDiagnostic: onDiagnostic, unitSystem: unitSystem)
          if !text.isEmpty { player.speakAfterSeverity(tts.severity, text: text) }
        }
      }
      for alert in single where !isSpokenSoundType(alert.soundType) || mutedPresets.contains(alert.ruleId) {
        let severity = parseVoiceAlertSound(alert.soundType)?.severity
        player.playSingle(soundType: severity.map { "alert:\($0.rawValue)" } ?? alert.soundType, pin: pin(alert))
      }
      if vibrateSingles { player.vibrate(rangeDepth: nil) }
    }

    return fired.map { $0.toMap() }
  }

  /// The pin of `alert`'s preset; custom rules never follow one.
  private func pin(_ alert: FiredAlert) -> PresetSoundPin? {
    alert.ruleId.hasPrefix(presetRulePrefix) ? pins[alert.controlId] : nil
  }

  func stopAllGeiger() {
    player.stopAllGeiger()
    activeGeigerRuleIds.removeAll(keepingCapacity: true)
  }
}
