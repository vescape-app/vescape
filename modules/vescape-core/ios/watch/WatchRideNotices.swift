import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRideNotices.kt `WatchRideNotices`
struct WatchRideNotices {
  private(set) var notices: [RideNoticeFrameItem] = []
  private var sentAtMs: Int64?
  private var shown: [Int: Int] = [:]
  private var hidden: [Int: Int] = [:]

  var card: RideNoticeFrameItem? { notices.first { hidden[$0.id] != $0.rev } }

  mutating func accept(_ frame: RideNoticeFrame, nowMs: Int64) -> Bool {
    if let sentAtMs, frame.sentAtMs <= sentAtMs { return false }
    sentAtMs = frame.sentAtMs
    notices = frame.notices
    return prune(nowMs: nowMs)
  }

  mutating func hide(id: Int, rev: Int) {
    if notices.contains(where: { $0.id == id && $0.rev == rev }) { hidden[id] = rev }
  }

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
