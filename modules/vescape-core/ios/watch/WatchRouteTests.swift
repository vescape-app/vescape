import XCTest
@testable import VescapeCore

/// The route wire contract. The clear is the one worth the most care: the Application Context is
/// latest-value-wins with no delete, so a clear that rode as an absent key would be indistinguishable
/// from a push that never arrived, and a reconnecting wrist would restore the route the rider cleared.
final class WatchRouteTests: XCTestCase {
  private let warsaw = WatchGeoPoint(latitude: 52.2297, longitude: 21.0122)

  private func line(_ count: Int, stepDeg: Double = 0.001) -> [WatchGeoPoint] {
    (0..<count).map {
      WatchGeoPoint(
        latitude: warsaw.latitude + Double($0) * stepDeg,
        longitude: warsaw.longitude + Double($0) * stepDeg
      )
    }
  }

  private func context(_ points: [WatchGeoPoint]) -> [String: Any] {
    [watchRouteChannel: WatchRouteCodec.payload(points: points)]
  }

  func testRoundTripPlacesEveryPointInMetresFromTheOrigin() throws {
    let route = try XCTUnwrap(WatchRoute.decode(context: context(line(4))))

    XCTAssertEqual(route.points.count, 4)
    // The origin is the drawing frame's zero by definition, on both wrists.
    XCTAssertEqual(route.points[0].eastM, 0, accuracy: 0.0001)
    XCTAssertEqual(route.points[0].northM, 0, accuracy: 0.0001)
    // 0.001° of latitude is ~110.6 m; longitude is squeezed by the origin's latitude.
    XCTAssertEqual(route.points[1].northM, 110.574, accuracy: 0.01)
    XCTAssertEqual(route.points[1].eastM, 111.320 * cos(warsaw.latitude * .pi / 180), accuracy: 0.01)
    XCTAssertEqual(route.points[3].northM, 3 * 110.574, accuracy: 0.01)
  }

  func testDeltasDoNotAccumulateRoundingAlongALongRoute() throws {
    // A step that is not a whole micro-degree: rounding each hop against the source point instead
    // of against what the decoder reconstructs drifts, and drift is invisible until it is metres.
    let route = try XCTUnwrap(WatchRoute.decode(context: context(line(500, stepDeg: 0.0000015))))
    let last = try XCTUnwrap(route.points.last)
    XCTAssertEqual(last.northM, 499 * 0.0000015 * 110_574, accuracy: 0.2)
  }

  func testAClearedRouteIsAnExplicitPayloadAndNotAnAbsentChannel() {
    let cleared = WatchRouteCodec.payload(points: [])

    // The channel is present, so it replaces the route already in the context rather than leaving
    // it there — which is the whole reason the clear is a payload.
    XCTAssertEqual(cleared[WatchRouteKey.version] as? Int, WATCH_ROUTE_VERSION)
    XCTAssertNil(cleared[WatchRouteKey.points])
    XCTAssertNil(WatchRoute.decode(context: [watchRouteChannel: cleared]))
  }

  func testAClearReplacesTheRouteInAMergedContext() {
    let wire = ContextWire()
    let coldState = WatchColdState(
      context: { wire.context }, write: { wire.context = $0 }, record: { _, _ in }
    )
    coldState.put(channel: watchRouteChannel, payload: WatchRouteCodec.payload(points: line(3)))
    XCTAssertNotNil(WatchRoute.decode(context: wire.context))

    coldState.put(channel: watchRouteChannel, payload: WatchRouteCodec.payload(points: []))
    XCTAssertNil(WatchRoute.decode(context: wire.context))
  }

  func testAnAbsentChannelIsNoRoute() {
    XCTAssertNil(WatchRoute.decode(context: [:]))
    XCTAssertNil(WatchRoute.decode(context: ["weather": ["temperatureC": 4]]))
  }

  func testAVersionThisBuildDoesNotKnowDegradesToNoRoute() {
    var payload = WatchRouteCodec.payload(points: line(3))
    payload[WatchRouteKey.version] = WATCH_ROUTE_VERSION + 1
    XCTAssertNil(WatchRoute.decode(context: [watchRouteChannel: payload]))
  }

