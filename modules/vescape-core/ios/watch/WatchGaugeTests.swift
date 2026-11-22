import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt
/// @parity /watch/wearos/src/test/java/app/vescape/wear/ReplayFixtureParserTest.kt
final class WatchGaugeTests: XCTestCase {
  private static let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("watch/wearos/src/main/assets")

  private func load(_ fixture: String) throws -> [ReplaySample] {
    let text = try String(contentsOf: Self.fixtures.appendingPathComponent(fixture), encoding: .utf8)
    return ReplayFixtureParser.parse(text: text)
  }

  private func fixtureOrigin() throws -> WatchMapPosition {
    let json = try String(contentsOf: Self.fixtures.appendingPathComponent("watch-route.json"), encoding: .utf8)
    return try XCTUnwrap(ReplaySceneParser.parseOrigin(json: json))
  }

  func testRideFixtureKeepsMovingAndShowingItsTrailAfterNavigationEnds() throws {
    let text = try String(contentsOf: Self.fixtures.appendingPathComponent("watch-ride.jsonl"), encoding: .utf8)
    let origin = try fixtureOrigin()
    for wander in [false, true] {
      let samples = ReplayFixtureParser.parse(text: text, wander: wander, origin: origin)
      let arrival = try XCTUnwrap(samples.firstIndex { $0.frame.navBearingDeg == nil })
      XCTAssertGreaterThan(arrival, 0)
      let after = samples.dropFirst(arrival)
      XCTAssertFalse(after.isEmpty)
      XCTAssertTrue(after.allSatisfy { $0.frame.mapPosition != nil && $0.frame.trail.count > 1 })
      XCTAssertNotEqual(after.first?.frame.mapPosition, after.last?.frame.mapPosition)
    }
  }

  func testSeededDetoursMoveSmoothlyOffRouteThenRejoinAndTrailFollowsActualPositions() throws {
    let lines = (0...240).map { i in
      "{\"t\":\(i * 500),\"speed\":21.6,\"riderEast\":0,\"riderNorth\":\(i * 3),\"course\":0,\"navBearing\":0,\"navDistance\":2000}"
    }
    let straight = ReplayFixtureParser.parse(lines)
    let detour = ReplayFixtureParser.parse(lines, wander: true)
    XCTAssertEqual(detour.map(\.frame), ReplayFixtureParser.parse(lines, wander: true).map(\.frame))
    XCTAssertEqual(straight.first?.frame, detour.first?.frame)
    XCTAssertEqual(detour.last?.frame.riderEastM, 0)
    XCTAssertEqual(detour.last?.frame.riderNorthM, 720)
    XCTAssertTrue(detour.contains { abs($0.frame.riderEastM!) > 15 })
    XCTAssertTrue(detour.contains { abs($0.frame.courseDeg!) > 5 })
    for i in 1..<detour.count {
      let frame = detour[i].frame
      let previous = detour[i - 1].frame
      XCTAssertLessThan(hypot(frame.riderEastM! - previous.riderEastM!, frame.riderNorthM! - previous.riderNorthM!), 5)
      XCTAssertEqual(frame.navBearingDeg, straight[i].frame.navBearingDeg)
      XCTAssertEqual(frame.trail.first!.eastM, -frame.riderEastM!, accuracy: 0.0001)
      XCTAssertEqual(frame.trail.first!.northM, -frame.riderNorthM!, accuracy: 0.0001)
      XCTAssertEqual(frame.trail.last!.eastM, 0)
      XCTAssertEqual(frame.trail.last!.northM, 0)
    }
  }

