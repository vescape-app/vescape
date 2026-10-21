import Foundation

/// One 512 px raster tile of the hosted dark street-map style (`MapTiles.style`), in Web Mercator
/// tile coordinates. Shared with the wrist (`watch/watchos/` symlinks this file): the phone plans
/// and sends tiles, the wrist places them under the trail.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapTile`
struct WatchMapTile: Hashable {
  let z: Int
  let x: Int
  let y: Int

  /// `z/x/y`: the tile's name in the held list and the transfer metadata.
  var key: String { "\(z)/\(x)/\(y)" }

  /// The tile's top-left corner.
  var northWest: WatchMapPosition { corner(x, y) }
  /// The tile's bottom-right corner. Its longitude is 180 for the last column, never -180.
  var southEast: WatchMapPosition { corner(x + 1, y + 1) }

  /// The tile one zoom out that this one is a quarter of; nil at zoom 0.
  var parent: WatchMapTile? { z == 0 ? nil : WatchMapTile(z: z - 1, x: x >> 1, y: y >> 1) }

  /// The four tiles one zoom in that make up this one.
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

  /// Inside the tile grid of its zoom.
  var isValid: Bool { (0...30).contains(z) && (0..<(1 << z)).contains(x) && (0..<(1 << z)).contains(y) }
}

extension WatchMapTile {
  /// A tile key, or nil for anything that is not a valid `z/x/y`.
  init?(key: String) {
    let parts = key.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 3, let z = Int(parts[0]), let x = Int(parts[1]), let y = Int(parts[2]) else { return nil }
    self.init(z: z, x: x, y: y)
    guard isValid else { return nil }
  }
}

extension WatchMapTile {
  /// Watch width the zoom is chosen for. Close to the largest Wear and Apple Watch panels.
  static let referenceWidthPx = 480.0
  /// A tile may be drawn at most this much larger than its pixels before the next level is used.
  static let maxUpscale = 1.3
  /// A held level survives until the span moves this factor past its boundary, either way.
  static let zoomHysteresis = 1.15
  /// Metres per pixel of a 512 px tile at zoom 0 on the equator.
  static let zoom0MetresPerPixel = 78_271.517
  static let maxMercatorLatitude = 85.051_128

  static func clampedLatitude(_ latitude: Double) -> Double {
    min(maxMercatorLatitude, max(-maxMercatorLatitude, latitude))
  }

  /// The lowest zoom whose tile is drawn at most `maxUpscale` times its size on a `referenceWidthPx`
  /// face showing `spanM` (clamped exactly as the wrist clamps it). `current` is kept while it stays
  /// inside the hysteresis band, so a span near a boundary does not flip levels. The phone plans
  /// tiles at this level and the wrist draws at it; the span clamp keeps it well under the style's
  /// maximum zoom.
  ///
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

  /// The cells the wrist can fill at `zoom`: every tile at that level that a held tile at `zoom`, one
  /// zoom out or one zoom in covers. Cells nothing covers stay background, so they are never listed.
  ///
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

/// Cells the wrist draws at once, and decoded tiles it keeps beyond what the current frame wants.
/// A display shows at most about nine cells at the wrist's spans.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WATCH_MAP_DECODED_TILES`
let watchMapDecodedTiles = 12

/// One wrist frame: what it draws, bottom-up, and the tiles it waits on that are not decoded yet.
struct WatchMapTileFrame {
  let draw: [WatchMapTile]
  let missing: [WatchMapTile]
}

/// The wrist's decoded street-map tiles: least recently used goes first, but never a tile the last
/// `frame` drew or waits on, so a decode cannot evict what the display is about to draw and a level
/// stays on screen while the next decodes. The cache runs over `watchMapDecodedTiles` while a zoom settles.
/// Platform image type, decoding and threading stay with each wrist.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapTileCache`
struct WatchMapTileCache<Image> {
  private var decoded: [WatchMapTile: Image] = [:]
  /// Least recently used first.
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

  /// Lays out a frame over `cells` (tiles at the wrist's zoom across the display, nearest first) from
  /// the `held` tiles, and pins it. Per cell it draws its own tile when decoded; else the one-zoom-out
  /// tile, whose matching quarter shows through, scaled up; else the decoded tiles one zoom in, the
  /// level a zoom-out just left; else nothing, so the background shows. One-out tiles come first so
  /// a neighbour's own tile covers the rest of them. Only the best held level of each cell is waited
  /// on (own, else one out, else one in); a fallback is drawn only if it is already decoded.
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

/// The tiles the wrist should hold, as the phone last planned them. Cold state on the merged
/// Application Context (`WatchColdState`), so a reconnect or a relaunch tells the wrist which of its
/// files to keep. Files for tiles not on the list are deleted on the wrist.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WATCH_MAP_TILE_PATH`
/// @platform-diff Wear OS needs no list: its held set is the set of `/map-tile` Data Layer items.
let watchMapTilesChannel = "mapTiles"

struct WatchMapTileList: Equatable {
  let style: String
  let tiles: [WatchMapTile]
  /// Orders lists against the files sent under them; see ``supersedes(style:tile:generation:)``.
  /// The phone's wall-clock ms, raised to stay increasing, so it keeps rising across a phone relaunch.
  var generation: Int64 = 0

  var payload: [String: Any] { ["style": style, "tiles": tiles.map(\.key), "generation": generation] }

  /// Nil for an absent or unreadable channel; unreadable keys are skipped.
  static func decode(_ payload: [String: Any]?) -> WatchMapTileList? {
    guard let payload, let style = payload["style"] as? String, let keys = payload["tiles"] as? [String] else { return nil }
    return WatchMapTileList(
      style: style, tiles: keys.compactMap(WatchMapTile.init(key:)),
      generation: (payload["generation"] as? NSNumber)?.int64Value ?? 0)
  }

  /// True when a file sent under list `generation` was planned away by this list. The phone only sends
  /// a tile its current list names, so a list at least as new that leaves it out dropped it; a file
  /// from a newer list than this one waits for that list instead.
  func supersedes(style: String, tile: WatchMapTile, generation: Int64) -> Bool {
    generation <= self.generation && (style != self.style || !tiles.contains(tile))
  }
}

/// `transferFile` metadata: the style and tile a received file is, and the list it was sent under.
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

/// The rider's **Map behind gauges** setting: street map opacity behind the telemetry gauges, as an
/// integer percent from fixed steps; 0 is Off, the street map only on the map page. Phone persistence and the wrist decode both snap through
/// ``percent(_:)``, so a value from a newer or broken phone falls back to the default.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTile.kt `WatchMapGauges`
enum WatchMapGauges {
  static let steps = [0, 30, 45, 60, 75, 90]
  static let defaultPercent = 60

  /// One of ``steps``, else nil.
  static func percent(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, !(value is Bool) else { return nil }
    let percent = number.intValue
    return steps.contains(percent) && Double(percent) == number.doubleValue ? percent : nil
  }
}
