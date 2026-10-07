import Foundation

/// How each platform puts tiles on the wrist and records which ones are there. The wrist never
/// reports its holdings (ADR-0019, ADR-0033), so the phone's own record is the truth. Called on the
/// sender's scheduler.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTileSender.kt `WatchMapTileTransport`
protocol WatchMapTileTransport: AnyObject {
  /// Tiles of the current style the wrist already holds; nil while that cannot be known yet.
  func delivered() -> Set<WatchMapTile>?
  /// The wrist should hold `wanted`; `dropped` leave it. Calls arrive in plan order.
  func hold(wanted: [WatchMapTile], dropped: Set<WatchMapTile>)
  /// Sends one tile's JPEG unchanged. True once the wrist is known to have it.
  func send(_ tile: WatchMapTile, jpeg: URL) async -> Bool
  /// Called when what the wrist holds may have been wiped (a reinstall or re-pair).
  var onWatchReset: (() -> Void)? { get set }
  /// Called when a transfer an earlier process left queued, which `delivered()` counted, fails: the
  /// tile is not on the wrist after all.
  var onLost: ((WatchMapTile) -> Void)? { get set }
}

/// Phone-owned street map for the wrist (#551): plans the wanted tiles with `WatchMapTilePlanner`,
/// downloads them through the shared `MapTiles` cache (`fetch`) and sends the missing ones nearest
/// first, at most `maxSendsInFlight` at a time. State is confined to `scheduler`; downloads and
/// transfers run off it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTileSender.kt `WatchMapTileSender`
/// @platform-diff `delivered()` is a synchronous read of the transfer record here; Android's is a
///   Data Layer query, so it loads asynchronously. A reinstalled watch app loses its files and the
///   record here, so `onWatchReset` re-reads it; Data Layer items outlive a Wear reinstall. A
///   transfer queued by an earlier process counts as delivered until `onLost` says it failed; a Data
///   Layer put is done when `send` returns.
final class WatchMapTileSender {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTileSender.kt `WATCH_MAP_TILE_MAX_SENDS_IN_FLIGHT`
  static let maxSendsInFlight = 4
  /// A tile whose download or send failed waits this long before it is tried again.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTileSender.kt `WATCH_MAP_TILE_RETRY_MS`
  static let retryMs: Int64 = 30_000

  private let scheduler: Scheduler
  private let nowMs: () -> Int64
  private let fetch: @Sendable (WatchMapTile) async -> URL?
  private let transport: WatchMapTileTransport
  private let planner = WatchMapTilePlanner()
  private var active = false
  private var delivered: Set<WatchMapTile>?
  private var holdPending = false
  private var inFlight = Set<WatchMapTile>()
  private var failedAtMs: [WatchMapTile: Int64] = [:]

  init(
    scheduler: Scheduler, nowMs: @escaping () -> Int64,
    fetch: @escaping @Sendable (WatchMapTile) async -> URL?, transport: WatchMapTileTransport
  ) {
    self.scheduler = scheduler
    self.nowMs = nowMs
    self.fetch = fetch
    self.transport = transport
    transport.onWatchReset = { [weak self] in
      self?.scheduler.post { [weak self] in self?.delivered = nil }
    }
    transport.onLost = { [weak self] tile in
      self?.scheduler.post { [weak self] in self?.lost(tile) }
    }
  }

  /// One watch tick. A nil `rider` pauses sending: the wrist is asleep, in ambient or out of reach,
  /// or there is no GPS fix. Sends already in flight finish; nothing new starts.
  func update(_ rider: WatchMapRider?) {
    guard let rider else {
      active = false
      return
    }
    if !active {
      // A wrist coming back may have been reinstalled or reset; ask again what it holds.
      active = true
      delivered = nil
    }
    if delivered == nil {
      guard let known = transport.delivered() else { return }
      delivered = known
      // Tiles left from an older plan or session leave with the next hold.
      holdPending = true
    }
    if planner.update(rider) || holdPending {
      holdPending = false
      let wanted = planner.wanted.map(\.tile)
      let wantedSet = Set(wanted)
      let dropped = (delivered ?? []).subtracting(wantedSet)
      delivered?.subtract(dropped)
      failedAtMs = failedAtMs.filter { wantedSet.contains($0.key) }
      transport.hold(wanted: wanted, dropped: dropped)
    }
    pump()
  }

  private func pump() {
    guard active, let delivered else { return }
    let now = nowMs()
    for need in planner.wanted {
      if inFlight.count >= Self.maxSendsInFlight { return }
      let tile = need.tile
      if delivered.contains(tile) || inFlight.contains(tile) { continue }
      if let failedAt = failedAtMs[tile], now - failedAt < Self.retryMs { continue }
      inFlight.insert(tile)
      let fetch = fetch
      let transport = transport
      Task.detached { [weak self] in
        var sent = false
        if let jpeg = await fetch(tile) { sent = await transport.send(tile, jpeg: jpeg) }
        self?.scheduler.post { [weak self] in self?.landed(tile, sent: sent) }
      }
    }
  }

  /// A tile counted delivered that never arrived goes out again after the usual retry wait.
  private func lost(_ tile: WatchMapTile) {
    guard delivered?.remove(tile) != nil else { return }
    failedAtMs[tile] = nowMs()
    pump()
  }

  private func landed(_ tile: WatchMapTile, sent: Bool) {
    inFlight.remove(tile)
    let wanted = planner.wanted.map(\.tile)
    if !sent {
      failedAtMs[tile] = nowMs()
    } else if wanted.contains(tile) {
      delivered?.insert(tile)
    } else {
      // The plan moved on while it was in flight: take it straight back off the wrist.
      transport.hold(wanted: wanted, dropped: [tile])
    }
    pump()
  }
}
