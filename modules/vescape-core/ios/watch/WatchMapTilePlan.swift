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
  /// Where the rider is on the Navigation route; nil without one.
  var route: WatchMapRouteProgress? = nil
}

/// A Navigation path as the tile plan walks it: `points` in ridden order and the great-circle metres
/// along it to each, measured as Route Progress measures them. Compared by identity: a new path is a
/// new route.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTilePlan.kt `WatchMapRoute`
final class WatchMapRoute: Equatable {
  let points: [WatchMapPosition]
  private let alongM: [Double]

  init(points: [WatchMapPosition]) {
    self.points = points
    var along = [Double](repeating: 0, count: points.count)
    for index in points.indices.dropFirst() {
      let from = points[index - 1], to = points[index]
      along[index] = along[index - 1] + GeoMath.distanceMeters(from.latitude, from.longitude, to.latitude, to.longitude)
    }
    alongM = along
  }

  var lengthM: Double { alongM.last ?? 0 }

  /// The segment holding the point `remainingM` before the end, and that point, interpolated the way
  /// Route Progress projects it. Nil for a path with fewer than two points.
  func point(before remainingM: Double) -> (segment: Int, position: WatchMapPosition)? {
    guard points.count >= 2 else { return nil }
    let target = min(max(lengthM - remainingM, 0), lengthM)
    // Last vertex at or before the target, then past any zero-length segments ending on it.
    var low = 0, high = points.count - 1
    while low < high {
      let mid = (low + high + 1) / 2
      if alongM[mid] <= target { low = mid } else { high = mid - 1 }
    }
    let segment = min(low, points.count - 2)
    let length = alongM[segment + 1] - alongM[segment]
    let fraction = length == 0 ? 0 : min(max((target - alongM[segment]) / length, 0), 1)
    let from = points[segment], to = points[segment + 1]
    // The short way round, so a segment across the antimeridian stays on it.
    let longitudeDelta = (to.longitude - from.longitude + 540).truncatingRemainder(dividingBy: 360) - 180
    return (segment, WatchMapPosition(
      latitude: from.latitude + (to.latitude - from.latitude) * fraction,
      longitude: (from.longitude + longitudeDelta * fraction + 540).truncatingRemainder(dividingBy: 360) - 180))
  }

  static func == (lhs: WatchMapRoute, rhs: WatchMapRoute) -> Bool { lhs === rhs }
}

/// The rider on `route`: `remainingM` along the path to its end, from Route Progress.
struct WatchMapRouteProgress: Equatable {
  let route: WatchMapRoute
  let remainingM: Double
}

/// A tile on the wanted list and the plan step that last needed it. A `route` tile is wanted only for
/// the route ahead, so it leaves as soon as the route stops wanting it (passed, rerouted, cleared).
struct WatchMapTileNeed: Equatable {
  let tile: WatchMapTile
  let neededAt: Int64
  var route = false
}

enum WatchMapTilePlan {
  /// Most tiles the wrist holds. Least recently needed tiles behind the rider leave first.
  static let tileCap = 200
  /// The ring is centred this far ahead at the current speed, or half a span if that is further.
  static let lookaheadS = 30.0
  /// Ring radius in spans, around that centre.
  static let ringSpans = 1.0
  /// Route corridor half-width in spans: every tile within this of the path ahead, which is the face
  /// around the rider wherever they are on it.
  static let routeCorridorSpans = 0.5
  /// The path ahead is sampled at most this many tiles apart, well under the corridor radius.
  private static let routeSampleTiles = 0.25
  /// A course change larger than this re-plans the ring even inside the same tile.
  static let replanTurnDeg = 45.0

  private static let tilePixels = 512.0

