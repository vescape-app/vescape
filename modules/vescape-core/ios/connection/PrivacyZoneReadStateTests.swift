import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/connection/PrivacyZoneReadStateTest.kt
final class PrivacyZoneReadStateTests: XCTestCase {
  func testReadFailureBlocksEgressAndPreservesLastTrustedZones() throws {
    var state = PrivacyZoneReadState()
    XCTAssertFalse(state.allowsLocationEgress)
    try state.reload { [] }
    XCTAssertTrue(state.allowsLocationEgress, "a successfully loaded empty list may publish")
    let trusted = PrivacyZoneEntity(id: "zone", enabled: true, centerLatitudeE7: 1, centerLongitudeE7: 2, radiusMeters: 50)
    try state.reload { [trusted] }

    XCTAssertThrowsError(try state.reload { throw CocoaError(.fileReadUnknown) })
    XCTAssertFalse(state.allowsLocationEgress, "a failed refresh blocks coordinate publication")
    XCTAssertEqual(state.zones.map(\.id), ["zone"])
  }
}
