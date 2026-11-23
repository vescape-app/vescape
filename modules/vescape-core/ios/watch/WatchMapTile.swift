import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapTile`
struct WatchMapTile: Hashable {
  let z: Int
  let x: Int
  let y: Int

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WATCH_RADAR_TILE_ZOOM`
  static let radarZoom = 6

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `tileCoordinates`
  static func coordinates(_ position: WatchMapPosition, n: Int) -> (Double, Double) {
    let latitude = clampedLatitude(position.latitude) * .pi / 180
    let x = (position.longitude + 180) / 360 * Double(n)
    let y = (1 - log(tan(latitude) + 1 / cos(latitude)) / .pi) / 2 * Double(n)
    let limit = Double(n) - 1e-9
    return (min(max(x, 0), limit), min(max(y, 0), limit))
  }

  var key: String { "\(z)/\(x)/\(y)" }

  var northWest: WatchMapPosition { corner(x, y) }
  var southEast: WatchMapPosition { corner(x + 1, y + 1) }

  var parent: WatchMapTile? { z == 0 ? nil : WatchMapTile(z: z - 1, x: x >> 1, y: y >> 1) }

  var children: [WatchMapTile] {
    [(0, 0), (1, 0), (0, 1), (1, 1)].map { WatchMapTile(z: z + 1, x: 2 * x + $0.0, y: 2 * y + $0.1) }
  }

  private func corner(_ tx: Int, _ ty: Int) -> WatchMapPosition {
    let n = Double(1 << z)
    return WatchMapPosition(
      latitude: atan(sinh(.pi * (1 - 2 * Double(ty) / n))) * 180 / .pi,
      longitude: Double(tx) / n * 360 - 180
    )
  }

  var isValid: Bool { (0...30).contains(z) && (0..<(1 << z)).contains(x) && (0..<(1 << z)).contains(y) }
}

extension WatchMapTile {
  init?(key: String) {
    let parts = key.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 3, let z = Int(parts[0]), let x = Int(parts[1]), let y = Int(parts[2]) else { return nil }
    self.init(z: z, x: x, y: y)
    guard isValid else { return nil }
  }
}

extension WatchMapTile {
  static let referenceWidthPx = 480.0
  static let maxUpscale = 1.3
  static let zoomHysteresis = 1.15
  static let zoom0MetresPerPixel = 78_271.517
  static let maxMercatorLatitude = 85.051_128