  /// Tiles at `zoom` within `ringSpans` spans of a centre ahead of the rider along their course, or
  /// of the rider themselves without `lookahead`, nearest the rider first. Columns wrap across the
  /// antimeridian; rows stop at the poles.
  static func ring(_ rider: WatchMapRider, zoom: Int, lookahead: Bool = true) -> [WatchMapTile] {
    let n = 1 << zoom
    let (riderX, riderY) = tileCoordinates(rider.position, n: n)
    let tileM = tileMetres(latitude: rider.position.latitude, zoom: zoom)
    let spanM = WatchMapProjection.clampedSpanM(rider.spanM)
    let aheadM = !lookahead || rider.courseDeg == nil ? 0 : max(spanM / 2, (rider.speedMps ?? 0) * lookaheadS)
    let course = (rider.courseDeg ?? 0) * .pi / 180
    let centreX = riderX + aheadM * sin(course) / tileM
    let centreY = riderY - aheadM * cos(course) / tileM
    let radius = spanM * ringSpans / tileM
    return tiles(within: radius, of: (centreX, centreY), zoom: zoom) { column, row in
      hypot(Double(column) + 0.5 - riderX, Double(row) + 0.5 - riderY)
    }
  }

  /// Tiles at `zoom` within `routeCorridorSpans` spans of the route ahead of the rider, from their
  /// Route Progress to the end, nearest along the path first, at most `limit`. Empty without a route.
  /// The path is walked in tile space, so the antimeridian is crossed the short way round.
  static func routeTiles(_ rider: WatchMapRider, zoom: Int, limit: Int = tileCap) -> [WatchMapTile] {
    guard let progress = rider.route, let anchor = progress.route.point(before: progress.remainingM) else { return [] }
    let (segment, start) = anchor
    let points = progress.route.points
    let n = 1 << zoom
    let radius = WatchMapProjection.clampedSpanM(rider.spanM) * routeCorridorSpans
      / tileMetres(latitude: start.latitude, zoom: zoom)
    var found: [WatchMapTile] = []
    var seen = Set<WatchMapTile>()
    func visit(_ x: Double, _ y: Double) {
      for tile in tiles(within: radius, of: (x, y), zoom: zoom, rank: { hypot(Double($0) + 0.5 - x, Double($1) + 0.5 - y) }) {
        guard found.count < limit else { return }
        if seen.insert(tile).inserted { found.append(tile) }
      }
    }
    var (x, y) = tileCoordinates(start, n: n)
    visit(x, y)
    for index in (segment + 1)..<points.count {
      guard found.count < limit else { break }
      let (nextX, nextY) = tileCoordinates(points[index], n: n)
      let size = Double(n)
      let raw = (nextX - x).truncatingRemainder(dividingBy: size)
      let dx = (raw + size + size / 2).truncatingRemainder(dividingBy: size) - size / 2
      let dy = nextY - y
      let samples = Int(ceil(hypot(dx, dy) / routeSampleTiles))
      if samples > 0 {
        for sample in 1...samples { visit(x + dx * Double(sample) / Double(samples), y + dy * Double(sample) / Double(samples)) }
      }
      x += dx
      y = nextY
    }
    return found
  }

  /// Tiles at `zoom` whose square comes within `radius` tiles of `centre`, ordered by `rank` of their
  /// unwrapped column and row. Columns wrap across the antimeridian; rows stop at the poles.
  private static func tiles(
    within radius: Double, of centre: (x: Double, y: Double), zoom: Int, rank: (Int, Int) -> Double
  ) -> [WatchMapTile] {
    let n = 1 << zoom
    var found: [(tile: WatchMapTile, rank: Double)] = []
    let rows = max(0, Int(floor(centre.y - radius)))...min(n - 1, Int(floor(centre.y + radius)))
    for row in rows {
      for column in Int(floor(centre.x - radius))...Int(floor(centre.x + radius)) {
        let nearestX = min(max(centre.x, Double(column)), Double(column) + 1)
        let nearestY = min(max(centre.y, Double(row)), Double(row) + 1)
        guard hypot(nearestX - centre.x, nearestY - centre.y) <= radius else { continue }
        found.append((WatchMapTile(z: zoom, x: ((column % n) + n) % n, y: row), rank(column, row)))
      }
    }
    var seen = Set<WatchMapTile>()
    return found
      .sorted { $0.rank != $1.rank ? $0.rank < $1.rank : $0.tile.key < $1.tile.key }
      .map(\.tile)
      .filter { seen.insert($0).inserted }
  }

