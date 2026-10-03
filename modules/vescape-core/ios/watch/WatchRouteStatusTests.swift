import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchRouteStatusTest.kt
final class WatchRouteStatusTests: XCTestCase {
  func testLoaderFollowsMatchingRouteReceiptPositionReplacementAndClear() {
    XCTAssertEqual(WatchRouteStatus(phase: .computing).notice(receivedRouteId: 7, hasPosition: true), .computing)
    let pending = WatchRouteStatus(phase: .ready, routeId: 42)
    XCTAssertEqual(pending.notice(receivedRouteId: nil, hasPosition: true), .receiving)
    XCTAssertEqual(pending.notice(receivedRouteId: 7, hasPosition: true), .receiving)
    XCTAssertFalse(pending.canDraw(receivedRouteId: 7))
    XCTAssertEqual(pending.notice(receivedRouteId: 42, hasPosition: false), .location)
    XCTAssertNil(pending.notice(receivedRouteId: 42, hasPosition: true))
    XCTAssertTrue(pending.canDraw(receivedRouteId: 42))
    XCTAssertEqual(WatchRouteStatus(phase: .failed).notice(receivedRouteId: 42, hasPosition: true), .failed)
    XCTAssertNil(WatchRouteStatus(phase: .idle).notice(receivedRouteId: 42, hasPosition: true))
    XCTAssertFalse(WatchRouteStatus(phase: .idle).canDraw(receivedRouteId: 42))
  }

  func testWirePreservesUnsignedIdsAndRejectsUnsupportedOrTruncatedMessages() {
    let status = WatchRouteStatus(phase: .ready, routeId: 0xfedcba98)
    let encoded = WatchRouteStatusCodec.encode(status)
    XCTAssertEqual(encoded, Data([1, 2, 0x98, 0xba, 0xdc, 0xfe]))
    XCTAssertEqual(WatchRouteStatusCodec.decode(encoded), status)
    XCTAssertNil(WatchRouteStatusCodec.decode(encoded.prefix(5)))
    XCTAssertNil(WatchRouteStatusCodec.decode(Data([2, 2, 0, 0, 0, 0])))
    XCTAssertNil(WatchRouteStatusCodec.decode(Data([1, 99, 0, 0, 0, 0])))
    XCTAssertEqual(WatchRouteStatusCodec.routeId(Data("hello".utf8)), 0x4f9f2cab)
  }
}
