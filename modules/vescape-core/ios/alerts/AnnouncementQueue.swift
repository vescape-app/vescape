import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `AnnouncementPriority`
enum AnnouncementPriority: Int {
  case connection
  case advisory
  case social

  var ttlMs: Int64 {
    switch self {
    case .connection: return 10_000
    case .advisory: return 30_000
    case .social: return 20_000
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `appCuePriority`
internal func appCuePriority(_ cue: String) -> AnnouncementPriority? {
  guard appCueSlot(cue) != nil else { return nil }
  switch cue {
  case "on", "off", "error": return .connection
  case "ride.end": return .advisory
  default: return isSafetyCue(cue) ? .advisory : .social
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `isSafetyCue`
internal func isSafetyCue(_ cue: String) -> Bool {
  cue.hasPrefix("groupRide.signal.") || cue.hasPrefix(RideHazardCues.cuePrefix)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `appCueSpeaks`
internal func appCueSpeaks(_ cue: String, voiceLevel: String) -> Bool {
  isSafetyCue(cue) ? voiceLevel != "off" : voiceLevel == "full"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `ANNOUNCEMENT_SETTLE_MS`
let announcementSettleMs: Int64 = 4_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `ANNOUNCEMENT_QUIET_GAP_MS`
let announcementQuietGapMs: Int64 = 2_000

enum AnnouncementStep<T> {
  case play(T)
  case waitUntil(Int64)
  case idle
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `AnnouncementQueue`
final class AnnouncementQueue<T: AnyObject> {
  private final class Entry {
    let item: T
    let priority: AnnouncementPriority
    let expiresAt: Int64
    let seq: Int64
    var requeued = false
    var preempted = false

    init(item: T, priority: AnnouncementPriority, expiresAt: Int64, seq: Int64) {
      self.item = item
      self.priority = priority
      self.expiresAt = expiresAt
      self.seq = seq
    }
  }

  private let settleMs: Int64
  private let quietGapMs: Int64
  private var pending: [Entry] = []
  private var current: Entry?
  private var seq: Int64 = 0
  private var critical = 0
  private var settleUntil = Int64.min
  private var quietUntil = Int64.min

  init(settleMs: Int64 = announcementSettleMs, quietGapMs: Int64 = announcementQuietGapMs) {
    self.settleMs = settleMs
    self.quietGapMs = quietGapMs
  }

  var playing: T? { current?.item }

  func enqueue(_ item: T, priority: AnnouncementPriority, now: Int64, ttlMs: Int64? = nil) {
    pending.append(Entry(item: item, priority: priority, expiresAt: now + (ttlMs ?? priority.ttlMs), seq: seq))
    seq += 1
  }

  func connected(now: Int64) {
    settleUntil = now + settleMs
  }

  func criticalStarted() -> T? {
    critical += 1
    current?.preempted = true
    return current?.item
  }

  func criticalEnded(now: Int64) {
    guard critical > 0 else { return }
    critical -= 1
    if critical == 0 { quietUntil = now + quietGapMs }
  }

  func finished(_ outcome: PlaybackOutcome, now: Int64) -> T? {
    guard let entry = current else { return nil }
    current = nil
    if outcome == .cancelled, entry.preempted, !entry.requeued, entry.expiresAt > now {
      entry.requeued = true
      entry.preempted = false
      pending.append(entry)
      return nil
    }
    return entry.item
  }

  func next(now: Int64, onDrop: (T) -> Void) -> AnnouncementStep<T> {
    let expired = pending.filter { $0.expiresAt <= now }
    pending.removeAll { $0.expiresAt <= now }
    expired.forEach { onDrop($0.item) }
    guard current == nil, critical == 0 else { return .idle }
    guard let head = pending.min(by: { ($0.priority.rawValue, $0.seq) < ($1.priority.rawValue, $1.seq) }) else {
      return .idle
    }
    let settling = head.priority != .connection && now < settleUntil
    let blockedUntil = max(quietUntil, settling ? settleUntil : Int64.min)
    if now < blockedUntil {
      return .waitUntil(min(blockedUntil, pending.map(\.expiresAt).min() ?? blockedUntil))
    }
    pending.removeAll { $0 === head }
    current = head
    return .play(head.item)
  }

  func clear() -> [T] {
    let all = (current.map { [$0.item] } ?? []) + pending.map(\.item)
    pending.removeAll()
    current = nil
    settleUntil = Int64.min
    return all
  }
}
