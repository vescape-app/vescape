import Foundation

/// Built-in voice packs (`shared/alerts/packs/voice-<id>`): whole-sentence lines per message key
/// plus value clips, joined natively into one buffer after the effects pack's severity sound.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt
/// @parity /src/modules/settings/lib/appSounds.ts `VOICE_PACKS`
internal let voicePackIds = ["nova", "radio"]

/// Former voice id → its new id; a saved one reads as the renamed voice.
internal let renamedVoicePackIds = ["clean": "nova", "hev": "radio"]

/// Voice an effects pack without its own voice matches, and the stand-in for an unknown id.
internal let voicePackFallback = "nova"

/// `voice` setting that follows the voice the selected effects pack names.
internal let voiceMatching = "matching"

/// Voice level: `off` plays effects only for presets and app sounds; `minimal` and `standard` speak
/// preset alerts; `full` also speaks app cues and group ride events (#581). Each level also picks
/// the wording (`VoiceWording`). Custom rules speak whatever the level, `off` with standard wording.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VOICE_LEVELS`
/// @parity /src/modules/settings/lib/appSounds.ts `VOICE_LEVELS`
internal let voiceLevels = ["off", "minimal", "standard", "full"]
internal let voiceLevelDefault = "standard"

/// Voice pack the `voice` setting plays: a named pack, or the one `effectsVoice` names.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voicePackId`
/// @parity /src/modules/settings/lib/appSounds.ts `resolvedVoiceId`
internal func voicePackId(_ voice: String, effectsVoice: String?) -> String {
  if voicePackIds.contains(voice) { return voice }
  if let effectsVoice, voicePackIds.contains(effectsVoice) { return effectsVoice }
  return voicePackFallback
}

/// Voice keys of built-in alerts and the value type each speaks (nil: no value). Mirrors
/// `scripts/alert-packs/catalog.json` `voiceKeys`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VOICE_KEY_VALUE_TYPES`
internal let voiceKeyValueTypes: [String: String?] = [
  "battery": "percent",
  "motorTemp": "degrees",
  "controllerTemp": "degrees",
  "speed": "number",
  "dutyCycle": "number",
  "boardConnection.connected": nil,
  "boardConnection.lost": nil,
  "system.error": nil,
  "groupRide.created": nil,
  "groupRide.joined": nil,
  "groupRide.riderJoined": nil,
  "groupRide.riderLeft": nil,
  "groupRide.lost": nil,
  "groupRide.restored": nil,
  "ride.end": nil,
]

/// Voice key an alert on `controlId` speaks; nil for metrics without voice lines.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voiceKey`
/// @parity /src/modules/alerts/lib/alertSoundString.ts `VOICE_KEY_BY_CONTROL`
internal func voiceKey(_ controlId: String) -> String? {
  switch controlId {
  case "battery": return "battery"
  case "motor-temp": return "motorTemp"
  case "controller-temp": return "controllerTemp"
  case "speed": return "speed"
  case "duty": return "dutyCycle"
  default: return nil
  }
}

private let kmPerMile = 1.609344

/// Which phrases a line speaks: `minimal` the generic line's `minimal` (else `start`), never a
/// severity line; `standard` the severity line's `start`; `full` its `full` pool (else `start`) with
/// an ending drawn at `endChance`.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VoiceWording`
internal enum VoiceWording: String {
  case minimal, standard, full

  init(level: String) {
    self = VoiceWording(rawValue: level) ?? .standard
  }
}

/// One voice announcement: the severity sound, then the line for `key` with `value` spoken last.
internal struct VoiceAnnouncement: Equatable {
  let severity: AlertSeverity
  let key: String?
  let value: Int?
  var wording: VoiceWording = .standard
}

