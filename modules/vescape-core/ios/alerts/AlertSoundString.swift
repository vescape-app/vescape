import Foundation

/// A rule's `soundType` read through the sound string grammar `kind(variant):sound`. Only the first
/// `:` after the kind and optional variant splits, so the sound part (TTS text) may contain `:`.
/// Strings outside the grammar (no `kind:` prefix) parse to nil.
///
/// `tts` and `alert` have typed readings; `geiger` and `voice` plug in as new readings of the same
/// parsed parts.
///
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

/// Severity of an announcement: picks the active effects pack's `severity.<id>` slot, played before
/// speech or as an alert rule's sound.
///
/// @parity /src/modules/alerts/lib/alertSoundString.ts `ALERT_SEVERITIES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertSeverity`
internal enum AlertSeverity: String, CaseIterable {
  case info, warning, critical

  var slot: String { "severity.\(rawValue)" }

  /// Absent or unknown severities read as `.warning`.
  static func from(_ raw: String?) -> AlertSeverity {
    raw.flatMap(AlertSeverity.init(rawValue:)) ?? .warning
  }
}

/// `tts(severity):text` — the severity sound once, then system TTS speaking `text`.
internal struct TtsAlertSound: Equatable {
  let severity: AlertSeverity
  let text: String
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseTtsAlertSound`
internal func parseTtsAlertSound(_ soundType: String) -> TtsAlertSound? {
  guard let parsed = AlertSoundString.parse(soundType), parsed.kind == "tts" else { return nil }
  return TtsAlertSound(severity: AlertSeverity.from(parsed.variant), text: parsed.sound)
}

/// `alert(count):severity` — the active effects pack's severity sound, `count` times.
internal struct SlotAlertSound: Equatable {
  let count: Int
  let severity: AlertSeverity
}

/// Read any non-TTS single-alert `soundType` as a slot sound. `alert:` means one play. Strings from
/// before the grammar map onto the matching severity (`preset:notify|beep|urgent` → info, warning,
/// critical, played once); anything unknown, including a not-yet-supported `my:` sound, plays the
/// warning sound once, so a rule is never silent.
///
/// @parity /src/modules/alerts/lib/alertSoundString.ts `parseSlotAlertSound`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `parseSlotAlertSound`
internal func parseSlotAlertSound(_ soundType: String) -> SlotAlertSound {
  if let parsed = AlertSoundString.parse(soundType), parsed.kind == "alert" {
    let count = parsed.variant.flatMap { Int($0) }.map {
      min(max($0, alertBeepCountRange.lowerBound), alertBeepCountRange.upperBound)
    } ?? 1
    return SlotAlertSound(count: count, severity: AlertSeverity(rawValue: parsed.sound) ?? .warning)
  }
  switch soundType {
  case "preset:notify", "notify", "pulse": return SlotAlertSound(count: 1, severity: .info)
  case "preset:urgent", "urgent": return SlotAlertSound(count: 1, severity: .critical)
  default: return SlotAlertSound(count: 1, severity: .warning)
  }
}
