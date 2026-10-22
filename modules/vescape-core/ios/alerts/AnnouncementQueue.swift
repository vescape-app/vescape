import Foundation

/// Rank of a queued announcement; the queue plays the lowest rank first, oldest first within one.
/// `ttlMs` is how long an item may wait before it is dropped as stale.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `AnnouncementPriority`
enum AnnouncementPriority: Int {
  /// Board connect, disconnect, connection error.
  case connection
  /// Ride state and, later, weather and battery lines.
  case advisory
  /// Group Ride events.
  case social

  var ttlMs: Int64 {
    switch self {
    case .connection: return 10_000
    case .advisory: return 30_000
    case .social: return 20_000
    }
  }
}

/// Announcement Queue rank of app cue `cue`; nil for an unknown cue.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `appCuePriority`
internal func appCuePriority(_ cue: String) -> AnnouncementPriority? {
  guard appCueSlot(cue) != nil else { return nil }
  switch cue {
  case "on", "off", "error": return .connection
  case "ride.end": return .advisory
  default: return .social
  }
}

/// Quiet time after a connect before anything but a `.connection` item plays.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `ANNOUNCEMENT_SETTLE_MS`
let announcementSettleMs: Int64 = 4_000

/// Gap after the last critical alert sound or line ends before the queue resumes.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/alerts/AnnouncementQueue.kt `ANNOUNCEMENT_QUIET_GAP_MS`
let announcementQuietGapMs: Int64 = 2_000

/// What the queue's host should do next.
enum AnnouncementStep<T> {
  case play(T)
  /// Nothing may play before the time; ask again then.
  case waitUntil(Int64)
  case idle
}

/// The Announcement Queue's pure core: orders non-critical announcements and decides when the next
/// may play. Clock-injected (every call takes `now`) and single-threaded; the host confines it to its
/// audio queue and does the playing.
///
/// - One item at a time: the next plays only after the host reports `finished`.
/// - Critical alert audio (`criticalStarted` / `criticalEnded`) holds the queue, then a
///   `quietGapMs` gap. The item it pre-empted is played again once, unless it expired meanwhile.
/// - `connected` opens a `settleMs` window only connection items play in.
/// - An item past its expiry is dropped, never played late.
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

  /// The item playing now, if any.
  var playing: T? { current?.item }

  func enqueue(_ item: T, priority: AnnouncementPriority, now: Int64, ttlMs: Int64? = nil) {
    pending.append(Entry(item: item, priority: priority, expiresAt: now + (ttlMs ?? priority.ttlMs), seq: seq))
    seq += 1
  }

  func connected(now: Int64) {
    settleUntil = now + settleMs
  }

  /// Critical alert audio started. Returns the queued item playing now, which the host must stop
  /// and report `finished` as `.cancelled`.
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

  /// The playing item ended with `outcome`. Returns it when that outcome is final, or nil when it was
  /// pre-empted and goes back in line.
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

  /// Next step at `now`; expired items go to `onDrop` on the way.
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

  /// Drop everything, the playing item included; returns them so the host can stop and report each.
  func clear() -> [T] {
    let all = (current.map { [$0.item] } ?? []) + pending.map(\.item)
    pending.removeAll()
    current = nil
    settleUntil = Int64.min
    return all
  }
}
