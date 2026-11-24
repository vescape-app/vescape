import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt
/// @parity /src/modules/settings/lib/appSounds.ts `VOICE_PACKS`
internal let voicePackIds = ["nova", "radio", "nicole"]

internal let renamedVoicePackIds = ["clean": "nova", "hev": "radio"]

internal let voicePackFallback = "nova"

internal let voiceMatching = "matching"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VOICE_LEVELS`
/// @parity /src/modules/settings/lib/appSounds.ts `VOICE_LEVELS`
internal let voiceLevels = ["off", "minimal", "standard", "full"]
internal let voiceLevelDefault = "standard"

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voicePackId`
/// @parity /src/modules/settings/lib/appSounds.ts `resolvedVoiceId`
internal func voicePackId(_ voice: String, effectsVoice: String?) -> String {
  if voicePackIds.contains(voice) { return voice }
  if let effectsVoice, voicePackIds.contains(effectsVoice) { return effectsVoice }
  return voicePackFallback
}

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
  "groupRide.signal.down": nil,
  "groupRide.signal.minor": nil,
  "groupRide.signal.serious": nil,
  "groupRide.signal.battery": nil,
  "groupRide.signal.tire": nil,
  "groupRide.signal.overheat": nil,
  "groupRide.signal.board": nil,
  "groupRide.signal.wait": nil,
  "groupRide.signal.break": nil,
  "groupRide.signal.ok": nil,
  "groupRide.signal.sent": nil,
  "groupRide.signal.cleared": nil,
  "groupRide.hazard.water": nil,
  "groupRide.hazard.terrain": nil,
  "groupRide.hazard.obstacle": nil,
  "groupRide.hazard.police": nil,
  "groupRide.hazard.sent": nil,
  "ride.end": nil,
  "weather.storm": nil,
  "weather.storm.now": nil,
  "weather.wind": nil,
  "weather.wind.now": nil,
  "weather.rain": nil,
  "weather.rain.now": nil,
  "voice.intro": nil,
]

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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VoiceWording`
internal enum VoiceWording: String {
  case minimal, standard, full

  init(level: String) {
    self = VoiceWording(rawValue: level) ?? .standard
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VoiceValue`
internal struct VoiceValue: Equatable {
  let type: String
  let value: Int
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VoiceAnnouncement`
internal struct VoiceAnnouncement: Equatable {
  let severity: AlertSeverity
  let key: String?
  var values: [VoiceValue] = []
  var wording: VoiceWording = .standard
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `voiceAnnouncement`
internal func voiceAnnouncement(
  _ sound: VoiceAlertSound,
  controlId: String?,
  reading: Double?,
  percentAvailable: Bool,
  distanceUnit: String,
  temperatureUnit: String
) -> VoiceAnnouncement {
  let key = sound.key ?? controlId.flatMap(voiceKey)
  let raw = sound.value ?? (key != "battery" || percentAvailable ? reading : nil)
  let type = key.flatMap { voiceKeyValueTypes[$0] ?? nil }
  let value: Double?
  switch type {
  case "percent": value = raw
  case "number": value = raw.map { key == "speed" && distanceUnit == "mi" ? $0 / kmPerMile : $0 }
  case "degrees": value = raw.map { temperatureUnit == "fahrenheit" ? $0 * 9 / 5 + 32 : $0 }
  default: value = nil
  }
  let clip = value.flatMap { $0.isFinite ? Int($0.rounded()) : nil }
  return VoiceAnnouncement(
    severity: sound.severity,
    key: key,
    values: type.flatMap { type in clip.map { [VoiceValue(type: type, value: $0)] } } ?? []
  )
}

internal struct VoiceLine: Equatable {
  let start: [String]
  var minimal: [String] = []
  var fullStart: [String] = []
  var fullEnd: [String] = []
  var endChance = 1.0
  var fullRare: [String] = []
  var rareChance = 0.0

  var files: [String] { start + minimal + fullStart + fullEnd + fullRare }
}

internal struct VoicePhrases: Equatable {
  let start: [String]
  let end: [String]
  let endChance: Double
  var rare: [String] = []
  var rareChance = 0.0
}

internal struct VoicePackManifest {
  let lines: [String: VoiceLine]
  let values: [String: [Int: String]]

  func phrases(key: String, severity: AlertSeverity, wording: VoiceWording) -> VoicePhrases? {
    guard let line = wording == .minimal ? lines[key] : lines["\(key).\(severity.rawValue)"] ?? lines[key]
    else { return nil }
    let phrases: VoicePhrases
    switch wording {
    case .minimal: phrases = VoicePhrases(start: line.minimal.isEmpty ? line.start : line.minimal, end: [], endChance: 0)
    case .standard: phrases = VoicePhrases(start: line.start, end: [], endChance: 0)
    case .full:
      phrases = VoicePhrases(
        start: line.fullStart.isEmpty ? line.start : line.fullStart,
        end: line.fullEnd,
        endChance: line.endChance,
        rare: line.fullRare,
        rareChance: line.rareChance
      )
    }
    return phrases.start.isEmpty ? nil : phrases
  }

  func valueClip(_ value: VoiceValue) -> String? {
    values[value.type]?[value.value]
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
          endChance: full["endChance"] as? Double ?? 1,
          fullRare: full["rare"] as? [String] ?? [],
          rareChance: full["rareChance"] as? Double ?? 0
        )
      },
      values: values.mapValues { clips in
        Dictionary(uniqueKeysWithValues: clips.compactMap { number, file in Int(number).map { ($0, file) } })
      }
    )
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `VoiceVariantPicker`
internal final class VoiceVariantPicker {
  private struct Choice {
    let start: Int
    let isRare: Bool
    let end: Int?

    func fits(_ line: VoicePhrases) -> Bool {
      let headFits = isRare ? start < line.rare.count : start < line.start.count
      return headFits && (end.map { $0 < line.end.count } ?? true)
    }
  }

  private let random: (Int) -> Int
  private var upcoming: [String: Choice] = [:]
  private let lock = NSLock()

  init(random: @escaping (Int) -> Int = { Int.random(in: 0..<$0) }) {
    self.random = random
  }

  func clips(_ manifest: VoicePackManifest, _ announcement: VoiceAnnouncement) -> [String]? {
    guard let (key, line) = resolve(manifest, announcement) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    let lineKey = "\(key).\(announcement.severity.rawValue).\(announcement.wording.rawValue)"
    let choice = upcoming[lineKey].flatMap { $0.fits(line) ? $0 : nil } ?? choose(line, avoid: nil)
    upcoming[lineKey] = choose(line, avoid: choice.isRare ? nil : choice.start)
    return files(manifest, line, choice, announcement.values)
  }

  func next(_ manifest: VoicePackManifest, _ announcement: VoiceAnnouncement) -> [String]? {
    guard let (key, line) = resolve(manifest, announcement) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    guard let choice = upcoming["\(key).\(announcement.severity.rawValue).\(announcement.wording.rawValue)"],
      choice.fits(line) else { return nil }
    return files(manifest, line, choice, announcement.values)
  }

  private func resolve(_ manifest: VoicePackManifest, _ announcement: VoiceAnnouncement) -> (String, VoicePhrases)? {
    guard let key = announcement.key,
      let line = manifest.phrases(key: key, severity: announcement.severity, wording: announcement.wording)
    else { return nil }
    return (key, line)
  }

  private func choose(_ line: VoicePhrases, avoid: Int?) -> Choice {
    if !line.rare.isEmpty, random(100) < Int((line.rareChance * 100).rounded()) {
      return Choice(start: random(line.rare.count), isRare: true, end: nil)
    }
    var start = random(line.start.count)
    if line.start.count > 1, start == avoid { start = (start + 1) % line.start.count }
    let ends = !line.end.isEmpty && random(100) < Int((line.endChance * 100).rounded())
    return Choice(start: start, isRare: false, end: ends ? random(line.end.count) : nil)
  }

  private func files(_ manifest: VoicePackManifest, _ line: VoicePhrases, _ choice: Choice, _ values: [VoiceValue]) -> [String] {
    let head = choice.isRare ? line.rare[choice.start] : line.start[choice.start]
    var clips = [head] + values.compactMap(manifest.valueClip)
    if let end = choice.end { clips.append(line.end[end]) }
    return clips
  }
}

internal let voiceSilenceThreshold: Float = 64.0 / 32767.0

internal let voicePrimingMaxSeconds = 2048.0 / 22050.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/VoicePacks.kt `leadingSilenceFrames`
internal func leadingSilenceFrames(_ samples: UnsafeBufferPointer<Float>, threshold: Float = voiceSilenceThreshold, maxFrames: Int) -> Int {
  let limit = min(samples.count, maxFrames)
  for index in 0..<limit where abs(samples[index]) >= threshold { return index }
  return limit
}

internal func voicePackManifest(root: URL, pack: String) -> VoicePackManifest? {
  let id = voicePackIds.contains(pack) ? pack : voicePackFallback
  // intentional-suppression: a missing or corrupt bundled manifest plays the severity sound only
  guard let data = try? Data(contentsOf: root.appendingPathComponent("voice-\(id)/pack.json")) else { return nil }
  return VoicePackManifest.parse(data)
}
