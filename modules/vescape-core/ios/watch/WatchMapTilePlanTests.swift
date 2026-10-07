import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchMapTilePlanTest.kt
final class WatchMapTilePlanTests: XCTestCase {
  private let wroclaw = WatchMapPosition(latitude: 51.13185, longitude: 16.98653)

  private func rider(
    _ position: WatchMapPosition? = nil, courseDeg: Double? = nil, speedMps: Double? = nil, spanM: Double? = nil
  ) -> WatchMapRider {
    WatchMapRider(position: position ?? wroclaw, courseDeg: courseDeg, speedMps: speedMps, spanM: spanM)
  }

  private func zoom(_ spanM: Double?, _ latitude: Double? = nil, current: Int? = nil) -> Int {
    WatchMapTilePlan.zoom(spanM: spanM, latitude: latitude ?? wroclaw.latitude, current: current)
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

  func testThePlannerReplansOnANewTileANewZoomOrASharpTurnOnly() {
    let planner = WatchMapTilePlanner()
    XCTAssertTrue(planner.update(rider(courseDeg: 0)))
    XCTAssertFalse(planner.wanted.isEmpty)
    XCTAssertFalse(planner.update(rider(courseDeg: 30)))
    XCTAssertTrue(planner.update(rider(courseDeg: 90)))
    let nudged = WatchMapPosition(latitude: wroclaw.latitude, longitude: wroclaw.longitude + 0.00001)
    XCTAssertFalse(planner.update(rider(nudged, courseDeg: 90)))
    XCTAssertTrue(planner.update(rider(courseDeg: 90, spanM: 300)))
    XCTAssertTrue(planner.wanted.allSatisfy { $0.tile.z == 16 })
    // Moving a tile east keeps what was needed before, behind the fresh ring.
    let moved = WatchMapTilePlanner()
    _ = moved.update(rider())
    let before = Set(moved.wanted.map(\.tile))
    XCTAssertTrue(moved.update(rider(WatchMapPosition(latitude: wroclaw.latitude, longitude: wroclaw.longitude + 0.02))))
    XCTAssertTrue(before.isSubset(of: Set(moved.wanted.map(\.tile))))
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
    let list = WatchMapTileList(style: "a/b", tiles: [tile])
    XCTAssertEqual(WatchMapTileList.decode(list.payload), list)
    XCTAssertEqual(WatchMapTileTransfer.decode(WatchMapTileTransfer.metadata(style: "a/b", tile: tile))?.tile, tile)
  }
}
