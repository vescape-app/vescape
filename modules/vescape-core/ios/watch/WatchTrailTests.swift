import Foundation
import XCTest
@testable import VescapeCore

final class WatchTrailTests: XCTestCase {
  func testSnapshotIsRelativeToCurrentRiderAndRetainsBothEndsWhenBounded() {
    let rider = WatchGeoPoint(latitude: 52, longitude: 21)
    let history: [[String: Any?]] = (0...500).map { ["latitude": 52.0, "longitude": 21.0 + Double($0) * 0.00001] }
    let trail = watchTrail(rider: rider, history: history)
    XCTAssertEqual(trail.count, 120)
    XCTAssertEqual(trail.first, WatchTrailPoint(eastM: 0, northM: 0))
    XCTAssertEqual(trail.last!.eastM, watchOffsetMeters(origin: rider, point: WatchGeoPoint(latitude: 52, longitude: 21.005)).east, accuracy: 0.001)
    let moved = watchTrail(rider: WatchGeoPoint(latitude: 52, longitude: 21.005), history: history)
    XCTAssertEqual(moved.last!.eastM, 0, accuracy: 0.001)
    XCTAssertLessThan(moved.first!.eastM, 0)
    XCTAssertTrue(watchTrail(rider: nil, history: history).isEmpty)
    XCTAssertTrue(watchTrail(rider: rider, history: []).isEmpty)
  }

  func testWireContractAndMalformedExtensions() {
    let points = [WatchTrailPoint(eastM: 1, northM: -2)]
    let expected = Data([84, 82, 2, 1, 0, 0, 0, 0, 0, 0, 240, 63, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 128, 63, 0, 0, 0, 192])
    XCTAssertEqual(WatchTrailCodec.encode(points, position: WatchMapPosition(latitude: 1, longitude: 2)), expected)
    XCTAssertEqual(WatchTrailCodec.decode(expected, offset: 0).points, points)
    XCTAssertEqual(WatchTrailCodec.decode(expected, offset: 0).position, WatchMapPosition(latitude: 1, longitude: 2))
    XCTAssertEqual(WatchTrailCodec.decode(Data([0, 0]) + expected, offset: 2).points, points)
    XCTAssertTrue(WatchTrailCodec.decode(expected.dropLast(), offset: 0).points.isEmpty)
    var unknown = expected
    unknown[2] = 99
    XCTAssertTrue(WatchTrailCodec.decode(unknown, offset: 0).points.isEmpty)
    unknown = expected
    unknown[3] = 121
    XCTAssertTrue(WatchTrailCodec.decode(unknown, offset: 0).points.isEmpty)
    XCTAssertTrue(WatchTrailCodec.decode(WatchTrailCodec.encode([WatchTrailPoint(eastM: .nan, northM: 0)]), offset: 0).points.isEmpty)
  }

  func testFullFrameCarriesTrailAndOldFramesClearIt() throws {
    let trail = [WatchTrailPoint(eastM: -10, northM: -20), WatchTrailPoint(eastM: 0, northM: 0)]
    let frame = WatchFrameBuilder.build(snapshot: WatchSnapshot(trail: trail, mapPosition: WatchMapPosition(latitude: 52, longitude: 21)), stale: false)
    let data = WatchFrameBuilder.encode(frame)
    XCTAssertEqual(try XCTUnwrap(WatchFrameBuilder.decode(data)).trail, trail)
    XCTAssertEqual(try XCTUnwrap(WatchFrameBuilder.decode(data)).mapPosition, frame.mapPosition)
    XCTAssertTrue(try XCTUnwrap(WatchFrameBuilder.decode(data.prefix(WATCH_FRAME_BYTES))).trail.isEmpty)
    XCTAssertTrue(try XCTUnwrap(WatchFrameBuilder.decode(data.dropLast())).trail.isEmpty)
    XCTAssertTrue(try XCTUnwrap(WatchFrameBuilder.decode(WatchFrameBuilder.encode(WatchFrame()))).trail.isEmpty)
  }
}
