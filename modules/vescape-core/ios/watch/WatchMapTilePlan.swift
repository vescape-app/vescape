import Foundation

// Which street-map tiles the wrist should hold (#551). Pure: the phone decides from the rider's
// position, course, speed and the span the wrist draws, and the wrist never reports holdings.
//
// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTilePlan.kt

/// The rider as the tile plan needs them, from the same snapshot the Watch Frame is built from.
struct WatchMapRider: Equatable {
  let position: WatchMapPosition
  let courseDeg: Double?
  let speedMps: Double?
  /// Phone map span; nil while the phone map is unmounted, which the wrist draws at the default.
  let spanM: Double?
}

/// A tile on the wanted list and the plan step that last needed it.
struct WatchMapTileNeed: Equatable {
  let tile: WatchMapTile
  let neededAt: Int64
}

enum WatchMapTilePlan {
  /// Watch width the zoom is chosen for. Close to the largest Wear and Apple Watch panels.
  static let referenceWidthPx = 480.0
  /// A tile may be drawn at most this much larger than its pixels before the next level is used.
  static let maxUpscale = 1.3
  /// A held level survives until the span moves this factor past its boundary, either way.
  static let zoomHysteresis = 1.15
  /// Most tiles the wrist holds. Least recently needed tiles behind the rider leave first.
  static let tileCap = 200
  /// The ring is centred this far ahead at the current speed, or half a span if that is further.
  static let lookaheadS = 30.0
  /// Ring radius in spans, around that centre.
  static let ringSpans = 1.0
  /// A course change larger than this re-plans the ring even inside the same tile.
  static let replanTurnDeg = 45.0

  /// Metres per pixel of a 512 px tile at zoom 0 on the equator.
  private static let zoom0MetresPerPixel = 78_271.517
  private static let tilePixels = 512.0
  private static let maxMercatorLatitude = 85.051_128

  /// The lowest zoom whose tile is drawn at most `maxUpscale` times its size on a `referenceWidthPx`
  /// face showing `spanM` (clamped exactly as the wrist clamps it). `current` is kept while it stays
  /// inside the hysteresis band, so a span near a boundary does not flip levels.
  static func zoom(spanM: Double?, latitude: Double, current: Int?) -> Int {
    let metresPerPixel = WatchMapProjection.clampedSpanM(spanM) / referenceWidthPx
    let groundPerPixel = zoom0MetresPerPixel * cos(clampedLatitude(latitude) * .pi / 180)
    func lowest(_ upscale: Double) -> Int {
      min(MapTiles.maxZoom, max(0, Int(ceil(log2(groundPerPixel / (upscale * metresPerPixel))))))
    }
    if let current, (lowest(maxUpscale * zoomHysteresis)...lowest(maxUpscale / zoomHysteresis)).contains(current) {
      return current
    }
    return lowest(maxUpscale)
  }

  /// Tiles at `zoom` within `ringSpans` spans of a centre ahead of the rider along their course,
  /// nearest the rider first. Columns wrap across the antimeridian; rows stop at the poles.
  static func ring(_ rider: WatchMapRider, zoom: Int) -> [WatchMapTile] {
    let n = 1 << zoom
    let (riderX, riderY) = tileCoordinates(rider.position, n: n)
    let tileM = tileMetres(latitude: rider.position.latitude, zoom: zoom)
    let spanM = WatchMapProjection.clampedSpanM(rider.spanM)
    let aheadM = rider.courseDeg == nil ? 0 : max(spanM / 2, (rider.speedMps ?? 0) * lookaheadS)
    let course = (rider.courseDeg ?? 0) * .pi / 180
    let centreX = riderX + aheadM * sin(course) / tileM
    let centreY = riderY - aheadM * cos(course) / tileM
    let radius = spanM * ringSpans / tileM
    var ring: [(tile: WatchMapTile, distance: Double)] = []
    let rows = max(0, Int(floor(centreY - radius)))...min(n - 1, Int(floor(centreY + radius)))
    for row in rows {
      for column in Int(floor(centreX - radius))...Int(floor(centreX + radius)) {
        let nearestX = min(max(centreX, Double(column)), Double(column) + 1)
        let nearestY = min(max(centreY, Double(row)), Double(row) + 1)
        guard hypot(nearestX - centreX, nearestY - centreY) <= radius else { continue }
        let tile = WatchMapTile(z: zoom, x: ((column % n) + n) % n, y: row)
        ring.append((tile, hypot(Double(column) + 0.5 - riderX, Double(row) + 0.5 - riderY)))
      }
    }
    var seen = Set<WatchMapTile>()
    return ring
      .sorted { $0.distance != $1.distance ? $0.distance < $1.distance : $0.tile.key < $1.tile.key }
      .map(\.tile)
      .filter { seen.insert($0).inserted }
  }

