import Foundation

/// One line of the wrist's event ring: when it happened by the watch's wall clock, what happened,
/// and whether it is a finding rather than a note.
///
/// The timestamp is wall-clock epoch milliseconds rather than a formatted string, so the value type
/// stays testable and the view owns the rider-facing format. Wall clock and not uptime on purpose:
/// this number exists to be read aloud or photographed and matched against a phone log.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `DiagnosticEvent`
struct WatchDiagnosticEvent: Equatable {
  let atMs: Int64
  let text: String
  let warn: Bool
}

/// Watch-local diagnostics for the frame path, as a value.
///
/// The wrist has no adb and no console in the field, so this is the observable half of "why is the
/// Mirror dark": counters plus a small ring of events the rider can read straight off the watch on
/// the diagnostics control page. The split it exists to make is between *frames never arrived* —
/// a phone-side problem — and *frames arrived but did not decode*, which is a phone and a wrist
/// built from different lane counts and is fixed by reinstalling one of them.
///
/// A plain `struct` rather than a singleton object: the wrist has exactly one writer for it already
/// (``PhoneLink``, which publishes it), and a value type is what lets the ring's ordering, its cap,
/// and every streak guard be tested without a UI or a live `WCSession`. Time is always passed in
/// for the same reason.
///
/// In-memory only — it resets with the process, which matches its job of explaining the incident
/// currently on screen rather than keeping a history.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `WatchDiagnostics`
/// @platform-diff Wear OS also counts messages that arrived on an unknown Data Layer path and logs
///   receiver on/off. `WCSession` has no paths and no registration of its own, so the wrist records
///   activation and wake level instead — the two lifecycle facts watchOS actually publishes.
struct WatchDiagnosticsLog: Equatable {
  /// How many events the ring keeps. Enough to cover a reconnect and the flapping that led to it,
  /// short enough to stay scrollable on a wrist.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `MAX_EVENTS`
  static let maxEvents = 50

  /// Frames that arrived and decoded.
  private(set) var framesDecoded = 0
  /// Frames that arrived and did not decode. Repeated failures can indicate a build mismatch.
  private(set) var decodeFailures = 0
  /// Newest first, which is the order a rider reads a wrist in.
  private(set) var events: [WatchDiagnosticEvent] = []

  /// Streak guards. Frames flow at up to 4 Hz, so a per-frame event would push everything else out
  /// of the ring within seconds; only the *start* of a failure streak is worth a line.
  private var inDecodeFailStreak = false
  private var lastLinkLabel: String?
  private var lastWakeLevel: WatchMirrorWakeLevel?

  init() {}

  mutating func recordFrame(nowMs: Int64) {
    if framesDecoded == 0 { record("first frame received", nowMs: nowMs) }
    inDecodeFailStreak = false
    framesDecoded += 1
  }

  /// The first byte of a frame is the sender's lane count (ADR-0018), so it is the one detail that
  /// names the mismatch. `nil` is a payload too short to even have one.
  mutating func recordDecodeFailure(byteCount: Int, lanes: UInt8?, nowMs: Int64) {
    decodeFailures += 1
    guard !inDecodeFailStreak else { return }
    inDecodeFailStreak = true
    record("decode fail \(byteCount)B v\(lanes.map(Int.init) ?? -1)", warn: true, nowMs: nowMs)
  }

  /// Counterpart state, as the diagnostics page words it. Deduplicated on the label so a session
  /// callback that fires without changing anything does not fill the ring.
  mutating func recordLink(_ label: String, nowMs: Int64) {
    guard label != lastLinkLabel else { return }
    lastLinkLabel = label
    record("link \(label)", nowMs: nowMs)
  }

  /// The wrist's own lifecycle, as told to the phone. This is what makes "leaving the app stops the
  /// stream" checkable on the watch rather than only on the phone: the asleep line is written at the
  /// moment the level is sent, so it is already in the ring when the rider comes back.
  mutating func recordWakeLevel(_ level: WatchMirrorWakeLevel, nowMs: Int64) {
    guard level != lastWakeLevel else { return }
    lastWakeLevel = level
    record("wake \(level.label)", nowMs: nowMs)
  }

  /// Radar is the one thing the wrist fetches itself, so its failures are not the phone's and must
  /// not read like a dead link.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchDiagnostics.kt `recordRadarFailure`
  mutating func recordRadarFailure(nowMs: Int64) {
    record("radar fetch failed", warn: true, nowMs: nowMs)
  }

  /// Simulator replay is a dev path, so its state is worth naming: the gauges are not showing a
  /// real ride.
  ///
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
  /// Wire-level names, spelled for the wrist. Not localized: this is an engineering readout the
  /// rider reports verbatim.
  var label: String {
    switch self {
    case .asleep: return "asleep"
    case .active: return "active"
    case .ambient: return "ambient"
    }
  }
}

/// Received or applied frame cadence over five seconds, measured with the wrist's monotonic clock.
/// Read-time expiry makes a stopped stream report zero even when no new frame arrives to prune it.
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