  static func clampedLatitude(_ latitude: Double) -> Double {
    min(maxMercatorLatitude, max(-maxMercatorLatitude, latitude))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `watchMapTileZoom`
  static func zoom(spanM: Double?, latitude: Double, current: Int?) -> Int {
    let metresPerPixel = WatchMapProjection.clampedSpanM(spanM) / referenceWidthPx
    let groundPerPixel = zoom0MetresPerPixel * cos(clampedLatitude(latitude) * .pi / 180)
    func lowest(_ upscale: Double) -> Int {
      max(0, Int(ceil(log2(groundPerPixel / (upscale * metresPerPixel)))))
    }
    if let current, (lowest(maxUpscale * zoomHysteresis)...lowest(maxUpscale / zoomHysteresis)).contains(current) {
      return current
    }
    return lowest(maxUpscale)
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `watchMapTileCells`
  static func cells<Held: Sequence>(held: Held, zoom: Int) -> Set<WatchMapTile> where Held.Element == WatchMapTile {
    var cells = Set<WatchMapTile>()
    for tile in held {
      switch tile.z {
      case zoom: cells.insert(tile)
      case zoom - 1: cells.formUnion(tile.children)
      case zoom + 1: if let parent = tile.parent { cells.insert(parent) }
      default: break
      }
    }
    return cells
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WATCH_MAP_DECODED_TILES`
let watchMapDecodedTiles = 12

struct WatchMapTileFrame {
  let draw: [WatchMapTile]
  let missing: [WatchMapTile]
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapTileCache`
struct WatchMapTileCache<Image> {
  private var decoded: [WatchMapTile: Image] = [:]
  private var recent: [WatchMapTile] = []
  private var pinned = Set<WatchMapTile>()

  mutating func image(_ tile: WatchMapTile) -> Image? {
    guard let image = decoded[tile] else { return nil }
    touch(tile)
    return image
  }

  mutating func put(_ tile: WatchMapTile, _ image: Image) {
    decoded[tile] = image
    touch(tile)
    var index = 0
    while recent.count > watchMapDecodedTiles, index < recent.count {
      if pinned.contains(recent[index]) {
        index += 1
      } else {
        decoded[recent.remove(at: index)] = nil
      }
    }
  }

  mutating func remove(_ tile: WatchMapTile) {
    decoded[tile] = nil
    recent.removeAll { $0 == tile }
  }

  mutating func frame(cells: [WatchMapTile], held: Set<WatchMapTile>) -> WatchMapTileFrame {
    var draw: [WatchMapTile] = []
    var wanted: [WatchMapTile] = []
    var seen = Set<WatchMapTile>()
    var waited = Set<WatchMapTile>()
    func add(_ tile: WatchMapTile) { if seen.insert(tile).inserted { draw.append(tile) } }
    func want(_ tile: WatchMapTile) { if waited.insert(tile).inserted { wanted.append(tile) } }
    for cell in cells {
      let parent = cell.parent
      if held.contains(cell) {
        want(cell)
      } else if let parent, held.contains(parent) {
        want(parent)
      } else {
        cell.children.filter(held.contains).forEach(want)
      }
      if decoded[cell] != nil {
        add(cell)
      } else if let parent, decoded[parent] != nil {
        add(parent)
      } else {
        cell.children.filter { decoded[$0] != nil }.forEach(add)
      }
    }
    pinned = seen.union(waited)
    return WatchMapTileFrame(
      draw: draw.enumerated().sorted { ($0.element.z, $0.offset) < ($1.element.z, $1.offset) }.map(\.element),
      missing: wanted.filter { decoded[$0] == nil })
  }

  private mutating func touch(_ tile: WatchMapTile) {
    recent.removeAll { $0 == tile }
    recent.append(tile)
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WATCH_MAP_TILE_PATH`
/// @platform-diff Wear OS needs no list: its held set is the set of `/map-tile` Data Layer items.
let watchMapTilesChannel = "mapTiles"

struct WatchMapTileList: Equatable {
  let style: String
  let tiles: [WatchMapTile]
  var generation: Int64 = 0

  var payload: [String: Any] { ["style": style, "tiles": tiles.map(\.key), "generation": generation] }

  static func decode(_ payload: [String: Any]?) -> WatchMapTileList? {
    guard let payload, let style = payload["style"] as? String, let keys = payload["tiles"] as? [String] else { return nil }
    return WatchMapTileList(
      style: style, tiles: keys.compactMap(WatchMapTile.init(key:)),
      generation: (payload["generation"] as? NSNumber)?.int64Value ?? 0)
  }

  func supersedes(style: String, tile: WatchMapTile, generation: Int64) -> Bool {
    generation <= self.generation && (style != self.style || !tiles.contains(tile))
  }
}

enum WatchMapTileTransfer {
  static func metadata(style: String, tile: WatchMapTile, generation: Int64) -> [String: Any] {
    ["style": style, "z": tile.z, "x": tile.x, "y": tile.y, "generation": generation]
  }

  static func decode(_ metadata: [String: Any]?) -> (style: String, tile: WatchMapTile, generation: Int64)? {
    guard let metadata, let style = metadata["style"] as? String,
      let z = metadata["z"] as? Int, let x = metadata["x"] as? Int, let y = metadata["y"] as? Int
    else { return nil }
    let tile = WatchMapTile(z: z, x: x, y: y)
    return tile.isValid ? (style, tile, (metadata["generation"] as? NSNumber)?.int64Value ?? 0) : nil
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapGauges`
enum WatchMapGauges {
  static let steps = [0, 30, 45, 60, 75, 90]
  static let defaultPercent = 60

  static func percent(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(value is Bool) else { return nil }
    let percent = number.intValue
    return steps.contains(percent) && Double(percent) == number.doubleValue ? percent : nil
  }
}
