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
  /// Most tiles the wrist holds. Least recently needed tiles behind the rider leave first.
  static let tileCap = 200
  /// The ring is centred this far ahead at the current speed, or half a span if that is further.
  static let lookaheadS = 30.0
  /// Ring radius in spans, around that centre.
  static let ringSpans = 1.0
  /// A course change larger than this re-plans the ring even inside the same tile.
  static let replanTurnDeg = 45.0

  private static let tilePixels = 512.0

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

  /// The wanted list after a plan step: `needed` first in its own order, then tiles held from earlier
  /// steps at the same zoom levels, most recently needed first and ahead of the rider before behind,
  /// then tiles of `previousZoom`, the level the last zoom change left, in the same order. All cut at
  /// `cap`. Keeping the previous level lets the wrist draw it until the new one arrives; it leaves
  /// with the next zoom change or the cap.
  ///
  /// `needed` is the seam for more tile sources (route ahead): pass them in priority order.
  static func retain(
    needed: [WatchMapTile], held: [WatchMapTileNeed], rider: WatchMapRider, step: Int64, cap: Int = tileCap,
    previousZoom: Int? = nil
  ) -> [WatchMapTileNeed] {
    let neededSet = Set(needed)
    let zooms = Set(needed.map(\.z))
    let older = held
      .filter { (zooms.contains($0.tile.z) || $0.tile.z == previousZoom) && !neededSet.contains($0.tile) }
      .sorted { a, b in
        let currentA = zooms.contains(a.tile.z), currentB = zooms.contains(b.tile.z)
        if currentA != currentB { return currentA }
        if a.neededAt != b.neededAt { return a.neededAt > b.neededAt }
        let behindA = isBehind(a.tile, rider), behindB = isBehind(b.tile, rider)
        if behindA != behindB { return !behindA }
        return riderDistance(a.tile, rider) < riderDistance(b.tile, rider)
      }
    var seen = Set<WatchMapTile>()
    let fresh = needed.filter { seen.insert($0).inserted }.map { WatchMapTileNeed(tile: $0, neededAt: step) }
    return Array((fresh + older).prefix(cap))
  }

  /// Tiles one plan step needs at `zoom`: the ring one zoom out first, about four tiles that cover
  /// the display on their own once scaled up, then the ring at `zoom` itself.
  static func needed(_ rider: WatchMapRider, zoom: Int) -> [WatchMapTile] {
    (zoom > 0 ? ring(rider, zoom: zoom - 1) : []) + ring(rider, zoom: zoom)
  }

  /// The rider's tile at `zoom`.
  static func tile(at position: WatchMapPosition, zoom: Int) -> WatchMapTile {
    let (x, y) = tileCoordinates(position, n: 1 << zoom)
    return WatchMapTile(z: zoom, x: Int(floor(x)), y: Int(floor(y)))
  }

  /// Fractional Web Mercator tile coordinates of `position` on an `n`×`n` grid.
  private static func tileCoordinates(_ position: WatchMapPosition, n: Int) -> (Double, Double) {
    let latitude = WatchMapTile.clampedLatitude(position.latitude) * .pi / 180
    let x = (position.longitude + 180) / 360 * Double(n)
    let y = (1 - log(tan(latitude) + 1 / cos(latitude)) / .pi) / 2 * Double(n)
    let limit = Double(n) - 1e-9
    return (min(max(x, 0), limit), min(max(y, 0), limit))
  }

  private static func tileMetres(latitude: Double, zoom: Int) -> Double {
    tilePixels * WatchMapTile.zoom0MetresPerPixel * cos(WatchMapTile.clampedLatitude(latitude) * .pi / 180) / Double(1 << zoom)
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
  private var previousZoom: Int?
  private var riderTile: WatchMapTile?
  private var plannedCourseDeg: Double?
  private var step: Int64 = 0
  private(set) var wanted: [WatchMapTileNeed] = []

  init(cap: Int = WatchMapTilePlan.tileCap) { self.cap = cap }

  /// True when `wanted` changed.
  func update(_ rider: WatchMapRider) -> Bool {
    let nextZoom = WatchMapTile.zoom(spanM: rider.spanM, latitude: rider.position.latitude, current: zoom)
    let tile = WatchMapTilePlan.tile(at: rider.position, zoom: nextZoom)
    var turned = false
    if let course = rider.courseDeg {
      turned = plannedCourseDeg.map { abs(shortestAngleDelta(from: $0, to: course)) > WatchMapTilePlan.replanTurnDeg } ?? true
    }
    guard nextZoom != zoom || tile != riderTile || turned else { return false }
    if let zoom, nextZoom != zoom { previousZoom = zoom }
    zoom = nextZoom
    riderTile = tile
    if let course = rider.courseDeg { plannedCourseDeg = course }
    step += 1
    wanted = WatchMapTilePlan.retain(
      needed: WatchMapTilePlan.needed(rider, zoom: nextZoom), held: wanted, rider: rider, step: step, cap: cap,
      previousZoom: previousZoom)
    return true
  }
}
