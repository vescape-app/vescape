import Foundation

/// A roster Rider as `RiderSignalNotices` sees it.
internal struct SignalRider {
  let id: String
  let name: String
  let signal: RiderSignal?
}

/// Maps the joined ride's roster to the Ride Notices of other Riders' active signals, one per Rider
/// under `riderSignal:<riderId>`. Pure: the observer applies the returned `Update` to `RideNotices`.
///
/// Signal times are relay epoch ms; notices run on the phone clock. Each signal is converted once,
/// when its `startedAt` is first seen, with the offset `localNow - relayNow` of that roster (no
/// offset when the roster has no `now`). Pinning keeps a re-sent roster an identical, no-op post
/// instead of jittering by network latency. `revision = startedAt`: a new kind or a re-send shows a
/// dismissed notice again, a rename does not.
///
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

  /// Rider id → the local times of the signal its notice was posted for.
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

  /// The ride is over for this rider: every posted notice key, to clear.
  mutating func reset() -> [String] {
    defer { posted = [:] }
    return posted.keys.sorted().map(Self.key)
  }

  static func key(_ riderId: String) -> String { "riderSignal:" + riderId }

  private static func content(_ name: String, _ signal: RiderSignal, _ pinned: Pinned) -> RideNoticeContent {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return RideNoticeContent(
      severity: signal.kind.severity,
      title: "\(trimmed.isEmpty ? "Rider" : name): \(signal.kind.label)",
      // The card renders "N min ago" from postedAt.
      details: "",
      postedAt: pinned.postedAt,
      location: RideNoticeLocation(lat: signal.lat, lng: signal.lng),
      expiresAt: pinned.expiresAt
    )
  }
}
