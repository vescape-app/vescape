import Foundation

/// Ordered most urgent first; the order is the sort order.
enum RideNoticeSeverity: String, CaseIterable {
  case critical
  case warning
  case info

  var rank: Int { Self.allCases.firstIndex(of: self)! }
}

struct RideNoticeLocation: Equatable {
  let lat: Double
  let lng: Double
}

/// What a source posts. `postedAt` and `expiresAt` are source-supplied epoch ms.
struct RideNoticeContent: Equatable {
  let severity: RideNoticeSeverity
  let title: String
  let details: String
  let postedAt: Int64
  var location: RideNoticeLocation? = nil
  var expiresAt: Int64? = nil
}

/// One visible Ride Notice. `id` (1–255) and `rev` (1–255, wraps) each fit one byte, so the watch can
/// address and version a notice in a `[kind, value]` command.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notices/RideNoticeEngine.kt `RideNotice`
/// @parity /modules/vescape-core/src/index.ts `RideNotice`
struct RideNotice: Equatable {
  let id: Int
  let rev: Int
  let key: String
  let content: RideNoticeContent

  func toMap() -> [String: Any?] {
    [
      "id": id,
      "rev": rev,
      "key": key,
      "severity": content.severity.rawValue,
      "title": content.title,
      "details": content.details,
      "postedAt": content.postedAt,
      "location": content.location.map { ["lat": $0.lat, "lng": $0.lng] },
      "expiresAt": content.expiresAt,
    ]
  }
}

/// The Ride Notice table. Pure: no clock, no threads, no platform types, so every rule is unit
/// tested. Each mutation reports whether the visible list changed; callers emit only then.
///
/// - A post with the same `revision` updates content in place and keeps a dismissed notice hidden.
///   A new `revision` bumps `rev` and shows it again.
/// - A dismissed notice keeps its key and id until the source clears it or it expires.
/// - Ids are allocated round-robin over 1–255, skipping ids in use; a full table drops the post.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notices/RideNoticeEngine.kt `RideNoticeEngine`
final class RideNoticeEngine {
  enum PostResult { case changed, unchanged, dropped }

  static let maxId = 255

  private struct Entry {
    let id: Int
    var rev: Int
    var revision: String
    var content: RideNoticeContent
    var dismissed: Bool
  }

  private var entries: [String: Entry] = [:]
  private var lastId = 0

  /// Visible notices: severity first, then newest `postedAt`.
  private(set) var active: [RideNotice] = []

  func post(key: String, content: RideNoticeContent, revision: String, nowMs: Int64) -> PostResult {
    if let expiresAt = content.expiresAt, expiresAt <= nowMs {
      return clear(key: key) ? .changed : .unchanged
    }
    if var existing = entries[key] {
      if existing.revision != revision {
        existing.revision = revision
        existing.rev = existing.rev % Self.maxId + 1
        existing.dismissed = false
      }
      existing.content = content
      entries[key] = existing
    } else {
      guard let id = allocateId() else { return .dropped }
      entries[key] = Entry(id: id, rev: 1, revision: revision, content: content, dismissed: false)
    }
    return refresh() ? .changed : .unchanged
  }

  func clear(key: String) -> Bool {
    entries.removeValue(forKey: key) != nil && refresh()
  }

  func dismiss(id: Int) -> Bool {
    guard let key = entries.first(where: { $0.value.id == id && !$0.value.dismissed })?.key else { return false }
    entries[key]?.dismissed = true
    return refresh()
  }

  /// Drops expired notices silently, dismissed or not.
  func tick(nowMs: Int64) -> Bool {
    let before = entries.count
    entries = entries.filter { entry in entry.value.content.expiresAt.map { $0 > nowMs } ?? true }
    return entries.count != before && refresh()
  }

  /// Earliest `expiresAt` in the table, for the caller's next `tick`.
  func nextExpiryAt() -> Int64? {
    entries.values.compactMap(\.content.expiresAt).min()
  }

  private func allocateId() -> Int? {
    let used = Set(entries.values.map(\.id))
    for step in 1...Self.maxId {
      let candidate = (lastId + step - 1) % Self.maxId + 1
      if !used.contains(candidate) {
        lastId = candidate
        return candidate
      }
    }
    return nil
  }

  private func refresh() -> Bool {
    let next = entries
      .filter { !$0.value.dismissed }
      .map { RideNotice(id: $0.value.id, rev: $0.value.rev, key: $0.key, content: $0.value.content) }
      .sorted { a, b in
        if a.content.severity != b.content.severity { return a.content.severity.rank < b.content.severity.rank }
        if a.content.postedAt != b.content.postedAt { return a.content.postedAt > b.content.postedAt }
        return a.id < b.id
      }
    if next == active { return false }
    active = next
    return true
  }
}
