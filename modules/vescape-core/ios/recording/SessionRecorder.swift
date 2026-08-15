import Foundation

/// Raw debug Session Recorder: appends one JSON object per line (`.jsonl`) capturing the Board
/// Session's BLE traffic, GPS fixes, and session-state transitions for offline replay (ADR 0024).
///
/// The line format is the cross-platform parity contract — field names and `kind` values must
/// match Android byte-for-byte so recordings replay on either platform:
/// `{"t":<ms>,"kind":"meta"|"ble-chunk"|"location"|"session-state",...}`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/SessionRecorder.kt `SessionRecorder`
internal final class SessionRecorder {
  private let store: DebugRecordingStore
  private let deviceName: String
  private let deviceId: String
  private let pollIntervalMs: Int
  private let startedAt: Int64
  private var handle: FileHandle?
  let fileURL: URL

  /// Fails (returns nil) when the recording file cannot be created or opened, so callers never
  /// install a recorder that silently drops every line.
  init?(
    store: DebugRecordingStore = DebugRecordingStore(),
    deviceName: String,
    deviceId: String,
    pollIntervalMs: Int
  ) {
    self.store = store
    self.deviceName = deviceName
    self.deviceId = deviceId
    self.pollIntervalMs = pollIntervalMs
    self.startedAt = Int64(Date().timeIntervalSince1970 * 1000)
    guard let url = store.createFile(deviceName: deviceName),
      let handle = try? FileHandle(forWritingTo: url)
    else {
      NSLog("[vescape] Debug recording file creation failed for \(deviceName)")
      return nil
    }
    self.fileURL = url
    self.handle = handle
  }

  func start() {
    write([
      ("t", 0 as Int64),
      ("kind", "meta"),
      ("version", 1),
      ("deviceName", deviceName),
      ("deviceId", deviceId),
      ("sessionKind", "board"),
      ("pollIntervalMs", pollIntervalMs),
      ("startedAt", startedAt),
    ])
    recordState("recording-started")
  }

  /// The phone's compass bearing, pushed down from JS — the sensor is read there, so native cannot
  /// observe it on its own. Recorded so a replay can drive the heading cone and Compass follow off
  /// the real measured rotation instead of a stand-in derived from GPS course.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/SessionRecorder.kt `recordPhoneHeading`
  func recordPhoneHeading(_ headingDeg: Double) {
    write([
      ("t", elapsed()),
      ("kind", "phone-heading"),
      ("headingDeg", headingDeg),
    ])
  }

  func recordState(_ status: String, extra: [(String, Any?)] = []) {
    write([
      ("t", elapsed()),
      ("kind", "session-state"),
      ("status", status),
    ] + extra)
  }

  func recordChunk(direction: String, bytes: [UInt8]) {
    write([
      ("t", elapsed()),
      ("kind", "ble-chunk"),
      ("direction", direction),
      ("base64", Data(bytes).base64EncodedString()),
    ])
  }

  func recordLocation(
    latitude: Double,
    longitude: Double,
    speedMps: Double?,
    bearingDeg: Double?,
    accuracyM: Double?,
    altitudeM: Double?,
    timestamp: Int64
  ) {
    write([
      ("t", elapsed()),
      ("kind", "location"),
      ("latitude", latitude),
      ("longitude", longitude),
      ("speedMps", speedMps),
      ("bearingDeg", bearingDeg),
      ("accuracyM", accuracyM),
      ("altitudeM", altitudeM),
      ("timestamp", timestamp),
    ])
  }

  func finish(status: String) {
    recordState(status)
    try? handle?.close()
    handle = nil
  }

