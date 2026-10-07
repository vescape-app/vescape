import Foundation
import WatchConnectivity
import os

/// Street-map tiles over WatchConnectivity. Each tile is a `transferFile` of the cached JPEG with
/// `{style, z, x, y}` metadata; which tiles the wrist should keep is the `mapTiles` list on the
/// merged Application Context (`WatchColdState`, the only writer). What is already delivered is a
/// record of finished transfers in `WCSession.watchDirectoryURL`, which the system wipes when the
/// watch app is reinstalled or the watch unpaired, so a fresh wrist gets every tile again.
///
/// Main-queue confined, like the coordinator that drives it; delegate callbacks and sends hop here,
/// which is what makes the unchecked `Sendable` true.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTilePusher.kt `WatchMapTilePusher`
/// @platform-diff Wear OS keeps one Data Layer item per tile and drops a tile by deleting it; its
///   held set is read back from the Data Layer, so it needs neither a list nor a record.
final class WatchMapTilePusher: WatchMapTileTransport, @unchecked Sendable {
  private static let recordFile = "map-tiles-delivered.json"
  private static let log = Logger(subsystem: "app.vescape.core", category: "WatchMapTiles")

  private let session: () -> WCSession?
  private let putList: ([String: Any]) -> Void
  private var record: Set<WatchMapTile> = []
  private var pending: [WatchMapTile: CheckedContinuation<Bool, Never>] = [:]
  var onWatchReset: (() -> Void)?

  /// `session` is the activated session or nil; `putList` publishes the `mapTiles` channel.
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
    // Transfers an earlier process queued still land, and `finished` records them; counting them
    // keeps them from going out twice. Another style's would never be wanted.
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
    putList(WatchMapTileList(style: MapTiles.style, tiles: wanted).payload)
    guard !dropped.isEmpty else { return }
    // A dropped tile is delivered, or still queued by an earlier process; no send waits on it.
    for transfer in session()?.outstandingFileTransfers ?? [] {
      guard let sent = WatchMapTileTransfer.decode(transfer.file.metadata), dropped.contains(sent.tile) else { continue }
      transfer.cancel()
    }
    record.subtract(dropped)
    saveRecord()
  }

  func send(_ tile: WatchMapTile, jpeg: URL) async -> Bool {
    await withCheckedContinuation { continuation in
      DispatchQueue.main.async { [self] in
        guard let session = session(), session.isWatchAppInstalled else {
          continuation.resume(returning: false)
          return
        }
        pending.removeValue(forKey: tile)?.resume(returning: false)
        pending[tile] = continuation
        session.transferFile(jpeg, metadata: WatchMapTileTransfer.metadata(style: MapTiles.style, tile: tile))
      }
    }
  }

  /// `WCSessionDelegate.sessionWatchStateDidChange` and `sessionDidBecomeInactive`, on any queue. A
  /// reinstall, a re-pair or a switch to another watch wipes the watch directory and the record with
  /// it; the sender must read it again rather than trust its copy.
  func watchStateChanged() {
    DispatchQueue.main.async { [self] in
      failLostSends()
      onWatchReset?()
    }
  }

  /// The system drops outstanding transfers on a reinstall, an unpair or a watch switch without a
  /// `didFinish`. Their sends fail here instead of holding an in-flight slot for good.
  private func failLostSends() {
    let carried = Set((session()?.outstandingFileTransfers ?? []).compactMap { WatchMapTileTransfer.decode($0.file.metadata)?.tile })
    for tile in Array(pending.keys) where !carried.contains(tile) {
      pending.removeValue(forKey: tile)?.resume(returning: false)
    }
  }

  /// `WCSessionDelegate.session(_:didFinish:error:)`, forwarded on any queue. Also lands transfers
  /// queued by an earlier process, which the record must count too.
  func finished(_ transfer: WCSessionFileTransfer, error: Error?) {
    guard let sent = WatchMapTileTransfer.decode(transfer.file.metadata) else { return }
    DispatchQueue.main.async { [self] in
      if error == nil, sent.style == MapTiles.style {
        record.insert(sent.tile)
        saveRecord()
      }
      pending.removeValue(forKey: sent.tile)?.resume(returning: error == nil)
    }
  }

  private func saveRecord() {
    guard let directory = session()?.watchDirectoryURL else { return }
    let payload = WatchMapTileList(style: MapTiles.style, tiles: Array(record)).payload
    do {
      let data = try JSONSerialization.data(withJSONObject: payload)
      try data.write(to: directory.appendingPathComponent(Self.recordFile), options: .atomic)
    } catch {
      // The next launch then resends what it cannot prove delivered; nothing is lost.
      Self.log.warning("Watch map tile record not saved: \(error.localizedDescription)")
    }
  }
}
