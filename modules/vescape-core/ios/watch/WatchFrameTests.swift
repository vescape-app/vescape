import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchFrameTest.kt
final class WatchFrameTests: XCTestCase {
  private func roundTrip(_ frame: WatchFrame) -> WatchFrame? {
    WatchFrameBuilder.decode(WatchFrameBuilder.encode(frame))
  }

  private func lane(_ data: Data, _ index: Int) -> Float {
    let offset = 2 + index * 4
    let raw = data.subdata(in: offset..<(offset + 4))
    return Float(bitPattern: raw.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self).littleEndian })
  }

  func testByteLayoutMatchesTheDeclaredLaneOrder() {
    let frame = WatchFrame(
      speed: 1, duty: 2, battery: 3, motorTemp: 4, ctrlTemp: 5, stale: true,
      navBearing: 6, navDistanceM: 7, riderEastM: 8, riderNorthM: 9, courseDeg: 10, routeSpanM: 11,
      remoteTilt: 12, tiltControl: .blocked
    )
    let data = WatchFrameBuilder.encode(frame)

    XCTAssertEqual(data.count, WATCH_FRAME_BYTES + 20)
    XCTAssertEqual(Int(data[0]), WATCH_FRAME_FIELD_COUNT)
    XCTAssertEqual(Int(data[1]), WATCH_FRAME_FLAG_STALE)
    for index in 0..<12 {
      XCTAssertEqual(lane(data, index), Float(index + 1), "lane \(index)")
    }
    XCTAssertEqual(lane(data, 12), 4)
  }

  func testRemoteTiltAndWhoMayDriveItRoundTripAndTiltIsNilWithoutABoard() throws {
    let tilted = try XCTUnwrap(roundTrip(
      WatchFrame(speed: 1, duty: 2, battery: 3, motorTemp: 4, ctrlTemp: 5, remoteTilt: 200, tiltControl: .sensor)
    ))
    XCTAssertEqual(tilted.remoteTilt, 200)
    XCTAssertEqual(tilted.tiltControl, .sensor)

    let boardless = try XCTUnwrap(roundTrip(WatchFrame(stale: true)))
    XCTAssertNil(boardless.remoteTilt)
    XCTAssertEqual(boardless.tiltControl, .free)
  }

  func testSnapshotTiltReachesTheFrame() {
    let frame = WatchFrameBuilder.build(
      snapshot: WatchSnapshot(speed: 3, remoteTilt: 160, tiltControl: .manual),
      stale: false
    )
    XCTAssertEqual(frame.remoteTilt, 160)
    XCTAssertEqual(frame.tiltControl, .manual)
  }

  func testAnUnknownTiltControlCodeKeepsTheStickReadOnly() {
    XCTAssertEqual(WatchTiltControl(wire: 9), .blocked)
    XCTAssertFalse(WatchTiltControl(wire: 9).drivable)
    XCTAssertEqual(WatchTiltControl(wire: nil), .free)
    XCTAssertEqual(WatchTiltControl(wire: 1), .manual)
    XCTAssertEqual(WatchTiltControl.allCases.filter(\.drivable), [.free, .manual])
  }

  func testTiltControlWireCodesMatchAndroid() {
    XCTAssertEqual(WatchTiltControl.allCases.map(\.rawValue), [0, 1, 2, 3, 4])
  }

  func testBuildsFromSnapshotWithAbsSpeedAndDutyScaledToPercent() throws {
    let frame = WatchFrameBuilder.build(
      snapshot: WatchSnapshot(
        speed: -12.5, dutyCycle: -0.4, dutyExcluded: false,
        batterySoc: 78, motorTemp: 42, ctrlTemp: 38
      ),
      stale: false
    )
    XCTAssertEqual(frame.speed, 12.5)
    XCTAssertEqual(try XCTUnwrap(frame.duty), 40, accuracy: 1e-3)
  }

  func testExcludedDutyBecomesNullInTheFrame() {
    let frame = WatchFrameBuilder.build(
      snapshot: WatchSnapshot(speed: 3, dutyCycle: 0.9, dutyExcluded: true, batterySoc: 50),
      stale: false
    )
    XCTAssertNil(frame.duty)
  }

  func testRoundTripsAllLanesAndTheStaleFlag() throws {
    let frame = WatchFrame(
      speed: 21.3, duty: 64, battery: 73, motorTemp: 51, ctrlTemp: 47, stale: false,
      navBearing: 128, navDistanceM: 1350, riderEastM: -40.5, riderNorthM: 12.25,
      courseDeg: 271, routeSpanM: 725
    )
    let decoded = try XCTUnwrap(roundTrip(frame))

    XCTAssertEqual(try XCTUnwrap(decoded.speed), 21.3, accuracy: 1e-5)
    XCTAssertEqual(decoded.duty, 64)
    XCTAssertEqual(decoded.battery, 73)
    XCTAssertEqual(decoded.motorTemp, 51)
    XCTAssertEqual(decoded.ctrlTemp, 47)
    XCTAssertEqual(decoded.stale, false)
    XCTAssertEqual(decoded.navBearing, 128)
    XCTAssertEqual(decoded.navDistanceM, 1350)
    XCTAssertEqual(decoded.riderEastM, -40.5)
    XCTAssertEqual(decoded.riderNorthM, 12.25)
    XCTAssertEqual(decoded.courseDeg, 271)
    XCTAssertEqual(decoded.routeSpanM, 725)
  }

  func testRoundTripsNullSentinelLanes() {
    let decoded = roundTrip(WatchFrame(speed: 0, stale: true))
    XCTAssertEqual(decoded?.speed, 0)
    XCTAssertNil(decoded?.duty)
    XCTAssertNil(decoded?.battery)
    XCTAssertNil(decoded?.motorTemp)
    XCTAssertNil(decoded?.ctrlTemp)
    XCTAssertNil(decoded?.navBearing)
    XCTAssertNil(decoded?.routeSpanM)
    XCTAssertEqual(decoded?.stale, true)
  }

  func testDecodeRejectsAShortBuffer() {
    XCTAssertNil(WatchFrameBuilder.decode(Data(count: WATCH_FRAME_BYTES - 1)))
  }

  func testDecodeRejectsAFieldCountMismatch() {
    var data = WatchFrameBuilder.encode(WatchFrame(speed: 1, stale: false))
    data[0] = UInt8(WATCH_FRAME_FIELD_COUNT + 1)
    XCTAssertNil(WatchFrameBuilder.decode(data))
  }
}