  func testReplayRouteMatchesSharedRiderCoordinates() throws {
    let json = try String(
      contentsOf: Self.fixtures.appendingPathComponent("watch-route.json"), encoding: .utf8
    )
    let route = try XCTUnwrap(ReplaySceneParser.parseRoute(json: json))
    let samples = try load("watch-sweep.jsonl")
    XCTAssertGreaterThan(route.points.count, 1)
    XCTAssertEqual(route.points[0].eastM, samples[0].frame.riderEastM)
    XCTAssertEqual(route.points[0].northM, samples[0].frame.riderNorthM)
    XCTAssertEqual(route.points[1], WatchRoutePoint(eastM: 0, northM: 25))
  }

  func testReplayRouteRejectsMissingOrMalformedGeometry() {
    for json in ["{}", "{", #"{"points":[]}"#, #"{"points":[{"east":0}]}"#] {
      XCTAssertNil(ReplaySceneParser.parseRoute(json: json))
    }
  }

  func testDecodesTheRecordedRideFixture() throws {
    let samples = try load("watch-ride.jsonl")

    XCTAssertGreaterThan(samples.count, 1_000)
    XCTAssertEqual(samples[0].atMs, 0)
    XCTAssertEqual(try XCTUnwrap(samples[0].frame.speed), 8.3, accuracy: 0.001)
    XCTAssertEqual(try XCTUnwrap(samples[0].frame.duty), 17, accuracy: 0.001)
    XCTAssertEqual(samples[1].atMs, 500)
    for (previous, next) in zip(samples, samples.dropFirst()) {
      XCTAssertLessThanOrEqual(previous.atMs, next.atMs)
    }
  }

  func testEveryLaneInTheSweepFixtureProducesADrawableFraction() throws {
    let samples = try load("watch-sweep.jsonl")
    XCTAssertFalse(samples.isEmpty)

    var sawFullBattery = false
    var sawEmptyBattery = false
    for sample in samples {
      let frame = sample.frame
      for fraction in [
        WatchGauge.speedFraction(frame.speed),
        WatchGauge.dutyFraction(frame.duty),
        WatchGauge.batteryFraction(frame.battery),
        WatchGauge.tempFraction(frame.motorTemp),
        WatchGauge.tempFraction(frame.ctrlTemp),
      ] {
        XCTAssertTrue((0...1).contains(fraction), "fraction \(fraction) at t=\(sample.atMs)")
      }
      let battery = WatchGauge.batteryFraction(frame.battery)
      if battery >= 1 { sawFullBattery = true }
      if battery <= 0 { sawEmptyBattery = true }
    }
    XCTAssertTrue(sawFullBattery)
    XCTAssertTrue(sawEmptyBattery)
  }

  func testFractionsClampRatherThanRescale() {
    XCTAssertEqual(WatchGauge.speedFraction(0), 0)
    XCTAssertEqual(WatchGauge.speedFraction(25), 0.5, accuracy: 0.0001)
    XCTAssertEqual(WatchGauge.speedFraction(120), 1)
    XCTAssertEqual(WatchGauge.dutyFraction(-20), 0)
    XCTAssertEqual(WatchGauge.dutyFraction(140), 1)
    XCTAssertEqual(WatchGauge.tempFraction(-40), 0)
    XCTAssertEqual(WatchGauge.tempFraction(WatchGauge.tempMax + 10), 1)
    XCTAssertEqual(WatchGauge.tempFraction(60), 0.5, accuracy: 0.0001)
  }

  func testAnUnreportedLaneParksAtTheFloor() {
    XCTAssertEqual(WatchGauge.speedFraction(nil), 0)
    XCTAssertEqual(WatchGauge.dutyFraction(nil), 0)
    XCTAssertEqual(WatchGauge.batteryFraction(nil), 0)
    XCTAssertEqual(WatchGauge.tempFraction(nil), 0)
  }

  func testFormattingMatchesTheAndroidReadouts() {
    XCTAssertEqual(WatchGauge.hero(0), "0")
    XCTAssertEqual(WatchGauge.hero(18.4), "18")
    XCTAssertEqual(WatchGauge.temp(51.4), "51°")
    XCTAssertEqual(WatchGauge.batteryPercent(83.7), "84%")
  }

