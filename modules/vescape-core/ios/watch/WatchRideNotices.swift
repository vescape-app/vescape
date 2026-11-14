import Foundation

/// The wrist's view of the phone's Ride Notices: which one the card shows, and when a notice is new
/// enough to buzz. `(id, rev)` is the identity: a pair this app run has not shown yet buzzes, the
/// same pair updated in place does not, and a new `rev` or a reused id buzzes again.
///
/// A tap hides the card on the wrist only (`hide`); the hide lasts until the notice leaves the list
/// or its `rev` changes. Expiry runs on the watch's own wall clock, so a phone that died without
/// clearing its list cannot leave a notice on the wrist past its `expiresAt`.
///
/// Wrist-only; symlinked into `watch/watchos/` and compiled by the phone only for its tests.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRideNotices.kt `WatchRideNotices`
struct WatchRideNotices {
  /// Visible, unexpired notices, most urgent first.
  private(set) var notices: [RideNoticeFrameItem] = []
  private var sentAtMs: Int64?
  /// `rev` already shown per id since app start.
  private var shown: [Int: Int] = [:]
  /// `rev` the rider hid per id.
  private var hidden: [Int: Int] = [:]

  /// The notice the full-screen card shows, or nil for the gauges.
  var card: RideNoticeFrameItem? { notices.first { hidden[$0.id] != $0.rev } }

  /// Take a phone frame. True when it brings a pair not yet shown, i.e. the wrist should buzz. A
  /// frame no newer than the one held is a repeat (the live message and the retained copy carry the
  /// same bytes) or a late delivery of a list already replaced, and is ignored.
  mutating func accept(_ frame: RideNoticeFrame, nowMs: Int64) -> Bool {
    if let sentAtMs, frame.sentAtMs <= sentAtMs { return false }
    sentAtMs = frame.sentAtMs
    notices = frame.notices
    return prune(nowMs: nowMs)
  }

  mutating func hide(id: Int, rev: Int) {
    if notices.contains(where: { $0.id == id && $0.rev == rev }) { hidden[id] = rev }
  }

  /// Drop expired notices and forget hides and shown pairs no longer in the list. True on a new pair.
  @discardableResult
  mutating func prune(nowMs: Int64) -> Bool {
    notices.removeAll { notice in notice.expiresAtMs.map { $0 <= nowMs } ?? false }
    let revs = Dictionary(notices.map { ($0.id, $0.rev) }, uniquingKeysWith: { first, _ in first })
    hidden = hidden.filter { revs[$0.key] == $0.value }
    shown = shown.filter { revs[$0.key] == $0.value }
    let fresh = notices.contains { shown[$0.id] != $0.rev }
    shown.merge(revs) { _, new in new }
    return fresh
  }
}
