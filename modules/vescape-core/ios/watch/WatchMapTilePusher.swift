import Foundation
import WatchConnectivity
import os

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTilePusher.kt `WatchMapTilePusher`
/// @platform-diff Wear OS keeps one Data Layer item per tile and drops a tile by deleting it; its
final class WatchMapTilePusher: WatchMapTileTransport, @unchecked Sendable {
  private static let recordFile = "map-tiles-delivered.json"
  private static let log = Logger(subsystem: "app.vescape.core", category: "WatchMapTiles")

  private let session: () -> WCSession?
  private let putList: ([String: Any]) -> Void
  private var record: Set<WatchMapTile> = []
  private var pending: [WatchMapTile: CheckedContinuation<Bool, Never>] = [:]
  private var list = WatchMapTileList(style: MapTiles.style, tiles: [])
  private var superseded = Set<WatchMapTile>()
  var onWatchReset: (() -> Void)?
  var onLost: ((WatchMapTile) -> Void)?

  init(session: @escaping () -> WCSession?, putList: @escaping ([String: Any]) -> Void) {
    self.session = session
    self.putList = putList
  }

  func delivered() -> Set<WatchMapTile>? {
    guard let session = session(), session.isWatchAppInstalled, let directory = session.watchDirectoryURL else { return nil }
    let url = directory.appendingPathComponent(Self.recordFile)
    // intentional-suppression: no record yet (or an unreadable one) means nothing delivered.
    let list = (try? Data(contentsOf: url))
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      .flatMap(WatchMapTileList.decode)
    record = list?.style == MapTiles.style ? Set(list?.tiles ?? []) : []
    failLostSends()
    var queued = Set<WatchMapTile>()
    for transfer in session.outstandingFileTransfers {
      guard let sent = WatchMapTileTransfer.decode(transfer.file.metadata) else { continue }
      if sent.style != MapTiles.style {
        transfer.cancel()
      } else if pending[sent.tile] == nil {
        queued.insert(sent.tile)
      }
    }
    return record.union(queued)
  }

  func hold(wanted: [WatchMapTile], dropped: Set<WatchMapTile>) {
    let generation = max(list.generation + 1, Int64(Date().timeIntervalSince1970 * 1000))
    list = WatchMapTileList(style: MapTiles.style, tiles: wanted, generation: generation)
    putList(list.payload)
    let listed = Set(wanted)
    superseded.formUnion(pending.keys.filter { !listed.contains($0) })
    for transfer in session()?.outstandingFileTransfers ?? [] {
      guard let sent = WatchMapTileTransfer.decode(transfer.file.metadata), !listed.contains(sent.tile) else { continue }
      superseded.insert(sent.tile)
      if dropped.contains(sent.tile) { transfer.cancel() }
    }
    guard !dropped.isEmpty else { return }
    record.subtract(dropped)
    saveRecord()
  }

  func send(_ tile: WatchMapTile, jpeg: URL) async -> Bool {
    await withCheckedContinuation { continuation in
      DispatchQueue.main.async { [self] in
        guard let session = session(), session.isWatchAppInstalled, list.tiles.contains(tile) else {
          continuation.resume(returning: false)
          return
        }
        pending.removeValue(forKey: tile)?.resume(returning: false)
        let outstanding = session.outstandingFileTransfers.compactMap { WatchMapTileTransfer.decode($0.file.metadata)?.tile }
        if !outstanding.contains(tile) { superseded.remove(tile) }
        pending[tile] = continuation
        session.transferFile(
          jpeg, metadata: WatchMapTileTransfer.metadata(style: MapTiles.style, tile: tile, generation: list.generation))
      }
    }
  }

  func watchStateChanged() {
    DispatchQueue.main.async { [self] in
      failLostSends()
      onWatchReset?()
    }
  }

  private func failLostSends() {
    let carried = Set((session()?.outstandingFileTransfers ?? []).compactMap { WatchMapTileTransfer.decode($0.file.metadata)?.tile })
    for tile in Array(pending.keys) where !carried.contains(tile) {
      pending.removeValue(forKey: tile)?.resume(returning: false)
    }
  }

  func finished(_ transfer: WCSessionFileTransfer, error: Error?) {
    guard let sent = WatchMapTileTransfer.decode(transfer.file.metadata) else { return }
    DispatchQueue.main.async { [self] in
      let landed = error == nil && superseded.remove(sent.tile) == nil
      if landed, sent.style == MapTiles.style {
        record.insert(sent.tile)
        saveRecord()
      }
      if let continuation = pending.removeValue(forKey: sent.tile) {
        continuation.resume(returning: landed)
      } else if !landed {
        onLost?(sent.tile)
      }
    }
  }

  private func saveRecord() {
    guard let directory = session()?.watchDirectoryURL else { return }
    let payload = WatchMapTileList(style: MapTiles.style, tiles: Array(record)).payload
    do {
      let data = try JSONSerialization.data(withJSONObject: payload)
      try data.write(to: directory.appendingPathComponent(Self.recordFile), options: .atomic)
    } catch {
      Self.log.warning("Watch map tile record not saved: \(error.localizedDescription)")
    }
  }
}
