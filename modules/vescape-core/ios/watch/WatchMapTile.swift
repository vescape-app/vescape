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

  var payload: [String: Any] { ["style": style, "tiles": tiles.map(\.key)] }

  /// Nil for an absent or unreadable channel; unreadable keys are skipped.
  static func decode(_ payload: [String: Any]?) -> WatchMapTileList? {
    guard let payload, let style = payload["style"] as? String, let keys = payload["tiles"] as? [String] else { return nil }
    return WatchMapTileList(style: style, tiles: keys.compactMap(WatchMapTile.init(key:)))
  }
}

/// `transferFile` metadata: the style and tile a received file is.
enum WatchMapTileTransfer {
  static func metadata(style: String, tile: WatchMapTile) -> [String: Any] {
    ["style": style, "z": tile.z, "x": tile.x, "y": tile.y]
  }

  static func decode(_ metadata: [String: Any]?) -> (style: String, tile: WatchMapTile)? {
    guard let metadata, let style = metadata["style"] as? String,
      let z = metadata["z"] as? Int, let x = metadata["x"] as? Int, let y = metadata["y"] as? Int
    else { return nil }
    let tile = WatchMapTile(z: z, x: x, y: y)
    return tile.isValid ? (style, tile) : nil
  }
}
