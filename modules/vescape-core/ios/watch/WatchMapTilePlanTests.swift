import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchMapTilePlanTest.kt
final class WatchMapTilePlanTests: XCTestCase {
  private let wroclaw = WatchMapPosition(latitude: 51.13185, longitude: 16.98653)

  private func rider(
    _ position: WatchMapPosition? = nil, courseDeg: Double? = nil, speedMps: Double? = nil, spanM: Double? = nil,
    route: WatchMapRouteProgress? = nil
  ) -> WatchMapRider {
    WatchMapRider(position: position ?? wroclaw, courseDeg: courseDeg, speedMps: speedMps, spanM: spanM, route: route)
  }

  /// A straight path east from Wroclaw, about 21 km, and the rider `doneM` along it.
  private func eastRoute(_ doneM: Double) -> (rider: WatchMapRider, route: WatchMapRoute) {
    let route = WatchMapRoute(points: (0...30).map {
      WatchMapPosition(latitude: wroclaw.latitude, longitude: wroclaw.longitude + Double($0) * 0.01)
    })
    let at = route.point(before: route.lengthM - doneM)!.position
    return (
      rider(at, courseDeg: 90, route: WatchMapRouteProgress(route: route, remainingM: route.lengthM - doneM)), route
    )
  }

  private func zoom(_ spanM: Double?, _ latitude: Double? = nil, current: Int? = nil) -> Int {
    WatchMapTile.zoom(spanM: spanM, latitude: latitude ?? wroclaw.latitude, current: current)
  }

  func testZoomFollowsSpanAndLatitudeWithTheWristClamp() {
    // 600 m on 480 px is 1.25 m/px; z15 tiles are about 1.5 m/px there, a 1.2x upscale.
    XCTAssertEqual(zoom(600), 15)
    XCTAssertEqual(zoom(nil), 15)
    XCTAssertEqual(zoom(300), 16)
    // Clamped to the wrist's 150 m .. 2 km before choosing.
    XCTAssertEqual(zoom(10), zoom(150))
    XCTAssertEqual(zoom(50_000), zoom(2_000))
    // Ground per pixel shrinks towards the poles, so the same span needs fewer levels there.
    XCTAssertGreaterThan(zoom(600, 0), zoom(600, 70))
  }

  func testAHeldZoomSurvivesASpanNearItsBoundary() {
    // At Wroclaw z15 is the lowest level from about 554 m to 1107 m of span.
    XCTAssertEqual(zoom(570), 15)
    XCTAssertEqual(zoom(570, current: 16), 16)
    XCTAssertEqual(zoom(520), 16)
    XCTAssertEqual(zoom(520, current: 15), 15)
    XCTAssertEqual(zoom(1_150), 14)
    XCTAssertEqual(zoom(1_150, current: 15), 15)
    // Past the band the held level gives way.
    XCTAssertEqual(zoom(1_400, current: 15), 14)
    XCTAssertEqual(zoom(400, current: 15), 16)
  }

  func testTheRingIsNearestFirstAndReachesFurtherAheadThanBehind() {
    let east = rider(courseDeg: 90, speedMps: 10)
    let ring = WatchMapTilePlan.ring(east, zoom: 15)
    let still = WatchMapTilePlan.ring(rider(), zoom: 15)
    XCTAssertEqual(ring.first, still.first)
    func meanX(_ tiles: [WatchMapTile]) -> Double { Double(tiles.map(\.x).reduce(0, +)) / Double(tiles.count) }
    XCTAssertGreaterThan(meanX(ring), meanX(still))
    XCTAssertGreaterThanOrEqual(ring.map(\.x).max()!, still.map(\.x).max()!)
    XCTAssertEqual(ring.count, Set(ring).count)
    // Speed pushes the centre further than half a span: 30 s at 40 m/s is 1.2 km.
    let fast = WatchMapTilePlan.ring(rider(courseDeg: 90, speedMps: 40), zoom: 15)
    XCTAssertGreaterThan(fast.map(\.x).max()!, ring.map(\.x).max()!)
  }