/// What a `voice` sound says for an alert on `controlId`. The key comes from the sound string or the
/// metric; the value from the sound string or `reading` (percent for battery only while
/// `percentAvailable`: without a battery config a battery reading is volts), °C read in °F under
/// imperial units, km/h read in mph, rounded to the nearest clip. A nil key plays the severity sound only.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voiceAnnouncement`
internal func voiceAnnouncement(
  _ sound: VoiceAlertSound,
  controlId: String?,
  reading: Double?,
  percentAvailable: Bool,
  unitSystem: String
) -> VoiceAnnouncement {
  let key = sound.key ?? controlId.flatMap(voiceKey)
  let raw = sound.value ?? (key != "battery" || percentAvailable ? reading : nil)
  let value: Double?
  switch key.flatMap({ voiceKeyValueTypes[$0] ?? nil }) {
  case "percent": value = raw
  case "number": value = raw.map { key == "speed" && unitSystem == "imperial" ? $0 / kmPerMile : $0 }
  case "degrees": value = raw.map { unitSystem == "imperial" ? $0 * 9 / 5 + 32 : $0 }
  default: value = nil
  }
  return VoiceAnnouncement(
    severity: sound.severity,
    key: key,
    value: value.flatMap { $0.isFinite ? Int($0.rounded()) : nil }
  )
}

/// A line in `pack.json`: `start` phrases, an optional `minimal` phrase set, and an optional `full`
/// pool whose ending plays at `endChance`. Each list holds clip variants.
internal struct VoiceLine: Equatable {
  let start: [String]
  var minimal: [String] = []
  var fullStart: [String] = []
  var fullEnd: [String] = []
  var endChance = 1.0

  var files: [String] { start + minimal + fullStart + fullEnd }
}

/// What one announcement can say: `start` (+ value) (+ an `end` at `endChance`).
internal struct VoicePhrases: Equatable {
  let start: [String]
  let end: [String]
  let endChance: Double
}

/// A voice pack's `pack.json`: lines per key, value clip per value type and number.
internal struct VoicePackManifest {
  let lines: [String: VoiceLine]
  let values: [String: [Int: String]]

  /// Phrases for `key` in `wording`: Minimal reads the generic `<key>` line only; Standard and Full
  /// the most specific `<key>.<severity>`, else `<key>`. Nil when the pack has no such line.
  func phrases(key: String, severity: AlertSeverity, wording: VoiceWording) -> VoicePhrases? {
    guard let line = wording == .minimal ? lines[key] : lines["\(key).\(severity.rawValue)"] ?? lines[key]
    else { return nil }
    let phrases: VoicePhrases
    switch wording {
    case .minimal: phrases = VoicePhrases(start: line.minimal.isEmpty ? line.start : line.minimal, end: [], endChance: 0)
    case .standard: phrases = VoicePhrases(start: line.start, end: [], endChance: 0)
    case .full:
      phrases = VoicePhrases(start: line.fullStart.isEmpty ? line.start : line.fullStart, end: line.fullEnd, endChance: line.endChance)
    }
    return phrases.start.isEmpty ? nil : phrases
  }

  /// Value clip of `key`'s value type for `value`; nil when the pack has no such clip.
  func valueClip(key: String, value: Int) -> String? {
    guard let type = voiceKeyValueTypes[key] ?? nil else { return nil }
    return values[type]?[value]
  }

  static func parse(_ data: Data) -> VoicePackManifest? {
    // intentional-suppression: an unreadable manifest plays the severity sound only
    guard
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let lines = json["lines"] as? [String: [String: Any]]
    else { return nil }
    let values = (json["values"] as? [String: [String: String]]) ?? [:]
    return VoicePackManifest(
      lines: lines.mapValues { line in
        let full = line["full"] as? [String: Any] ?? [:]
        return VoiceLine(
          start: line["start"] as? [String] ?? [],
          minimal: line["minimal"] as? [String] ?? [],
          fullStart: full["start"] as? [String] ?? [],
          fullEnd: full["end"] as? [String] ?? [],
          endChance: full["endChance"] as? Double ?? 1
        )
      },
      values: values.mapValues { clips in
        Dictionary(uniqueKeysWithValues: clips.compactMap { number, file in Int(number).map { ($0, file) } })
      }
    )
  }
}

/// Picks one clip per line part at random, never the same `start` twice in a row for a key, and
/// an `end` only at its `endChance`. The pick after each announcement is made right away, so `next`
/// lets the caller join it ahead.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VoiceVariantPicker`
internal final class VoiceVariantPicker {
  private struct Choice {
    let start: Int
    let end: Int?

