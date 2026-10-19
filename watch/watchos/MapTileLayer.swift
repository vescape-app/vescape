import ImageIO
import SwiftUI

/// Street-map tiles on the wrist. The phone sends each tile with `transferFile`; each receipt is
/// moved to its own file, `Application Support/map-tiles/<style>/<z>/<x>/<y>-<receipt>.jpg`, and kept
/// until the phone's `mapTiles` list stops naming the tile. A receipt that list already dropped (it
/// was in flight when the plan moved on) is deleted on arrival; one sent under a list not yet here
/// waits for it (`WatchMapTileList.supersedes`). A file is only ever deleted by the URL it
/// was held under, so a drop cannot delete a resend of the same tile that landed after it. Tiles
/// decode on demand off the main thread into a small cache (`WatchMapTileCache`).
///
/// Main-thread state, except `receive`, which runs on the WatchConnectivity delegate queue because
/// the received file is deleted as soon as that callback returns.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MapTileLayer.kt `MapTileState`
/// @platform-diff Wear OS reads tiles from Data Layer Assets and has no list: deleting an item is
///   the drop. Here the files are the wrist's own and the list decides which ones stay.
final class MapTileStore: ObservableObject {
  static let shared = MapTileStore()
  /// A tile that failed to read or decode waits this long before it is tried again.
  private static let decodeRetry: TimeInterval = 10

  @Published private(set) var held: [WatchMapTile: URL] = [:]
  /// Bumped when a decode lands, so the layer redraws.
  @Published private(set) var decodedVersion = 0
  private var decoded = WatchMapTileCache<CGImage>()
  private var decoding = Set<WatchMapTile>()
  private var failedAt: [WatchMapTile: Date] = [:]
  /// The phone's last list, applied again once the launch scan has merged.
  private var list: WatchMapTileList?
  /// The level the display draws at, held with the phone planner's hysteresis.
  var zoom: Int?
  private let io = DispatchQueue(label: "app.vescape.watch.map-tiles", qos: .utility)
  private let root: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("map-tiles", isDirectory: true)

  private init() {
    io.async { [root] in
      let found = Self.scan(root)
      DispatchQueue.main.async {
        self.held.merge(found) { current, _ in current }
        // A list applied before the scan merged saw none of these files.
        if let list = self.list { self.retain(list) }
      }
    }
  }

  /// Keep a received file. Called on the delegate queue; the move must finish before it returns.
  func receive(_ file: URL, style: String, tile: WatchMapTile, generation: Int64) {
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

  /// The phone's latest list: tiles not on it, and every other style, leave the wrist.
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
      // Another style's directory would never be listed again.
      let styles = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
      for directory in styles where directory.lastPathComponent != style {
        try? FileManager.default.removeItem(at: directory)
      }
    }
  }

  /// Lays out a frame and starts decoding what it waits on. Safe to call while drawing.
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
        // A resend replaced the file mid-decode: redraw to read the new one.
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

  /// On `io`, after any decode already reading them.
  private func delete(_ urls: [URL]) {
    guard !urls.isEmpty else { return }
    io.async {
      // intentional-suppression: already gone is the goal.
      for url in urls { try? FileManager.default.removeItem(at: url) }
    }
  }

  private static func styleName(_ style: String) -> String { style.replacingOccurrences(of: "/", with: "_") }

  private static func styleDirectory(_ root: URL, _ style: String) -> URL {
    root.appendingPathComponent(styleName(style), isDirectory: true)
  }

  /// A fresh file per receipt, so no two receipts of a tile share a path.
  private static func file(_ root: URL, style: String, tile: WatchMapTile) -> URL {
    styleDirectory(root, style).appendingPathComponent("\(tile.key)-\(UUID().uuidString).jpg")
  }

  /// Files kept from an earlier launch: `<style>/<z>/<x>/<y>-<receipt>.jpg`. A second file for a
  /// tile (a resend whose old copy was never deleted) is removed.
  private static func scan(_ root: URL) -> [WatchMapTile: URL] {
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

/// The dark street map under the trail and route, at the level `WatchMapTile.zoom` picks for the
/// eased span. Each cell shows its own tile, else the matching quarter of the one-zoom-out tile, else
/// the one-zoom-in tiles a zoom-out left (`WatchMapTileCache.frame`), so a zoom change never blanks the
/// display. Each tile's corners are placed as local metres
/// from the rider's absolute position, then drawn with the same span, course and position motion as
/// the trail, so the streets stay under the line through a zoom or a turn. Within 2 km the tile is
/// flat enough to draw as one transformed image.
///
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
          // Anything further from the rider than the display diagonal is off screen at any course.
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
            // Half a point of overlap hides the seam filtering leaves between neighbours.
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

/// Tile edges as metres east/north of the rider, including the camera's pending motion.
private struct PlacedTile {
  let tile: WatchMapTile
  let westM: Double
  let northM: Double
  let eastM: Double
  let southM: Double

  /// Nil for a tile half a world away, whose edges wrap to opposite sides.
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

  /// Nearest point of the tile to the rider.
  var distanceM: Double { hypot(min(max(0, westM), eastM), min(max(0, southM), northM)) }
}
