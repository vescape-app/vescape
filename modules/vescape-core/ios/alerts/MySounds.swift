import AVFoundation
import Foundation

/// Effects slots a My sound can override. A set override wins over the active effects pack; voice
/// lines and geiger ticks are not overridable.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/MySounds.kt `SOUND_OVERRIDE_SLOTS`
/// @parity /src/modules/settings/lib/appSounds.ts `SOUND_OVERRIDE_SLOTS`
internal let soundOverrideSlots = [
  "severity.info", "severity.warning", "severity.critical",
  "cue.on", "cue.off", "cue.error", "cue.groupRide.created", "cue.groupRide.joined",
  "cue.groupRide.riderJoined", "cue.groupRide.riderLeft", "cue.groupRide.lost", "cue.groupRide.restored",
]

/// My sounds: the rider's WAV library (≤2 MB, ≤15 s) in `custom-app-sounds/`, plus the override
/// slots that point at it. `my-sounds.json` holds `{ sounds: [{id, name}], overrides: {slot: id} }`;
/// each sound's audio is `<id>.wav`.
///
/// The custom app sound packs this replaces (`packs.json`) migrate on first read: every pack cue
/// becomes a My sound, and the pack that was selected becomes overrides once `adoptLegacyPack` sees
/// the `soundPack` setting.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/MySounds.kt
internal enum MySounds {
  private static let maxBytes = 2_000_000
  private static let maxDuration = 15.0
  private static let manifestName = "my-sounds.json"
  private static let legacyManifestName = "packs.json"
  private static let legacyCues = [
    ("on", "cue.on", "Connect"), ("off", "cue.off", "Disconnect"), ("error", "cue.error", "Error"),
    ("created", "cue.groupRide.created", "New Group Ride"),
    // The legacy `join` cue was another rider joining.
    ("join", "cue.groupRide.riderJoined", "Rider joined"),
  ]
  private static let lock = NSRecursiveLock()

  struct Sound: Codable, Equatable {
    var id: String
    var name: String
  }

  private struct Store: Codable {
    var sounds: [Sound] = []
    var overrides: [String: String] = [:]
    /// Migrated pack id → its cues as overrides, waiting for `adoptLegacyPack`.
    var legacyPacks: [String: [String: String]]?
  }

  private struct LegacyPack: Codable {
    var id: String
    var name: String
    var sounds: [String: String]
  }

  private static var cached: (URL, Store)?
  private static var durations: [String: Int64] = [:]

