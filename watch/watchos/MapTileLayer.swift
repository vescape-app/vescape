import ImageIO
import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MapTileLayer.kt `MapTileState`
/// @platform-diff Wear OS reads tiles from Data Layer Assets and has no list: deleting an item is
///   the drop. Here the files are the wrist's own and the list decides which ones stay.
@MainActor
final class MapTileStore: ObservableObject {
  nonisolated static let shared = MapTileStore()
  private static let decodeRetry: TimeInterval = 10

  @Published private(set) var held: [WatchMapTile: URL] = [:]
  @Published private(set) var decodedVersion = 0
  private var decoded = WatchMapTileCache<CGImage>()
  private var decoding = Set<WatchMapTile>()
  private var failedAt: [WatchMapTile: Date] = [:]
  private var list: WatchMapTileList?
  var zoom: Int?
  private let io = DispatchQueue(label: "app.vescape.watch.map-tiles", qos: .utility)
  private let root: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("map-tiles", isDirectory: true)

  private nonisolated init() {
    io.async { [root] in
      let found = Self.scan(root)
      DispatchQueue.main.async {
        self.held.merge(found) { current, _ in current }
        if let list = self.list { self.retain(list) }
      }
    }
  }

  nonisolated func receive(_ file: URL, style: String, tile: WatchMapTile, generation: Int64) {
    let target = Self.file(root, style: style, tile: tile)
    do {
      try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      try FileManager.default.moveItem(at: file, to: target)
    } catch {
      return
    }
    DispatchQueue.main.async {
      if self.list?.supersedes(style: style, tile: tile, generation: generation) == true {
        self.delete([target])
        return
      }
      let replaced = self.held.updateValue(target, forKey: tile)
      self.forget(tile)
      if let replaced { self.delete([replaced]) }
    }
  }

  func retain(_ list: WatchMapTileList) {
    self.list = list
    let keep = Set(list.tiles)
    let style = Self.styleName(list.style)
    let dropped = held.filter { !keep.contains($0.key) || $0.value.pathComponents.dropLast(3).last != style }
    for (tile, _) in dropped {
      held[tile] = nil
      forget(tile)
    }
    delete(Array(dropped.values))
    io.async { [root] in
      let styles = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
      for directory in styles where directory.lastPathComponent != style {
        try? FileManager.default.removeItem(at: directory)
      }
    }
  }

  func frame(_ cells: [WatchMapTile]) -> WatchMapTileFrame {
    let frame = decoded.frame(cells: cells, held: Set(held.keys))
    let now = Date()
    for tile in frame.missing {
      if let failed = failedAt[tile], now.timeIntervalSince(failed) < Self.decodeRetry { continue }
      decode(tile)
    }
    return frame
  }

  func image(_ tile: WatchMapTile) -> CGImage? { decoded.image(tile) }

