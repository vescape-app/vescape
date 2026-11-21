import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `DiagnosticEvent`
struct WatchDiagnosticEvent: Equatable {
  let atMs: Int64
  let text: String
  let warn: Bool
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `WatchDiagnostics`
/// @platform-diff Wear OS also counts messages that arrived on an unknown Data Layer path and logs
struct WatchDiagnosticsLog: Equatable {
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `MAX_EVENTS`
  static let maxEvents = 50

  private(set) var framesDecoded = 0
  private(set) var decodeFailures = 0
  private(set) var events: [WatchDiagnosticEvent] = []

  private var inDecodeFailStreak = false
  private var lastLinkLabel: String?
  private var lastWakeLevel: WatchMirrorWakeLevel?

  init() {}

  mutating func recordFrame(nowMs: Int64) {
    if framesDecoded == 0 { record("first frame received", nowMs: nowMs) }
    inDecodeFailStreak = false
    framesDecoded += 1
  }

  mutating func recordDecodeFailure(byteCount: Int, lanes: UInt8?, nowMs: Int64) {
    decodeFailures += 1
    guard !inDecodeFailStreak else { return }
    inDecodeFailStreak = true
    record("decode fail \(byteCount)B v\(lanes.map(Int.init) ?? -1)", warn: true, nowMs: nowMs)
  }

  mutating func recordLink(_ label: String, nowMs: Int64) {
    guard label != lastLinkLabel else { return }
    lastLinkLabel = label
    record("link \(label)", nowMs: nowMs)
  }

  mutating func recordWakeLevel(_ level: WatchMirrorWakeLevel, nowMs: Int64) {
    guard level != lastWakeLevel else { return }
    lastWakeLevel = level
    record("wake \(level.label)", nowMs: nowMs)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `recordRadarFailure`
  mutating func recordRadarFailure(nowMs: Int64) {
    record("radar fetch failed", warn: true, nowMs: nowMs)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `recordReplay`
  mutating func recordReplay(fixture: String, sampleCount: Int, nowMs: Int64) {
    record("replay \(fixture) (\(sampleCount) samples)", nowMs: nowMs)
  }

  private mutating func record(_ text: String, warn: Bool = false, nowMs: Int64) {
    events.insert(WatchDiagnosticEvent(atMs: nowMs, text: text, warn: warn), at: 0)
    if events.count > Self.maxEvents { events.removeLast(events.count - Self.maxEvents) }
  }
}

extension WatchMirrorWakeLevel {
  var label: String {
    switch self {
    case .asleep: return "asleep"
    case .active: return "active"
    case .ambient: return "ambient"
    }
  }
}

struct WatchFrameRate {
  private static let windowMs: Int64 = 5_000
  private var stamps: [Int64] = []

  mutating func record(nowMs: Int64) {
    stamps.append(nowMs)
    stamps.removeAll { $0 < nowMs - Self.windowMs }
  }

  func hertz(nowMs: Int64) -> Double {
    let recent = stamps.filter { $0 >= nowMs - Self.windowMs && $0 <= nowMs }
    guard recent.count > 1, let first = recent.first, nowMs > first else { return 0 }
    return Double(recent.count - 1) * 1_000 / Double(nowMs - first)
  }
}