  static var directory: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("custom-app-sounds", isDirectory: true)
  }

  private static func isFileName(_ name: String) -> Bool {
    name.range(of: "^[0-9a-fA-F-]{36}\\.wav$", options: .regularExpression) != nil
  }

  /// Custom app sound packs → My sounds; each pack's cues are kept for `adoptLegacyPack`.
  private static func migrate(_ data: Data, in dir: URL) throws -> Store {
    let packs = try JSONDecoder().decode([LegacyPack].self, from: data)
    var store = Store()
    var legacy: [String: [String: String]] = [:]
    for pack in packs {
      var slots: [String: String] = [:]
      for (cue, slot, label) in legacyCues {
        guard let file = pack.sounds[cue], isFileName(file),
          FileManager.default.fileExists(atPath: dir.appendingPathComponent(file).path)
        else { continue }
        let id = String(file.dropLast(".wav".count))
        store.sounds.append(Sound(id: id, name: String("\(pack.name) \(label)".trimmingCharacters(in: .whitespaces).prefix(60))))
        slots[slot] = id
      }
      if !slots.isEmpty { legacy[pack.id] = slots }
    }
    store.legacyPacks = legacy.isEmpty ? nil : legacy
    return store
  }

  private static func read(at dir: URL = directory) -> Store {
    if let cached, cached.0 == dir { return cached.1 }
    let manifest = dir.appendingPathComponent(manifestName)
    let legacy = dir.appendingPathComponent(legacyManifestName)
    var store = Store()
    // intentional-suppression: no readable manifest means an empty library or a pending migration
    if let data = try? Data(contentsOf: manifest) {
      // intentional-suppression: an unreadable library reads as empty; pack slots keep playing
      store = (try? JSONDecoder().decode(Store.self, from: data)) ?? Store()
      // intentional-suppression: an unreadable pack manifest stays on disk and reads as empty
    } else if let data = try? Data(contentsOf: legacy) {
      if let migrated = try? migrate(data, in: dir), (try? save(migrated, at: dir)) != nil {
        store = migrated
        // intentional-suppression: a leftover pack manifest is ignored once My sounds exist
        try? FileManager.default.removeItem(at: legacy)
      }
    }
    cached = (dir, store)
    return store
  }

  private static func save(_ store: Store, at dir: URL = directory) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try JSONEncoder().encode(store).write(to: dir.appendingPathComponent(manifestName), options: .atomic)
    cached = (dir, store)
  }

  private static func validatedName(_ name: String) throws -> String {
    let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean.count <= 60 else { throw error("Name must be 1–60 characters") }
    return clean
  }

  private static func error(_ message: String) -> NSError {
    NSError(domain: "MySounds", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  static func state() -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    let store = read()
    return ["sounds": store.sounds.map { ["id": $0.id, "name": $0.name] }, "overrides": store.overrides]
  }

  static func `import`(uri: String, name: String) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    let clean = try validatedName(name)
    guard let source = URL(string: uri), source.isFileURL else { throw error("Could not open audio file") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let id = UUID().uuidString.lowercased()
    let destination = directory.appendingPathComponent("\(id).wav")
    do {
      try FileManager.default.copyItem(at: source, to: destination)
      let attrs = try FileManager.default.attributesOfItem(atPath: destination.path)
      guard let size = attrs[.size] as? Int, size > 0, size <= maxBytes else { throw error("WAV must be under 2 MB") }
      let handle = try FileHandle(forReadingFrom: destination)
      let header = handle.readData(ofLength: 12)
      try handle.close()
      guard header.count == 12, String(data: header.prefix(4), encoding: .ascii) == "RIFF",
        String(data: header.suffix(4), encoding: .ascii) == "WAVE" else { throw error("Only WAV files are supported") }
      let audio: AVAudioFile
      do { audio = try AVAudioFile(forReading: destination) }
      catch { throw Self.error("WAV audio could not be decoded") }
      guard audio.processingFormat.sampleRate >= 8_000,
        audio.processingFormat.sampleRate <= 192_000,
        audio.length <= 2_880_000 else { throw error("Unsupported WAV audio format") }
      let duration = Double(audio.length) / audio.processingFormat.sampleRate
      guard duration > 0, duration <= maxDuration else { throw error("Audio must be 15 seconds or shorter") }
      guard let buffer = AVAudioPCMBuffer(
        pcmFormat: audio.processingFormat,
        frameCapacity: AVAudioFrameCount(audio.length)
      ) else { throw error("WAV audio could not be decoded") }
      do { try audio.read(into: buffer) }
      catch { throw Self.error("WAV audio could not be decoded") }
      guard buffer.frameLength > 0 else { throw error("WAV audio could not be decoded") }
      var store = read()
      store.sounds.append(Sound(id: id, name: clean))
      try save(store)
    } catch {
      // intentional-suppression: cleanup after failed import is best effort; original error is rethrown
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
    return state()
  }

  static func rename(_ id: String, name: String) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    let clean = try validatedName(name)
    var store = read()
    guard let index = store.sounds.firstIndex(where: { $0.id == id }) else { throw error("Sound missing") }
    store.sounds[index].name = clean
    try save(store)
    return state()
  }

  /// Delete a sound and every override using it; rules still naming it fall back to the pack.
  static func delete(_ id: String) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    var store = read()
    guard store.sounds.contains(where: { $0.id == id }) else { throw error("Sound missing") }
    store.sounds.removeAll { $0.id == id }
    store.overrides = store.overrides.filter { $0.value != id }
    store.legacyPacks = store.legacyPacks?.mapValues { $0.filter { $0.value != id } }
    try save(store)
    // intentional-suppression: deleting metadata is authoritative; a leftover file is inert
    try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).wav"))
    return state()
  }

  /// Point `slot` at My sound `id`, or clear it back to the pack with nil.
  static func setOverride(_ slot: String, id: String?) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    guard soundOverrideSlots.contains(slot) else { throw error("Unknown sound slot") }
    var store = read()
    if let id {
      guard store.sounds.contains(where: { $0.id == id }) else { throw error("Sound missing") }
      store.overrides[slot] = id
    } else {
      store.overrides.removeValue(forKey: slot)
    }
    try save(store)
    return state()
  }

  /// Finish the pack migration: the migrated pack the `soundPack` setting still names becomes
  /// overrides (where none is set), then the pending packs are dropped.
  static func adoptLegacyPack(_ pack: String) {
    lock.lock(); defer { lock.unlock() }
    var store = read()
    guard let legacy = store.legacyPacks, !legacy.isEmpty else { return }
    store.overrides = (legacy[pack] ?? [:]).merging(store.overrides) { _, current in current }
    store.legacyPacks = nil
    // intentional-suppression: an unsaved adoption retries on the next settings read
    try? save(store)
  }

  /// Audio of My sound `id`, nil when it is gone or unreadable.
  static func file(_ id: String) -> URL? {
    lock.lock(); defer { lock.unlock() }
    guard read().sounds.contains(where: { $0.id == id }), isFileName("\(id).wav") else { return nil }
    let url = directory.appendingPathComponent("\(id).wav")
    // intentional-suppression: a missing file or unreadable attributes fall back to the pack
    guard let size = try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int,
      size > 0, size <= maxBytes else { return nil }
    return url
  }

  /// Audio overriding effects `slot`, nil when the slot follows the pack.
  static func overrideFile(_ slot: String) -> URL? {
    lock.lock(); defer { lock.unlock() }
    return read().overrides[slot].flatMap(file)
  }

  static func archiveEntries() -> [String: Data] {
    lock.lock(); defer { lock.unlock() }
    let store = read()
    guard !store.sounds.isEmpty else { return [:] }
    var entries: [String: Data] = [:]
    for sound in store.sounds {
      // intentional-suppression: unreadable audio is omitted and its sound is pruned on restore
      if let data = try? Data(contentsOf: directory.appendingPathComponent("\(sound.id).wav")), data.count <= maxBytes {
        entries["\(sound.id).wav"] = data
      }
    }
    // intentional-suppression: an unencodable manifest leaves the backup without sounds
    if let data = try? JSONEncoder().encode(store) { entries[manifestName] = data }
    return entries
  }

  static func validateBackup(_ entries: [String: Data]) throws {
    if let data = entries[legacyManifestName] {
      let packs = try JSONDecoder().decode([LegacyPack].self, from: data)
      guard packs.allSatisfy({ !$0.id.isEmpty && !$0.name.isEmpty }) else { throw error("Invalid sound pack") }
    }
    if let data = entries[manifestName] { _ = try JSONDecoder().decode(Store.self, from: data) }
  }

  /// Install a validated candidate: sounds without audio and overrides naming them are dropped. A
  /// backup from before My sounds carries `packs.json`, which migrates on first read after restore;
  /// a backup without sounds clears the library.
  static func replaceFromBackup(
    _ entries: [String: Data],
    at targetDirectory: URL = directory,
    writeEntry: (Data, URL) throws -> Void = { data, url in try data.write(to: url, options: .atomic) }
  ) throws {
    lock.lock(); defer { lock.unlock() }
    defer { cached = nil }
    func hasAudio(_ name: String) -> Bool {
      isFileName(name) && (entries[name]?.count ?? 0) > 0 && (entries[name]?.count ?? 0) <= maxBytes
    }
    var store = try entries[manifestName].map { try JSONDecoder().decode(Store.self, from: $0) }
    if var candidate = store {
      candidate.sounds = candidate.sounds.filter { hasAudio("\($0.id).wav") }
      let ids = Set(candidate.sounds.map(\.id))
      candidate.overrides = candidate.overrides.filter { soundOverrideSlots.contains($0.key) && ids.contains($0.value) }
      candidate.legacyPacks = candidate.legacyPacks?.mapValues { $0.filter { ids.contains($0.value) } }
      store = candidate
    }
    let legacy = store == nil ? entries[legacyManifestName] : nil
    let audio = entries.keys.filter { name in
      hasAudio(name) && (store?.sounds.contains { "\($0.id).wav" == name } ?? (legacy != nil))
    }
    let old = targetDirectory.deletingLastPathComponent().appendingPathComponent("custom-app-sounds-old")
    guard !FileManager.default.fileExists(atPath: old.path) else {
      throw error("Previous sound recovery files still exist")
    }
    if FileManager.default.fileExists(atPath: targetDirectory.path) { try FileManager.default.moveItem(at: targetDirectory, to: old) }
    do {
      try FileManager.default.createDirectory(at: targetDirectory, withIntermediateDirectories: true)
      if let store { try JSONEncoder().encode(store).write(to: targetDirectory.appendingPathComponent(manifestName), options: .atomic) }
      if let legacy { try legacy.write(to: targetDirectory.appendingPathComponent(legacyManifestName), options: .atomic) }
      for name in audio {
        if let data = entries[name] { try writeEntry(data, targetDirectory.appendingPathComponent(name)) }
      }
      // intentional-suppression: stale restore rollback directory is disposable
      try? FileManager.default.removeItem(at: old)
    } catch {
      let installError = error
      do {
        if FileManager.default.fileExists(atPath: targetDirectory.path) { try FileManager.default.removeItem(at: targetDirectory) }
        if FileManager.default.fileExists(atPath: old.path) { try FileManager.default.moveItem(at: old, to: targetDirectory) }
      } catch {
        throw NSError(domain: "MySounds", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "Sound restore failed and rollback was incomplete; recovery files are at \(old.path)",
          NSUnderlyingErrorKey: installError,
          "rollbackError": String(describing: error),
        ])
      }
      throw installError
    }
  }

  /// Length of My sound audio at `url`, 0 when unreadable. Read once per file.
  static func durationMs(_ url: URL) -> Int64 {
    lock.lock(); defer { lock.unlock() }
    if let cachedDuration = durations[url.path] { return cachedDuration }
    // intentional-suppression: an unreadable length only falls back to the minimum spacing
    let duration = (try? AVAudioFile(forReading: url)).map {
      Int64(Double($0.length) / $0.processingFormat.sampleRate * 1000)
    } ?? 0
    durations[url.path] = duration
    return duration
  }
}