  func testTheRingWrapsAcrossTheAntimeridian() {
    let last = (1 << 15) - 1
    let ring = WatchMapTilePlan.ring(rider(WatchMapPosition(latitude: 0, longitude: 179.999)), zoom: 15)
    XCTAssertTrue(ring.contains { $0.x == last })
    XCTAssertTrue(ring.contains { $0.x == 0 })
    XCTAssertTrue(ring.allSatisfy(\.isValid))
    let west = WatchMapTilePlan.ring(rider(WatchMapPosition(latitude: 0, longitude: -179.999), courseDeg: 270), zoom: 15)
    XCTAssertTrue(west.contains { $0.x == last })
  }

  func testTheCapDropsLeastRecentlyNeededTilesBehindTheRiderFirst() {
    let north = rider(courseDeg: 0)
    let here = WatchMapTilePlan.ring(north, zoom: 15)[0]
    let behindOld = WatchMapTileNeed(tile: WatchMapTile(z: 15, x: here.x, y: here.y + 5), neededAt: 1)
    let aheadOld = WatchMapTileNeed(tile: WatchMapTile(z: 15, x: here.x, y: here.y - 5), neededAt: 1)
    let recentBehind = WatchMapTileNeed(tile: WatchMapTile(z: 15, x: here.x, y: here.y + 6), neededAt: 2)
    let kept = WatchMapTilePlan.retain(
      needed: [here], held: [behindOld, aheadOld, recentBehind], rider: north, step: 3, cap: 3)
    XCTAssertEqual(kept.map(\.tile), [here, recentBehind.tile, aheadOld.tile])
    XCTAssertEqual(kept[0].neededAt, 3)
    // Other zoom levels are not carried over.
    let other = WatchMapTileNeed(tile: WatchMapTile(z: 14, x: here.x / 2, y: here.y / 2), neededAt: 2)
    XCTAssertFalse(WatchMapTilePlan.retain(needed: [here], held: [other], rider: north, step: 3).contains { $0.tile.z == 14 })
    // The plan never exceeds the cap.
    let many = (0..<300).map { WatchMapTileNeed(tile: WatchMapTile(z: 15, x: $0, y: 0), neededAt: 1) }
    XCTAssertEqual(WatchMapTilePlan.retain(needed: [here], held: many, rider: north, step: 2).count, WatchMapTilePlan.tileCap)
  }

  func testTheLevelAZoomChangeLeftStaysBehindTheCurrentLevelsWithinTheCap() {
    let north = rider(courseDeg: 0)
    let here = WatchMapTilePlan.ring(north, zoom: 15)[0]
    let sameZoom = WatchMapTileNeed(tile: WatchMapTile(z: 15, x: here.x, y: here.y - 3), neededAt: 1)
    let previous = WatchMapTileNeed(tile: WatchMapTile(z: 16, x: here.x * 2, y: here.y * 2), neededAt: 2)
    let older = WatchMapTileNeed(tile: WatchMapTile(z: 17, x: here.x * 4, y: here.y * 4), neededAt: 2)
    let kept = WatchMapTilePlan.retain(
      needed: [here], held: [previous, older, sameZoom], rider: north, step: 3, previousZoom: 16)
    XCTAssertEqual(kept.map(\.tile), [here, sameZoom.tile, previous.tile])
    let capped = WatchMapTilePlan.retain(
      needed: [here], held: [previous, sameZoom], rider: north, step: 3, cap: 2, previousZoom: 16)
    XCTAssertEqual(capped.map(\.tile), [here, sameZoom.tile])
  }

  func testEachStepAlsoWantsTheTilesOneZoomOutFirst() {
    let needed = WatchMapTilePlan.needed(rider(courseDeg: 0), zoom: 15)
    let out = Array(needed.prefix { $0.z == 14 })
    XCTAssertTrue((1...9).contains(out.count))
    let face = WatchMapTilePlan.ring(rider(courseDeg: 0), zoom: 15, lookahead: false)
    XCTAssertEqual(Array(needed.dropFirst(out.count).prefix(face.count)), face)
    XCTAssertEqual(needed.count, Set(needed).count)
    // Every tile at the planned level is a quarter of a planned one-out tile.
    let outAll = Set(needed.filter { $0.z == 14 })
    XCTAssertTrue(needed.filter { $0.z == 15 }.allSatisfy { $0.parent.map(outAll.contains) == true })
  }

