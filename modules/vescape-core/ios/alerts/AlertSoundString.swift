import Foundation

/// @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_RANGE`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `ALERT_BEEP_COUNT_RANGE`
internal let alertBeepCountRange = 1...5

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `PRESET_RULE_PREFIX`
internal let presetRulePrefix = "preset:"

/// @parity /src/modules/alerts/lib/alertSoundString.ts
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt
internal struct AlertSoundString: Equatable {
  let kind: String
  let variant: String?
  let sound: String

  private static let pattern = try! NSRegularExpression(
    pattern: "^([a-z]+)(?:\\(([^()]*)\\))?:(.*)$",
    options: [.dotMatchesLineSeparators]
  )

  static func parse(_ raw: String) -> AlertSoundString? {
    let range = NSRange(raw.startIndex..., in: raw)
    guard let match = pattern.firstMatch(in: raw, range: range),
      let kind = Range(match.range(at: 1), in: raw),
      let sound = Range(match.range(at: 3), in: raw)
    else { return nil }
    let variant = Range(match.range(at: 2), in: raw).map { String(raw[$0]) }
    return AlertSoundString(
      kind: String(raw[kind]),
      variant: variant?.isEmpty == false ? variant : nil,
      sound: String(raw[sound])
    )
  }
}

/// @parity /src/modules/alerts/lib/alertSoundString.ts `ALERT_SEVERITIES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertSeverity`
internal enum AlertSeverity: String, CaseIterable {
  case info, warning, critical

  var slot: String { "severity.\(rawValue)" }

  static func from(_ raw: String?) -> AlertSeverity {
    raw.flatMap(AlertSeverity.init(rawValue:)) ?? .warning
  }
}

internal struct TtsAlertSound: Equatable {
  let severity: AlertSeverity
  let text: String
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseTtsAlertSound`
internal func parseTtsAlertSound(_ spec: String) -> TtsAlertSound? {
  guard let parsed = AlertSoundString.parse(spec), parsed.kind == "tts" else { return nil }
  return TtsAlertSound(severity: AlertSeverity.from(parsed.variant), text: parsed.sound)
}

/// @parity /src/modules/alerts/lib/alertSoundString.ts `parseVoiceAlertSound`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseVoiceAlertSound`
internal struct VoiceAlertSound: Equatable {
  let severity: AlertSeverity
  let key: String?
  let value: Double?
}

internal func parseVoiceAlertSound(_ spec: String) -> VoiceAlertSound? {
  guard let parsed = AlertSoundString.parse(spec), parsed.kind == "voice" else { return nil }
  let parts = parsed.sound.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
  let key = parts.first.map(String.init).flatMap { $0.isEmpty ? nil : $0 }
  let value = parts.count > 1 ? Double(parts[1]).flatMap { $0.isFinite ? $0 : nil } : nil
  return VoiceAlertSound(severity: AlertSeverity.from(parsed.variant), key: key, value: value)
}

internal func isSpokenSpec(_ spec: String) -> Bool {
  parseTtsAlertSound(spec) != nil || parseVoiceAlertSound(spec) != nil
}

internal struct SlotAlertSound: Equatable {
  let count: Int
  let severity: AlertSeverity
}

/// @parity /src/modules/alerts/lib/alertSoundString.ts `parseSlotAlertSound`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseSlotAlertSound`
internal func parseSlotAlertSound(_ spec: String) -> SlotAlertSound {
  if let parsed = AlertSoundString.parse(spec), parsed.kind == "alert" {
    let count = parsed.variant.flatMap { Int($0) }.map {
      min(max($0, alertBeepCountRange.lowerBound), alertBeepCountRange.upperBound)
    } ?? 1
    return SlotAlertSound(count: count, severity: AlertSeverity(rawValue: parsed.sound) ?? .warning)
  }
  switch spec {
  case "preset:notify", "notify", "pulse": return SlotAlertSound(count: 1, severity: .info)
  case "preset:urgent", "urgent": return SlotAlertSound(count: 1, severity: .critical)
  default: return SlotAlertSound(count: 1, severity: .warning)
  }
}

/// @parity /src/modules/alerts/lib/alertSoundString.ts `GEIGER_LEVELS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `GeigerLevel`
internal enum GeigerLevel: String, CaseIterable {
  case soft, mid, hard

  var slot: String { "geiger.\(rawValue)" }
}

private let legacyGeiger: [String: GeigerLevel] = [
  "preset:tick": .soft,
  "preset:tick_hard": .mid,
  "preset:gamma": .hard,
  "preset:sustained": .hard,
]

/// @parity /src/modules/alerts/lib/alertSoundString.ts `parseGeigerAlertSound`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseGeigerAlertSound`
internal func parseGeigerAlertSound(_ spec: String) -> GeigerLevel? {
  if let legacy = legacyGeiger[spec] { return legacy }
  guard let parsed = AlertSoundString.parse(spec), parsed.kind == "geiger" else { return nil }
  return GeigerLevel(rawValue: parsed.sound) ?? .soft
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `geigerSlot`
internal func geigerSlot(_ spec: String) -> String {
  (parseGeigerAlertSound(spec) ?? .soft).slot
}

internal func isGeigerSpec(_ spec: String) -> Bool {
  parseGeigerAlertSound(spec) != nil
}

/// @parity /src/modules/alerts/lib/alertSoundString.ts `mySoundId`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `mySoundId`
internal func mySoundId(_ spec: String) -> String? {
  guard let parsed = AlertSoundString.parse(spec), parsed.kind == "alert" || parsed.kind == "geiger",
    parsed.sound.hasPrefix("my:") else { return nil }
  let id = String(parsed.sound.dropFirst("my:".count))
  return id.isEmpty ? nil : id
}

/// @parity /src/modules/alerts/lib/alertSoundString.ts `parseAlertPresetSpec`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertPresetSpec`
internal struct AlertPresetSpec: Equatable {
  struct Option: Equatable {
    let key: String
    let value: String
  }

  var level: String
  var options: [Option] = []

  func option(_ key: String) -> String? { options.first { $0.key == key }?.value }

  func withOption(_ key: String, _ value: String?) -> AlertPresetSpec {
    var next = options.filter { $0.key != key }
    if let value {
      let index = options.firstIndex { $0.key == key } ?? next.count
      next.insert(Option(key: key, value: value), at: index)
    }
    return AlertPresetSpec(level: level, options: next)
  }

  func encode() -> String {
    "preset(\(level))" + (options.isEmpty ? "" : ":" + options.map { "\($0.key)=\($0.value)" }.joined(separator: ","))
  }

  private static let pattern = try! NSRegularExpression(
    pattern: "^preset\\(([^()]*)\\)(?::(.*))?\\z",
    options: [.dotMatchesLineSeparators]
  )

  static func parse(_ raw: String) -> AlertPresetSpec? {
    let range = NSRange(raw.startIndex..., in: raw)
    guard let match = pattern.firstMatch(in: raw, range: range),
      let level = Range(match.range(at: 1), in: raw)
    else { return nil }
    let tail = Range(match.range(at: 2), in: raw).map { String(raw[$0]) } ?? ""
    let options = tail.split(separator: ",", omittingEmptySubsequences: false).compactMap { entry -> Option? in
      guard let separator = entry.firstIndex(of: "="), separator != entry.startIndex else { return nil }
      return Option(key: String(entry[..<separator]), value: String(entry[entry.index(after: separator)...]))
    }
    return AlertPresetSpec(level: String(raw[level]), options: options)
  }
}