  /// The wanted list after a plan step: `needed` first in its own order (nearest first), then tiles
  /// held from earlier steps at the same zoom levels, most recently needed first and ahead of the
  /// rider before behind, cut at `cap`.
  ///
  /// `needed` is the seam for more tile sources (route ahead, one zoom out): pass them in priority order.
  static func retain(
    needed: [WatchMapTile], held: [WatchMapTileNeed], rider: WatchMapRider, step: Int64, cap: Int = tileCap
  ) -> [WatchMapTileNeed] {
    let neededSet = Set(needed)
    let zooms = Set(needed.map(\.z))
    let older = held
      .filter { zooms.contains($0.tile.z) && !neededSet.contains($0.tile) }
      .sorted { a, b in
        if a.neededAt != b.neededAt { return a.neededAt > b.neededAt }
        let behindA = isBehind(a.tile, rider), behindB = isBehind(b.tile, rider)
        if behindA != behindB { return !behindA }
        return riderDistance(a.tile, rider) < riderDistance(b.tile, rider)
      }
    var seen = Set<WatchMapTile>()
    let fresh = needed.filter { seen.insert($0).inserted }.map { WatchMapTileNeed(tile: $0, neededAt: step) }
    return Array((fresh + older).prefix(cap))
  }

  /// The rider's tile at `zoom`.
  static func tile(at position: WatchMapPosition, zoom: Int) -> WatchMapTile {
    let (x, y) = tileCoordinates(position, n: 1 << zoom)
    return WatchMapTile(z: zoom, x: Int(floor(x)), y: Int(floor(y)))
  }

  /// Fractional Web Mercator tile coordinates of `position` on an `n`×`n` grid.
  private static func tileCoordinates(_ position: WatchMapPosition, n: Int) -> (Double, Double) {
    let latitude = clampedLatitude(position.latitude) * .pi / 180
    let x = (position.longitude + 180) / 360 * Double(n)
    let y = (1 - log(tan(latitude) + 1 / cos(latitude)) / .pi) / 2 * Double(n)
    let limit = Double(n) - 1e-9
    return (min(max(x, 0), limit), min(max(y, 0), limit))
  }

  private static func clampedLatitude(_ latitude: Double) -> Double {
    min(maxMercatorLatitude, max(-maxMercatorLatitude, latitude))
  }

  private static func tileMetres(latitude: Double, zoom: Int) -> Double {
    tilePixels * zoom0MetresPerPixel * cos(clampedLatitude(latitude) * .pi / 180) / Double(1 << zoom)
  }

  /// Tile centre minus rider, in tiles, with columns wrapped to the short way round.
  private static func riderDelta(_ tile: WatchMapTile, _ rider: WatchMapRider) -> (Double, Double) {
    let n = Double(1 << tile.z)
    let (x, y) = tileCoordinates(rider.position, n: 1 << tile.z)
    let raw = (Double(tile.x) + 0.5 - x).truncatingRemainder(dividingBy: n)
    let dx = (raw + n + n / 2).truncatingRemainder(dividingBy: n) - n / 2
    return (dx, Double(tile.y) + 0.5 - y)
  }

  private static func riderDistance(_ tile: WatchMapTile, _ rider: WatchMapRider) -> Double {
    let (dx, dy) = riderDelta(tile, rider)
    return hypot(dx, dy)
  }

  private static func isBehind(_ tile: WatchMapTile, _ rider: WatchMapRider) -> Bool {
    guard let courseDeg = rider.courseDeg else { return false }
    let course = courseDeg * .pi / 180
    let (dx, dy) = riderDelta(tile, rider)
    return dx * sin(course) - dy * cos(course) < 0
  }
}

/// The stateful half: re-plans only when the rider enters a new tile, the zoom changes, or the
/// course turns by more than `replanTurnDeg`. Everything it decides is in `WatchMapTilePlan`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTilePlan.kt `WatchMapTilePlanner`
final class WatchMapTilePlanner {
  private let cap: Int
  private var zoom: Int?
  private var riderTile: WatchMapTile?
  private var plannedCourseDeg: Double?
  private var step: Int64 = 0
  private(set) var wanted: [WatchMapTileNeed] = []

  init(cap: Int = WatchMapTilePlan.tileCap) { self.cap = cap }

  /// True when `wanted` changed.
  func update(_ rider: WatchMapRider) -> Bool {
    let nextZoom = WatchMapTilePlan.zoom(spanM: rider.spanM, latitude: rider.position.latitude, current: zoom)
    let tile = WatchMapTilePlan.tile(at: rider.position, zoom: nextZoom)
    var turned = false
    if let course = rider.courseDeg {
      turned = plannedCourseDeg.map { abs(shortestAngleDelta(from: $0, to: course)) > WatchMapTilePlan.replanTurnDeg } ?? true
    }
    guard nextZoom != zoom || tile != riderTile || turned else { return false }
    zoom = nextZoom
    riderTile = tile
    if let course = rider.courseDeg { plannedCourseDeg = course }
    step += 1
    wanted = WatchMapTilePlan.retain(
      needed: WatchMapTilePlan.ring(rider, zoom: nextZoom), held: wanted, rider: rider, step: step, cap: cap)
    return true
  }
}