  func testAMalformedOrTruncatedPayloadDegradesToNoRoute() throws {
    let packed = try XCTUnwrap(WatchRouteCodec.encode(line(8)))
    // A buffer that claims eight points but carries three.
    let truncated = packed.prefix(WATCH_ROUTE_HEADER_BYTES + 2 * 8)
    XCTAssertNil(
      WatchRoute.decode(
        context: [watchRouteChannel: [
          WatchRouteKey.version: WATCH_ROUTE_VERSION, WatchRouteKey.points: Data(truncated),
        ]]
      )
    )
    // A header that is not a header at all, and a points value of the wrong type entirely.
    XCTAssertNil(WatchRouteCodec.decode(Data([1, 2, 3])))
    XCTAssertNil(
      WatchRoute.decode(
        context: [watchRouteChannel: [
          WatchRouteKey.version: WATCH_ROUTE_VERSION, WatchRouteKey.points: "not a polyline",
        ]]
      )
    )
    // The version byte inside the packed buffer must agree too: a newer phone that kept the
    // dictionary shape is still a route this build cannot draw.
    var wrongVersion = packed
    wrongVersion[wrongVersion.startIndex] = UInt8(WATCH_ROUTE_VERSION + 1)
    XCTAssertNil(WatchRouteCodec.decode(wrongVersion))
  }

  func testADenseRouteIsStridedDownWithItsEndpointsKept() throws {
    let dense = line(WATCH_ROUTE_MAX_POINTS * 3, stepDeg: 0.00001)
    let route = try XCTUnwrap(WatchRoute.decode(context: context(dense)))

    XCTAssertEqual(route.points.count, WATCH_ROUTE_MAX_POINTS)
    // The whole route still spans the same ground: a thinned polyline that lost its tail would
    // draw the rider riding off the end of it.
    let expected = watchOffsetMeters(origin: dense[0], point: dense[dense.count - 1])
    let last = try XCTUnwrap(route.points.last)
    XCTAssertEqual(last.northM, expected.north, accuracy: 1)
    XCTAssertEqual(last.eastM, expected.east, accuracy: 1)
    // The origin the phone measures the rider against is the *kept* first point, so the two halves
    // of the wrist picture cannot disagree about where zero is.
    XCTAssertEqual(WatchRouteCodec.origin(points: dense), dense[0])
  }

  func testTheOriginOfAClearedRouteIsNothingToMeasureAgainst() {
    XCTAssertNil(WatchRouteCodec.origin(points: []))
  }

  func testOffsetMetresAreEastAndNorthOfTheOrigin() {
    let north = watchOffsetMeters(
      origin: warsaw,
      point: WatchGeoPoint(latitude: warsaw.latitude + 0.01, longitude: warsaw.longitude)
    )
    XCTAssertEqual(north.north, 1105.74, accuracy: 0.1)
    XCTAssertEqual(north.east, 0, accuracy: 0.0001)

    let west = watchOffsetMeters(
      origin: warsaw,
      point: WatchGeoPoint(latitude: warsaw.latitude, longitude: warsaw.longitude - 0.01)
    )
    XCTAssertLessThan(west.east, 0)
  }

  /// The remaining distance both wrists read off the same frame. Java rounds halves up and C rounds
  /// them to even, so the exact halves are where the two would disagree.
  func testDistanceLabelMatchesAndroidsRounding() {
    XCTAssertEqual(WatchGauge.distance(0), "0 m")
    XCTAssertEqual(WatchGauge.distance(679.4), "679 m")
    XCTAssertEqual(WatchGauge.distance(2.5), "3 m")
    XCTAssertEqual(WatchGauge.distance(999.4), "999 m")
    XCTAssertEqual(WatchGauge.distance(1000), "1.0 km")
    XCTAssertEqual(WatchGauge.distance(1250), "1.3 km")
    XCTAssertEqual(WatchGauge.distance(12_345), "12.3 km")
  }

  private final class ContextWire {
    var context: [String: Any] = [:]
  }
}