    /// False for a pick made against another pack's line (the picker serves every pack).
    func fits(_ line: VoicePhrases) -> Bool {
      start < line.start.count && (end.map { $0 < line.end.count } ?? true)
    }
  }

  private let random: (Int) -> Int
  private var upcoming: [String: Choice] = [:]
  private let lock = NSLock()

  init(random: @escaping (Int) -> Int = { Int.random(in: 0..<$0) }) {
    self.random = random
  }

  /// Clip files of `announcement` in play order (start, value, end); nil when the pack has no line.
  func clips(_ manifest: VoicePackManifest, _ announcement: VoiceAnnouncement) -> [String]? {
    guard let (key, line) = resolve(manifest, announcement) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    let lineKey = "\(key).\(announcement.severity.rawValue).\(announcement.wording.rawValue)"
    let choice = upcoming[lineKey].flatMap { $0.fits(line) ? $0 : nil } ?? choose(line, avoid: nil)
    upcoming[lineKey] = choose(line, avoid: choice.start)
    return files(manifest, key, line, choice, announcement.value)
  }

  /// Clip files the next `clips` call for `announcement` returns, without consuming the pick.
  func next(_ manifest: VoicePackManifest, _ announcement: VoiceAnnouncement) -> [String]? {
    guard let (key, line) = resolve(manifest, announcement) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    guard let choice = upcoming["\(key).\(announcement.severity.rawValue).\(announcement.wording.rawValue)"],
      choice.fits(line) else { return nil }
    return files(manifest, key, line, choice, announcement.value)
  }

  private func resolve(_ manifest: VoicePackManifest, _ announcement: VoiceAnnouncement) -> (String, VoicePhrases)? {
    guard let key = announcement.key,
      let line = manifest.phrases(key: key, severity: announcement.severity, wording: announcement.wording)
    else { return nil }
    return (key, line)
  }

  private func choose(_ line: VoicePhrases, avoid: Int?) -> Choice {
    var start = random(line.start.count)
    if line.start.count > 1, start == avoid { start = (start + 1) % line.start.count }
    let ends = !line.end.isEmpty && random(100) < Int((line.endChance * 100).rounded())
    return Choice(start: start, end: ends ? random(line.end.count) : nil)
  }

  private func files(_ manifest: VoicePackManifest, _ key: String, _ line: VoicePhrases, _ choice: Choice, _ value: Int?) -> [String] {
    var clips = [line.start[choice.start]]
    if let value, let clip = manifest.valueClip(key: key, value: value) { clips.append(clip) }
    if let end = choice.end { clips.append(line.end[end]) }
    return clips
  }
}

/// Amplitude below which a clip's first samples count as padding (64 of 32 767).
internal let voiceSilenceThreshold: Float = 64.0 / 32767.0

/// Longest padding trimmed: two AAC frames, about 93 ms at 22 050 Hz.
internal let voicePrimingMaxSeconds = 2048.0 / 22050.0

/// Leading AAC encoder priming and silence, at most `maxFrames`: joins must not open a gap before
/// each clip. Clips start on speech, so anything under `threshold` there is padding.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `leadingSilenceFrames`
internal func leadingSilenceFrames(_ samples: UnsafeBufferPointer<Float>, threshold: Float = voiceSilenceThreshold, maxFrames: Int) -> Int {
  let limit = min(samples.count, maxFrames)
  for index in 0..<limit where abs(samples[index]) >= threshold { return index }
  return limit
}

/// Manifest of voice pack `pack` under `root` (the folder holding `voice-<id>/`).
internal func voicePackManifest(root: URL, pack: String) -> VoicePackManifest? {
  let id = voicePackIds.contains(pack) ? pack : voicePackFallback
  // intentional-suppression: a missing or corrupt bundled manifest plays the severity sound only
  guard let data = try? Data(contentsOf: root.appendingPathComponent("voice-\(id)/pack.json")) else { return nil }
  return VoicePackManifest.parse(data)
}
