import AVFoundation
import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/CustomAppSounds.kt
internal enum CustomAppSounds {
  private static let cues: Set<String> = ["on", "off", "error", "created", "join"]
  private static let maxBytes = 2_000_000
  private static let maxDuration = 15.0
  private static let lock = NSRecursiveLock()

  private struct Pack: Codable {
    var id: String
    var name: String
    var sounds: [String: String]
  }

  private static var directory: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("custom-app-sounds", isDirectory: true)
  }
  private static var manifest: URL { directory.appendingPathComponent("packs.json") }
  private static func read() -> [Pack] {
    // intentional-suppression: absent or unreadable pack manifest means no custom packs; Classic remains usable
    guard let data = try? Data(contentsOf: manifest) else { return [] }
    // intentional-suppression: corrupt pack metadata falls back to an empty list and Classic playback
    return (try? JSONDecoder().decode([Pack].self, from: data)) ?? []
  }
  private static func save(_ packs: [Pack]) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try JSONEncoder().encode(packs).write(to: manifest, options: .atomic)
  }
  private static func validatedName(_ name: String) throws -> String {
    let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean.count <= 60 else { throw error("Name must be 1–60 characters") }
    return clean
  }
  private static func error(_ message: String) -> NSError {
    NSError(domain: "CustomAppSounds", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  static func list() -> [[String: Any]] {
    lock.lock(); defer { lock.unlock() }
    return read().map { ["id": $0.id, "name": $0.name, "sounds": $0.sounds] }
  }
  static func exists(_ id: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return read().contains { $0.id == id }
  }
  static func create(_ name: String) throws -> [[String: Any]] {
    lock.lock(); defer { lock.unlock() }
    var packs = read()
    packs.append(Pack(id: UUID().uuidString.lowercased(), name: try validatedName(name), sounds: [:]))
    try save(packs)
    return list()
  }
  static func rename(_ id: String, name: String) throws {
    lock.lock(); defer { lock.unlock() }
    var packs = read()
    guard let index = packs.firstIndex(where: { $0.id == id }) else { throw error("Sound pack missing") }
    packs[index].name = try validatedName(name)
    try save(packs)
  }
  static func remove(_ id: String, cue: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard cues.contains(cue) else { throw error("Unknown sound cue") }
    var packs = read()
    guard let index = packs.firstIndex(where: { $0.id == id }) else { throw error("Sound pack missing") }
    let old = packs[index].sounds.removeValue(forKey: cue)
    try save(packs)
    // intentional-suppression: orphaned old audio may be cleaned later; saved assignment is already current
    if let old { try? FileManager.default.removeItem(at: directory.appendingPathComponent(old)) }
  }
  static func delete(_ id: String) throws {
    lock.lock(); defer { lock.unlock() }
    var packs = read()
    guard let index = packs.firstIndex(where: { $0.id == id }) else { throw error("Sound pack missing") }
    let old = packs.remove(at: index)
    try save(packs)
    // intentional-suppression: deleting metadata is authoritative; leftover files are inert
    for name in old.sounds.values { try? FileManager.default.removeItem(at: directory.appendingPathComponent(name)) }
  }
  static func `import`(_ id: String, cue: String, uri: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard cues.contains(cue) else { throw error("Unknown sound cue") }
    var packs = read()
    guard let index = packs.firstIndex(where: { $0.id == id }) else { throw error("Sound pack missing") }
    guard let source = URL(string: uri), source.isFileURL else { throw error("Could not open audio file") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let name = "\(UUID().uuidString.lowercased()).wav"
    let destination = directory.appendingPathComponent(name)
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
      let old = packs[index].sounds.updateValue(name, forKey: cue)
      try save(packs)
      // intentional-suppression: orphaned old audio may be cleaned later; saved assignment is already current
    if let old { try? FileManager.default.removeItem(at: directory.appendingPathComponent(old)) }
    } catch {
      // intentional-suppression: cleanup after failed import is best effort; original error is rethrown
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
  }
  static func file(_ id: String, cue: String) -> URL? {
    lock.lock(); defer { lock.unlock() }
    guard cues.contains(cue), let name = read().first(where: { $0.id == id })?.sounds[cue],
      name.range(of: "^[0-9a-f-]{36}\\.wav$", options: .regularExpression) != nil else { return nil }
    let url = directory.appendingPathComponent(name)
    // intentional-suppression: missing file or unreadable attributes use Classic playback
    guard let size = try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int,
      size > 0, size <= maxBytes else { return nil }
    return url
  }

  static func archiveEntries() -> [String: Data] {
    lock.lock(); defer { lock.unlock() }
    var entries: [String: Data] = [:]
    // intentional-suppression: no readable manifest means backup contains no custom packs
    if let data = try? Data(contentsOf: manifest) { entries["packs.json"] = data }
    for pack in read() {
      for name in pack.sounds.values {
        // intentional-suppression: unreadable audio is omitted and its assignment is pruned on restore
        if let data = try? Data(contentsOf: directory.appendingPathComponent(name)), data.count <= maxBytes {
          entries[name] = data
        }
      }
    }
    return entries
  }

  static func validateBackup(_ entries: [String: Data]) throws {
    guard let data = entries["packs.json"] else { return }
    let packs = try JSONDecoder().decode([Pack].self, from: data)
    guard packs.allSatisfy({ !$0.id.isEmpty && !$0.name.isEmpty }) else {
      throw error("Invalid sound pack")
    }
  }

  static func replaceFromBackup(_ entries: [String: Data]) throws {
    lock.lock(); defer { lock.unlock() }
    let decoder = JSONDecoder()
    var packs = try entries["packs.json"].map { try decoder.decode([Pack].self, from: $0) } ?? []
    for index in packs.indices {
      packs[index].sounds = packs[index].sounds.filter { cue, name in
        cues.contains(cue) && name.range(of: "^[0-9a-f-]{36}\\.wav$", options: .regularExpression) != nil &&
          (entries[name]?.count ?? 0) > 0 && (entries[name]?.count ?? 0) <= maxBytes
      }
    }
    let old = directory.deletingLastPathComponent().appendingPathComponent("custom-app-sounds-old")
    // intentional-suppression: stale restore rollback directory is disposable
    try? FileManager.default.removeItem(at: old)
    if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.moveItem(at: directory, to: old) }
    do {
      try save(packs)
      for pack in packs {
        for name in pack.sounds.values {
          if let data = entries[name] { try data.write(to: directory.appendingPathComponent(name), options: .atomic) }
        }
      }
      // intentional-suppression: stale restore rollback directory is disposable
    try? FileManager.default.removeItem(at: old)
    } catch {
      // intentional-suppression: rollback cleanup is best effort; original restore error is rethrown
      try? FileManager.default.removeItem(at: directory)
      // intentional-suppression: rollback attempt is best effort; original restore error is rethrown
      if FileManager.default.fileExists(atPath: old.path) { try? FileManager.default.moveItem(at: old, to: directory) }
      throw error
    }
  }
}