  func testExactHalvesRoundAwayFromZeroLikeAndroid() {
    XCTAssertEqual(WatchGauge.hero(18.5), "19")
    XCTAssertEqual(WatchGauge.hero(17.5), "18")
    XCTAssertEqual(WatchGauge.temp(0.5), "1°")
    XCTAssertEqual(WatchGauge.batteryPercent(2.5), "3%")
  }

  func testANonFiniteLaneReadsAsADash() {
    XCTAssertEqual(WatchGauge.hero(.infinity), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.temp(.nan), WatchGauge.dash)
  }

  func testAnAbsentLaneReadsAsADashAndNeverAsZero() {
    XCTAssertEqual(WatchGauge.hero(nil), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.temp(nil), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.batteryPercent(nil), WatchGauge.dash)
  }

  func testAmbientBlindEmptiesEveryReadout() {
    XCTAssertEqual(WatchGauge.hero(42, blind: true), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.temp(42, blind: true), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.batteryPercent(42, blind: true), WatchGauge.dash)
  }

  func testNullLanesStayNullSoTheGaugesRenderThemAsUnreported() {
    let samples = ReplayFixtureParser.parse([
      #"{"t":0,"speed":12,"duty":null,"battery":null,"motorTemp":null,"ctrlTemp":null}"#
    ])

    XCTAssertNil(samples[0].frame.duty)
    XCTAssertNil(samples[0].frame.battery)
    XCTAssertNil(samples[0].frame.motorTemp)
    XCTAssertNil(samples[0].frame.ctrlTemp)
  }

  func testStaleDefaultsToFalseAndIsHonouredWhenSet() {
    let samples = ReplayFixtureParser.parse([
      #"{"t":0,"speed":12,"duty":1,"battery":1,"motorTemp":1,"ctrlTemp":1}"#,
      #"{"t":500,"speed":12,"duty":1,"battery":1,"motorTemp":1,"ctrlTemp":1,"stale":true}"#,
    ])

    XCTAssertFalse(samples[0].frame.stale)
    XCTAssertTrue(samples[1].frame.stale)
  }

  func testMalformedAndBlankLinesAreSkippedNotFatal() {
    let samples = ReplayFixtureParser.parse([
      "",
      "not json",
      #"{"t":0,"duty":17}"#,
      #"{"t":1000,"speed":20,"duty":30,"battery":50,"motorTemp":40,"ctrlTemp":30}"#,
    ])

    XCTAssertEqual(samples.count, 1)
    XCTAssertEqual(samples[0].atMs, 1_000)
  }

  func testShippedStreetMapTilesSitUnderEveryReplayedRiderPosition() throws {
    let json = try String(contentsOf: Self.fixtures.appendingPathComponent("watch-map-tiles.json"), encoding: .utf8)
    let tiles = try XCTUnwrap(ReplaySceneParser.parseMapTiles(json: json)).tiles
    XCTAssertFalse(tiles.isEmpty)
    for tile in tiles {
      XCTAssertTrue(FileManager.default.fileExists(atPath: Self.fixtures.appendingPathComponent("watch-map-tiles/\(tile.key).jpg").path))
    }
    let origin = try fixtureOrigin()
    for fixture in ["watch-ride.jsonl", "watch-sweep.jsonl"] {
      let text = try String(contentsOf: Self.fixtures.appendingPathComponent(fixture), encoding: .utf8)
      let positions = ReplayFixtureParser.parse(text: text, wander: true, origin: origin).compactMap(\.frame.mapPosition)
      XCTAssertFalse(positions.isEmpty)
      for position in positions {
        XCTAssertTrue(tiles.contains { tile in
          position.latitude <= tile.northWest.latitude && position.latitude > tile.southEast.latitude
            && position.longitude >= tile.northWest.longitude && position.longitude < tile.southEast.longitude
        }, "\(fixture): no tile under \(position)")
      }
    }
  }
}
