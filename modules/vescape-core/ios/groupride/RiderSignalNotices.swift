import Foundation

internal struct SignalRider {
  let id: String
  let name: String
  let signal: RiderSignal?
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignalNotices.kt `RiderSignalNotices`
internal struct RiderSignalNotices {
  struct Post: Equatable {
    let key: String
    let content: RideNoticeContent
    let revision: String
  }

  struct Update: Equatable {
    let posts: [Post]
    let clears: [String]
  }

  private struct Pinned {
    let startedAt: Int64
    let postedAt: Int64
    let expiresAt: Int64
  }

  private var posted: [String: Pinned] = [:]

  mutating func roster(_ riders: [SignalRider], ownRiderId: String?, relayNow: Int64?, localNow: Int64) -> Update {
    let offset = relayNow.map { localNow - $0 } ?? 0
    var posts: [Post] = []
    var active = Set<String>()
    for rider in riders {
      guard let signal = rider.signal, rider.id != ownRiderId else { continue }
      let pinned =
        posted[rider.id].flatMap { $0.startedAt == signal.startedAt ? $0 : nil }
        ?? Pinned(startedAt: signal.startedAt, postedAt: signal.startedAt + offset, expiresAt: signal.expiresAt + offset)
      posted[rider.id] = pinned
      active.insert(rider.id)
      posts.append(Post(key: Self.key(rider.id), content: Self.content(rider.name, signal, pinned), revision: String(signal.startedAt)))
    }
    let gone = posted.keys.filter { !active.contains($0) }.sorted()
    for id in gone { posted[id] = nil }
    return Update(posts: posts, clears: gone.map(Self.key))
  }

  mutating func reset() -> [String] {
    defer { posted = [:] }
    return posted.keys.sorted().map(Self.key)
  }

  /// @parity /src/modules/group-ride/lib/riderSignalNotice.ts `KEY_PREFIX`
  static func key(_ riderId: String) -> String { "riderSignal:" + riderId }

  private static func content(_ name: String, _ signal: RiderSignal, _ pinned: Pinned) -> RideNoticeContent {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return RideNoticeContent(
      severity: signal.kind.severity,
      title: "\(trimmed.isEmpty ? "Rider" : name): \(signal.kind.label)",
      details: "",
      postedAt: pinned.postedAt,
      location: RideNoticeLocation(lat: signal.lat, lng: signal.lng),
      expiresAt: pinned.expiresAt
    )
  }
}
