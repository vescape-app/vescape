import Foundation

/// A rule's `soundType` read through the sound string grammar `kind(variant):sound`. Only the first
/// `:` after the kind and optional variant splits, so the sound part (TTS text) may contain `:`.
/// Strings outside the grammar (no `kind:` prefix) parse to nil.
///
/// Only `tts` has a typed reading today; `alert`, `geiger`, and `voice` plug in as new readings of
/// the same parsed parts.
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

/// Severity of a spoken announcement: picks the sound played once before the speech. Until effects
/// packs land (#578) each maps to a bundled single sound.
///
/// @parity /src/modules/alerts/lib/alertSoundString.ts `ALERT_SEVERITIES`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AlertSoundString.kt `AlertSeverity`
internal enum AlertSeverity: String, CaseIterable {
  case info, warning, critical

  var soundType: String {
    switch self {
    case .info: return "preset:notify"
    case .warning: return "preset:beep"
    case .critical: return "preset:urgent"
    }
  }

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
