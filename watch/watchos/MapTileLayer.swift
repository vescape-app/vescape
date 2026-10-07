import ImageIO
import SwiftUI

/// Decoded tiles kept in memory. A display shows at most about nine at the wrist's spans.
private let decodedTiles = 12

/// Street-map tiles on the wrist. The phone sends each tile with `transferFile`; the file is moved
/// into `Application Support/map-tiles/<style>/<z>/<x>/<y>.jpg` and kept until the phone's `mapTiles`
/// list stops naming it. Tiles decode on demand off the main thread into a small cache.
///
/// Main-thread state, except `receive`, which runs on the WatchConnectivity delegate queue because
/// the received file is deleted as soon as that callback returns.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MapTileLayer.kt `MapTileState`
/// @platform-diff Wear OS reads tiles from Data Layer Assets and has no list: deleting an item is
///   the drop. Here the files are the wrist's own and the list decides which ones stay.
final class MapTileStore: ObservableObject {
  static let shared = MapTileStore()

  @Published private(set) var held: [WatchMapTile: URL] = [:]
  /// Bumped when a decode lands, so the layer redraws.
  @Published private(set) var decodedVersion = 0
  private var decoded: [WatchMapTile: CGImage] = [:]
  private var recent: [WatchMapTile] = []
  private var decoding = Set<WatchMapTile>()
  private let io = DispatchQueue(label: "app.vescape.watch.map-tiles", qos: .utility)
  private let root: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("map-tiles", isDirectory: true)

  private init() {
    io.async { [root] in
      let found = Self.scan(root)
      DispatchQueue.main.async { self.held.merge(found) { current, _ in current } }
    }
  }

  /// Keep a received file. Called on the delegate queue; the move must finish before it returns.
  func receive(_ file: URL, style: String, tile: WatchMapTile) {
    let target = Self.file(root, style: style, tile: tile)
    do {
      try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      // intentional-suppression: absent on first receipt; a resend replaces the old copy.
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.moveItem(at: file, to: target)
    } catch {
      return
    }
    DispatchQueue.main.async {
      self.held[tile] = target
      self.forget(tile)
    }
  }

  /// The phone's latest list: tiles not on it, and every other style, leave the wrist.
  func retain(_ list: WatchMapTileList) {
    let keep = Set(list.tiles)
    let style = Self.styleName(list.style)
    let dropped = held.filter { !keep.contains($0.key) || $0.value.pathComponents.dropLast(3).last != style }
    for (tile, _) in dropped {
      held[tile] = nil
      forget(tile)
    }
    io.async { [root] in
      for url in dropped.values {
        // intentional-suppression: already gone is the goal.
        try? FileManager.default.removeItem(at: url)
      }
      // Another style's directory would never be listed again.
      let styles = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
      for directory in styles where directory.lastPathComponent != style {
        try? FileManager.default.removeItem(at: directory)
      }
    }
  }

  /// The decoded tile, or nil while it decodes. Safe to call while drawing.
  func image(_ tile: WatchMapTile) -> CGImage? {
    if let image = decoded[tile] { return image }
    guard let url = held[tile], decoding.insert(tile).inserted else { return nil }
    io.async {
      let options = [kCGImageSourceShouldCacheImmediately: true] as CFDictionary
      let image = CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, options) }
      DispatchQueue.main.async {
        self.decoding.remove(tile)
        guard let image, self.held[tile] == url else { return }
        self.decoded[tile] = image
        self.recent.removeAll { $0 == tile }
        self.recent.append(tile)
        while self.recent.count > decodedTiles { self.decoded[self.recent.removeFirst()] = nil }
        self.decodedVersion += 1
      }
    }
    return nil
  }

  private func forget(_ tile: WatchMapTile) {
    decoded[tile] = nil
    recent.removeAll { $0 == tile }
  }

  private static func styleName(_ style: String) -> String { style.replacingOccurrences(of: "/", with: "_") }

  private static func styleDirectory(_ root: URL, _ style: String) -> URL {
    root.appendingPathComponent(styleName(style), isDirectory: true)
  }

  private static func file(_ root: URL, style: String, tile: WatchMapTile) -> URL {
    styleDirectory(root, style).appendingPathComponent("\(tile.key).jpg")
  }

  /// Files kept from an earlier launch: `<style>/<z>/<x>/<y>.jpg`.
  private static func scan(_ root: URL) -> [WatchMapTile: URL] {
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return [:] }
    var found: [WatchMapTile: URL] = [:]
    for case let url as URL in walk where url.pathExtension == "jpg" {
      let parts = url.deletingPathExtension().pathComponents.suffix(3)
      if let tile = WatchMapTile(key: parts.joined(separator: "/")) { found[tile] = url }
    }
    return found
  }
}

/// The dark street map under the trail and route. Each tile's corners are placed as local metres
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
          let visible = store.held.keys
            .compactMap { PlacedTile($0, anchor: anchor, offset: offset) }
            .filter { $0.distanceM <= reachM }
            .sorted { $0.distanceM < $1.distanceM }
            .prefix(decodedTiles)
            .sorted { $0.tile.z < $1.tile.z }
          context.clip(to: Rim.path(in: size, inset: Rim.inset))
          context.translateBy(x: rider.x, y: rider.y)
          context.rotate(by: .degrees(-mapView.courseDeg(at: at)))
          for placed in visible {
            guard let image = store.image(placed.tile) else { continue }
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