  func testSpeedNeverPushesTheDisplayAroundTheRiderOutOfThePlan() {
    let fast = rider(courseDeg: 90, speedMps: 15, spanM: 150)
    let level = zoom(150)
    let here = WatchMapTilePlan.ring(rider(spanM: 150), zoom: level)[0]
    // 30 s at 15 m/s centres the ring 450 m ahead, three spans: it misses the rider's tile.
    XCTAssertFalse(WatchMapTilePlan.ring(fast, zoom: level).contains(here))
    let needed = WatchMapTilePlan.needed(fast, zoom: level)
    XCTAssertEqual(needed.first, here.parent)
    XCTAssertEqual(needed.first { $0.z == level }, here)
  }

  func testAZoomChangeKeepsALevelOnTheWristThatCoversTheDisplay() {
    let planner = WatchMapTilePlanner()
    _ = planner.update(rider(spanM: 600))
    let z15 = Set(planner.wanted.map(\.tile).filter { $0.z == 15 })
    // Zoom in: the old level is now the one-out level, still wanted.
    _ = planner.update(rider(spanM: 300))
    var wanted = planner.wanted.map(\.tile)
    XCTAssertTrue(z15.isSubset(of: Set(wanted)))
    XCTAssertTrue(wanted.contains { $0.z == 16 })
    XCTAssertFalse(wanted.contains { $0.z == 14 })
    // Zoom back out: the z16 tiles stay as the previous level, behind z15 and z14.
    let z16 = Set(wanted.filter { $0.z == 16 })
    _ = planner.update(rider(spanM: 800))
    wanted = planner.wanted.map(\.tile)
    XCTAssertTrue(z16.isSubset(of: Set(wanted)))
    XCTAssertTrue(wanted.contains { $0.z == 14 })
    XCTAssertGreaterThan(wanted.firstIndex { $0.z == 16 }!, wanted.lastIndex { $0.z != 16 }!)
    // Two levels out: z16 is no longer the level just left.
    _ = planner.update(rider(spanM: 1_400))
    XCTAssertFalse(planner.wanted.contains { $0.tile.z == 16 })
    XCTAssertLessThanOrEqual(planner.wanted.count, WatchMapTilePlan.tileCap)
  }

  func testTheWristFillsEachCellWithItsTileElseTheOneOutQuarterElseTheLevelAZoomOutLeft() {
    let own = WatchMapTile(z: 16, x: 100, y: 200)
    let quarter = WatchMapTile(z: 16, x: 101, y: 200)
    let zoomedOut = WatchMapTile(z: 16, x: 102, y: 200)
    let empty = WatchMapTile(z: 16, x: 104, y: 200)
    let parent = WatchMapTile(z: 15, x: 50, y: 100)
    let finer = Array(zoomedOut.children.prefix(2))
    var cache = WatchMapTileCache<String>()
    for tile in [own, parent] + finer { cache.put(tile, tile.key) }
    let frame = cache.frame(cells: [own, quarter, zoomedOut, empty], held: Set([own, quarter, parent, zoomedOut] + finer))
    // One-out tiles go under, so the cell with its own tile covers that quarter of the parent.
    XCTAssertEqual(frame.draw, [parent, own] + finer)
    // Each cell waits on its own tile only; fallbacks are drawn when decoded, never decoded for it.
    XCTAssertEqual(frame.missing, [quarter, zoomedOut])
    XCTAssertTrue(cache.frame(cells: [empty], held: []).draw.isEmpty)
  }

  func testACellWithoutItsOwnTileWaitsOnTheOneOutTileElseOnTheHeldTilesOneIn() {
    let cell = WatchMapTile(z: 16, x: 100, y: 200)
    var cache = WatchMapTileCache<String>()
    XCTAssertEqual(cache.frame(cells: [cell], held: Set([cell.parent!] + cell.children)).missing, [cell.parent!])
    XCTAssertEqual(cache.frame(cells: [cell], held: Set(cell.children.prefix(3))).missing, Array(cell.children.prefix(3)))
  }

  func testADecodeIsKeptWhenTheDisplayAlreadyPinsAFullCache() {
    // Zoomed out: 12 old-level tiles fill three new cells as one-in fallbacks.
    let cells = (0..<3).map { WatchMapTile(z: 15, x: 50 + $0, y: 100) }
    let finer = cells.flatMap(\.children)
    var cache = WatchMapTileCache<String>()
    for tile in finer { cache.put(tile, tile.key) }
    let held = Set(cells + finer)
    XCTAssertEqual(cache.frame(cells: cells, held: held).missing, cells)
    cache.put(cells[0], cells[0].key)
    // Neither the new tile nor anything on screen is evicted, so the next frame does not decode it again.
    let next = cache.frame(cells: cells, held: held)
    XCTAssertEqual(next.missing, Array(cells.dropFirst()))
    XCTAssertEqual(next.draw, [cells[0]] + finer.dropFirst(4))
    XCTAssertTrue(([cells[0]] + finer).allSatisfy { cache.image($0) != nil })
  }