  /// The wanted list after a plan step: `needed` first in its own order, then the `route` tiles it
  /// does not already hold, then tiles held from earlier steps at the same zoom levels, most recently
  /// needed first and ahead of the rider before behind, then tiles of `previousZoom`, the level the
  /// last zoom change left, in the same order. All cut at `cap`. Keeping the previous level lets the
  /// wrist draw it until the new one arrives; it leaves with the next zoom change or the cap. Route
  /// tiles from an earlier step that `route` no longer lists leave at once.
  ///
  /// `needed` is the seam for more tile sources: pass them in priority order.
  static func retain(
    needed: [WatchMapTile], held: [WatchMapTileNeed], rider: WatchMapRider, step: Int64, cap: Int = tileCap,
    previousZoom: Int? = nil, route: [WatchMapTile] = []
  ) -> [WatchMapTileNeed] {
    let neededSet = Set(needed)
    var routeSet = Set<WatchMapTile>()
    let routeOnly = route.filter { !neededSet.contains($0) && routeSet.insert($0).inserted }
    let zooms = Set(needed.map(\.z))
    let older = held
      .filter {
        !$0.route && (zooms.contains($0.tile.z) || $0.tile.z == previousZoom) && !neededSet.contains($0.tile)
          && !routeSet.contains($0.tile)
      }
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
      + routeOnly.map { WatchMapTileNeed(tile: $0, neededAt: step, route: true) }
    return Array((fresh + older).prefix(cap))
  }

  /// Tiles one plan step needs at `zoom`: the display around the rider first, then the ring ahead,
  /// so speed never pushes the current view out of the plan. Each as the ring one zoom out first,
  /// about four tiles that cover the display on their own once scaled up, then the ring at `zoom`.
  static func needed(_ rider: WatchMapRider, zoom: Int) -> [WatchMapTile] {
    func levels(_ lookahead: Bool) -> [WatchMapTile] {
      (zoom > 0 ? ring(rider, zoom: zoom - 1, lookahead: lookahead) : []) + ring(rider, zoom: zoom, lookahead: lookahead)
    }
    var seen = Set<WatchMapTile>()
    return (levels(false) + levels(true)).filter { seen.insert($0).inserted }
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

/// The stateful half: re-plans only when the rider enters a new tile, the zoom changes, the course
/// turns by more than `replanTurnDeg`, or the route or the tile of their progress along it changes.
/// Everything it decides is in `WatchMapTilePlan`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchMapTilePlan.kt `WatchMapTilePlanner`
final class WatchMapTilePlanner {
  private let cap: Int
  private var zoom: Int?
  private var previousZoom: Int?
  private var riderTile: WatchMapTile?
  private var plannedCourseDeg: Double?
  /// The route last planned and the tile its progress point was on; identity compares the route.
  private var plannedRoute: (route: WatchMapRoute, tile: WatchMapTile)?
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
    let route = rider.route.flatMap { progress in
      progress.route.point(before: progress.remainingM).map {
        (route: progress.route, tile: WatchMapTilePlan.tile(at: $0.position, zoom: nextZoom))
      }
    }
    let routeMoved = route?.route !== plannedRoute?.route || route?.tile != plannedRoute?.tile
    guard nextZoom != zoom || tile != riderTile || turned || routeMoved else { return false }
    if let zoom, nextZoom != zoom { previousZoom = zoom }
    zoom = nextZoom
    riderTile = tile
    plannedRoute = route
    if let course = rider.courseDeg { plannedCourseDeg = course }
    step += 1
    wanted = WatchMapTilePlan.retain(
      needed: WatchMapTilePlan.needed(rider, zoom: nextZoom), held: wanted, rider: rider, step: step, cap: cap,
      previousZoom: previousZoom, route: WatchMapTilePlan.routeTiles(rider, zoom: nextZoom, limit: cap))
    return true
  }
}