  private func decode(_ tile: WatchMapTile) {
    guard let url = held[tile], decoding.insert(tile).inserted else { return }
    io.async {
      let options = [kCGImageSourceShouldCacheImmediately: true] as CFDictionary
      let image = CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, options) }
      DispatchQueue.main.async {
        self.decoding.remove(tile)
        guard self.held[tile] == url else {
          self.decodedVersion += 1
          return
        }
        guard let image else {
          self.failedAt[tile] = Date()
          return
        }
        self.decoded.put(tile, image)
        self.decodedVersion += 1
      }
    }
  }

  private func forget(_ tile: WatchMapTile) {
    decoded.remove(tile)
    failedAt[tile] = nil
  }

  private func delete(_ urls: [URL]) {
    guard !urls.isEmpty else { return }
    io.async {
      // intentional-suppression: already gone is the goal.
      for url in urls { try? FileManager.default.removeItem(at: url) }
    }
  }

  private nonisolated static func styleName(_ style: String) -> String { style.replacingOccurrences(of: "/", with: "_") }

  private nonisolated static func styleDirectory(_ root: URL, _ style: String) -> URL {
    root.appendingPathComponent(styleName(style), isDirectory: true)
  }

  private nonisolated static func file(_ root: URL, style: String, tile: WatchMapTile) -> URL {
    styleDirectory(root, style).appendingPathComponent("\(tile.key)-\(UUID().uuidString).jpg")
  }

  private nonisolated static func scan(_ root: URL) -> [WatchMapTile: URL] {
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return [:] }
    var found: [WatchMapTile: URL] = [:]
    for case let url as URL in walk where url.pathExtension == "jpg" {
      let parts = url.deletingPathExtension().pathComponents.suffix(3)
      guard let y = parts.last?.split(separator: "-", maxSplits: 1).first,
        let tile = WatchMapTile(key: (parts.dropLast() + [String(y)]).joined(separator: "/"))
      else { continue }
      if found[tile] == nil {
        found[tile] = url
      } else {
        // intentional-suppression: a duplicate left behind is retried on the next launch.
        try? FileManager.default.removeItem(at: url)
      }
    }
    return found
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MapTileLayer.kt `MapTileLayer`
struct MapTileLayer: View {
  let mapView: WatchMapView
  let mapMoving: Bool
  @ObservedObject private var store = MapTileStore.shared

  var body: some View {
    if !store.held.isEmpty {
      TimelineView(.animation(paused: !mapMoving)) { timeline in
        let at = mapMoving ? timeline.date : .distantFuture
        Canvas { context, size in
          _ = store.decodedVersion
          guard let anchor = mapView.motion.position else { return }
          let offset = mapView.motion.offset(at: at)
          let rider = WatchMapProjection.riderPoint(in: size)
          let scale = WatchMapProjection.pointsPerMetre(size: size, spanM: mapView.spanM(at: at))
          let reachM = hypot(size.width, size.height) / scale
          let zoom = WatchMapTile.zoom(spanM: mapView.spanM(at: at), latitude: anchor.latitude, current: store.zoom)
          store.zoom = zoom
          let cells = WatchMapTile.cells(held: store.held.keys, zoom: zoom)
            .compactMap { PlacedTile($0, anchor: anchor, offset: offset) }
            .filter { $0.distanceM <= reachM }
            .sorted { $0.distanceM < $1.distanceM }
            .prefix(watchMapDecodedTiles)
            .map(\.tile)
          let frame = store.frame(cells)
          context.clip(to: Rim.path(in: size, inset: Rim.inset))
          context.translateBy(x: rider.x, y: rider.y)
          context.rotate(by: .degrees(-mapView.courseDeg(at: at)))
          for tile in frame.draw {
            guard let image = store.image(tile), let placed = PlacedTile(tile, anchor: anchor, offset: offset) else { continue }
            let rect = CGRect(
              x: placed.westM * scale - 0.5, y: -placed.northM * scale - 0.5,
              width: (placed.eastM - placed.westM) * scale + 1, height: (placed.northM - placed.southM) * scale + 1)
            context.draw(Image(decorative: image, scale: 1), in: rect)
          }
        }
      }
      .allowsHitTesting(false)
    }
  }
}

private struct PlacedTile {
  let tile: WatchMapTile
  let westM: Double
  let northM: Double
  let eastM: Double
  let southM: Double

  init?(_ tile: WatchMapTile, anchor: WatchMapPosition, offset: WatchTrailPoint) {
    let northWest = tile.northWest.offset(from: anchor)
    let southEast = tile.southEast.offset(from: anchor)
    guard southEast.eastM > northWest.eastM else { return nil }
    self.tile = tile
    westM = northWest.eastM + offset.eastM
    northM = northWest.northM + offset.northM
    eastM = southEast.eastM + offset.eastM
    southM = southEast.northM + offset.northM
  }

  var distanceM: Double { hypot(min(max(0, westM), eastM), min(max(0, southM), northM)) }
}