  func testTheRouteAnchorCrossesTheAntimeridianTheShortWay() {
    let route = WatchMapRoute(points: [WatchMapPosition(latitude: 0, longitude: 179.9), WatchMapPosition(latitude: 0, longitude: -179.9)])
    XCTAssertEqual(route.point(before: route.lengthM / 4)!.position.longitude, -179.95, accuracy: 1e-6)
  }

  func testCellsComeFromHeldTilesAtTheLevelOneOutAndOneIn() {
    let held = [
      WatchMapTile(z: 15, x: 50, y: 100), WatchMapTile(z: 16, x: 300, y: 300),
      WatchMapTile(z: 17, x: 20, y: 20), WatchMapTile(z: 18, x: 1, y: 1),
    ]
    let expected = Set(WatchMapTile(z: 15, x: 50, y: 100).children)
      .union([WatchMapTile(z: 16, x: 300, y: 300), WatchMapTile(z: 16, x: 10, y: 10)])
    XCTAssertEqual(WatchMapTile.cells(held: held, zoom: 16), expected)
  }

  func testThePlannerReplansOnANewTileANewZoomOrASharpTurnOnly() {
    let planner = WatchMapTilePlanner()
    XCTAssertTrue(planner.update(rider(courseDeg: 0)))
    XCTAssertFalse(planner.wanted.isEmpty)
    XCTAssertFalse(planner.update(rider(courseDeg: 30)))
    XCTAssertTrue(planner.update(rider(courseDeg: 90)))
    let nudged = WatchMapPosition(latitude: wroclaw.latitude, longitude: wroclaw.longitude + 0.00001)
    XCTAssertFalse(planner.update(rider(nudged, courseDeg: 90)))
    XCTAssertTrue(planner.update(rider(courseDeg: 90, spanM: 300)))
    XCTAssertEqual(Set(planner.wanted.map(\.tile.z)), [15, 16])
    // Moving a tile east keeps what was needed before, behind the fresh ring.
    let moved = WatchMapTilePlanner()
    _ = moved.update(rider())
    let before = Set(moved.wanted.map(\.tile))
    XCTAssertTrue(moved.update(rider(WatchMapPosition(latitude: wroclaw.latitude, longitude: wroclaw.longitude + 0.02))))
    XCTAssertTrue(before.isSubset(of: Set(moved.wanted.map(\.tile))))
  }

  func testRouteTilesRunAheadOfTheRidersProgressNearestAlongThePathFirst() {
    let onRoute = eastRoute(5_000).rider
    let tiles = WatchMapTilePlan.routeTiles(onRoute, zoom: 15)
    let here = WatchMapTilePlan.ring(rider(onRoute.position), zoom: 15).first!
    XCTAssertEqual(tiles.first, here)
    // Ahead only: nothing west of the corridor around the progress point.
    XCTAssertTrue(tiles.allSatisfy { $0.x >= here.x - 1 })
    // Walked in order: columns never step back by more than the corridor.
    for (a, b) in zip(tiles, tiles.dropFirst()) { XCTAssertGreaterThanOrEqual(b.x, a.x - 1) }
    // The corridor covers the path itself to its end.
    let end = WatchMapTilePlan.ring(
      rider(WatchMapPosition(latitude: wroclaw.latitude, longitude: wroclaw.longitude + 0.3)), zoom: 15
    ).first!
    XCTAssertTrue(tiles.contains(end))
    XCTAssertTrue((here.x...end.x).allSatisfy { tiles.contains(WatchMapTile(z: 15, x: $0, y: here.y)) })
    XCTAssertEqual(tiles.count, Set(tiles).count)
    XCTAssertEqual(WatchMapTilePlan.routeTiles(onRoute, zoom: 15, limit: 10).count, 10)
    XCTAssertTrue(WatchMapTilePlan.routeTiles(rider(), zoom: 15).isEmpty)
  }