  private func elapsed() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) - startedAt }

  private func write(_ fields: [(String, Any?)]) {
    guard let handle, let data = (Self.jsonLine(fields) + "\n").data(using: .utf8) else { return }
    handle.write(data)
  }

  /// Serialize one recording line with stable field order. `nil` values are omitted, matching
  /// Android's `JSONObject.put(name, null)` dropping the key.
  static func jsonLine(_ fields: [(String, Any?)]) -> String {
    let parts = fields.compactMap { key, value -> String? in
      guard let value, let encoded = encode(value) else { return nil }
      return "\(encodeString(key)):\(encoded)"
    }
    return "{" + parts.joined(separator: ",") + "}"
  }

  private static func encode(_ value: Any) -> String? {
    switch value {
    case let string as String: return encodeString(string)
    case let bool as Bool: return bool ? "true" : "false"
    case let int as Int: return String(int)
    case let int64 as Int64: return String(int64)
    case let double as Double: return double.isFinite ? shortestDecimal(double) : nil
    default: return nil
    }
  }

  /// Round-trip-exact decimal for a Double, without a spurious `.0` on whole values (matches
  /// Android's `JSONObject.numberToString`).
  private static func shortestDecimal(_ value: Double) -> String {
    if value == value.rounded(), abs(value) < 1e15 {
      return String(Int64(value))
    }
    return String(value)
  }

  private static func encodeString(_ string: String) -> String {
    var out = "\""
    for scalar in string.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out + "\""
  }
}

/// On-device store for captured Debug Recordings: `<epochMs>-<sanitized-deviceName>.jsonl` under
/// Documents/`vesc-recordings`, listed newest-first, exported by copy into a cache subdir.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/SessionRecorder.kt `DebugRecordingStore`
internal final class DebugRecordingStore {
  private let directory: URL

  init(directory: URL = DebugRecordingStore.defaultDirectory()) {
    self.directory = directory
  }

  static func defaultDirectory() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("vesc-recordings", isDirectory: true)
  }

  /// Resolve a recording by name with the same validation as Android's store: no path traversal,
  /// `.jsonl` only. Returns nil when invalid or missing.
  static func recordingURL(name: String) -> URL? {
    guard (name as NSString).lastPathComponent == name, name.hasSuffix(".jsonl") else { return nil }
    let url = defaultDirectory().appendingPathComponent(name)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }

  func createFile(deviceName: String) -> URL? {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var safeName = deviceName.replacingOccurrences(
      of: "[^A-Za-z0-9._-]+",
      with: "-",
      options: .regularExpression
    )
    safeName = safeName.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    if safeName.isEmpty { safeName = "vesc-board" }
    let url = directory.appendingPathComponent("\(Int64(Date().timeIntervalSince1970 * 1000))-\(safeName).jsonl")
    guard FileManager.default.createFile(atPath: url.path, contents: nil) else { return nil }
    return url
  }

  func list() throws -> [[String: Any]] {
    guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
    let files = try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
    )
    return files
      .filter { $0.pathExtension == "jsonl" }
      .compactMap { url -> (URL, Int64, Int64)? in
        guard
          let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]),
          values.isRegularFile == true
        else { return nil }
        let modifiedMs = Int64((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)
        return (url, modifiedMs, Int64(values.fileSize ?? 0))
      }
      .sorted { $0.1 > $1.1 }
      .map { url, createdAt, sizeBytes in
        ["name": url.lastPathComponent, "createdAt": createdAt, "sizeBytes": sizeBytes]
      }
  }

  func export(name: String) throws -> [String: Any] {
    guard
      (name as NSString).lastPathComponent == name,
      name.hasSuffix(".jsonl"),
      FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
    else {
      throw NSError(
        domain: "VescapeCore",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Debug recording not found"]
      )
    }
    let source = directory.appendingPathComponent(name)
    let exportDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("debug-recording-exports", isDirectory: true)
    try FileManager.default.createDirectory(at: exportDir, withIntermediateDirectories: true)
    let export = exportDir.appendingPathComponent(name)
    if FileManager.default.fileExists(atPath: export.path) {
      try FileManager.default.removeItem(at: export)
    }
    try FileManager.default.copyItem(at: source, to: export)
    let sizeBytes = Int64((try? export.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
    return [
      "uri": export.absoluteString,
      "name": name,
      "sizeBytes": sizeBytes,
    ]
  }

  func delete(name: String) throws {
    guard
      (name as NSString).lastPathComponent == name,
      name.hasSuffix(".jsonl"),
      FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
    else {
      throw NSError(
        domain: "VescapeCore",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Debug recording not found"]
      )
    }
    try FileManager.default.removeItem(at: directory.appendingPathComponent(name))
  }
}