  func testRouteTilesFollowTheRingAndShareItsCap() {
    let onRoute = eastRoute(5_000).rider
    let planner = WatchMapTilePlanner(cap: 40)
    _ = planner.update(onRoute)
    let ring = WatchMapTilePlan.needed(onRoute, zoom: 15)
    let wanted = planner.wanted
    XCTAssertEqual(wanted.count, 40)
    // The ring goes first, untouched by the route; route tiles fill the rest, not the ring.
    XCTAssertEqual(wanted.prefix(ring.count).map(\.tile), ring)
    XCTAssertTrue(wanted.prefix(ring.count).allSatisfy { !$0.route })
    XCTAssertTrue(wanted.dropFirst(ring.count).allSatisfy { $0.route && !ring.contains($0.tile) })
    XCTAssertEqual(
      wanted.dropFirst(ring.count).map(\.tile),
      Array(WatchMapTilePlan.routeTiles(onRoute, zoom: 15).filter { !ring.contains($0) }.prefix(40 - ring.count)))
  }

  func testRouteTilesReplanWithProgressAndLeaveWithTheRoute() {
    let (start, route) = eastRoute(5_000)
    let planner = WatchMapTilePlanner()
    XCTAssertTrue(planner.update(start))
    func moved(_ route: WatchMapRoute, doneM: Double, _ rider: WatchMapRider) -> WatchMapRider {
      WatchMapRider(
        position: rider.position, courseDeg: rider.courseDeg, speedMps: rider.speedMps, spanM: rider.spanM,
        route: WatchMapRouteProgress(route: route, remainingM: route.lengthM - doneM))
    }
    // Same rider tile, same progress tile: nothing to do.
    XCTAssertFalse(planner.update(moved(route, doneM: 5_010, start)))
    // A new route object with the same path is a reroute.
    XCTAssertTrue(planner.update(moved(WatchMapRoute(points: route.points), doneM: 5_000, start)))
    let routeTiles = planner.wanted.filter(\.route).map(\.tile)
    XCTAssertFalse(routeTiles.isEmpty)
    // Clearing Navigation takes every route-only tile off the list at once.
    var cleared = start
    cleared.route = nil
    XCTAssertTrue(planner.update(cleared))
    XCTAssertTrue(planner.wanted.allSatisfy { !$0.route && !routeTiles.contains($0.tile) })
  }

  func testTileCornersAndKeys() {
    let tile = WatchMapTile(z: 1, x: 1, y: 0)
    XCTAssertEqual(tile.northWest.longitude, 0)
    XCTAssertEqual(tile.southEast.longitude, 180)
    XCTAssertEqual(tile.southEast.latitude, 0, accuracy: 1e-9)
    XCTAssertEqual(tile.northWest.latitude, 85.0511, accuracy: 1e-4)
    XCTAssertEqual(WatchMapTile(key: "15/17930/10979"), WatchMapTile(z: 15, x: 17930, y: 10979))
    XCTAssertNil(WatchMapTile(key: "1/2/0"))
    XCTAssertNil(WatchMapTile(key: "15/x/1"))
    let list = WatchMapTileList(style: "a/b", tiles: [tile], generation: 7)
    XCTAssertEqual(WatchMapTileList.decode(list.payload), list)
    let sent = WatchMapTileTransfer.decode(WatchMapTileTransfer.metadata(style: "a/b", tile: tile, generation: 7))
    XCTAssertEqual(sent?.tile, tile)
    XCTAssertEqual(sent?.generation, 7)
  }

  /// A receipt the latest list already planned away is not kept; one sent under a list the wrist has
  /// not seen yet waits for that list.
  func testAListSupersedesOnlyFilesSentNoLaterThanIt() {
    let kept = WatchMapTile(z: 15, x: 1, y: 2), gone = WatchMapTile(z: 15, x: 1, y: 3)
    let list = WatchMapTileList(style: "a/b", tiles: [kept], generation: 7)
    XCTAssertTrue(list.supersedes(style: "a/b", tile: gone, generation: 6))
    XCTAssertTrue(list.supersedes(style: "a/b", tile: gone, generation: 7))
    XCTAssertFalse(list.supersedes(style: "a/b", tile: gone, generation: 8))
    XCTAssertFalse(list.supersedes(style: "a/b", tile: kept, generation: 6))
    XCTAssertTrue(list.supersedes(style: "c/d", tile: kept, generation: 6))
  }
}
