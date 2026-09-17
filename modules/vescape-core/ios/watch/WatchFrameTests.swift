import XCTest
@testable import VescapeCore

/// Round-trips the Watch Frame wire contract: build a frame, encode it, decode it back.
///
/// Unlike Android — where the wrist decoder lives in a separate Gradle app and the test has to
/// re-declare it — the decoder here is the production one, symlinked into `watch/watchos/`. So the
/// round trip alone cannot catch a lane reorder: both directions would move together. The byte
/// layout test below is what pins the order, and it is the test to read first when the wrist starts
/// showing the wrong number in the right place.
///
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

  /// Pins lane order and header layout against the Android encoder, which shares neither code nor
  /// compiler with this one. A reordered lane changes this test and nothing else.
  func testByteLayoutMatchesTheDeclaredLaneOrder() {
    let frame = WatchFrame(
      speed: 1, duty: 2, battery: 3, motorTemp: 4, ctrlTemp: 5, stale: true,
      navBearing: 6, navDistanceM: 7, riderEastM: 8, riderNorthM: 9, courseDeg: 10, routeSpanM: 11
    )
    let data = WatchFrameBuilder.encode(frame)

    XCTAssertEqual(data.count, WATCH_FRAME_BYTES)
    XCTAssertEqual(Int(data[0]), WATCH_FRAME_FIELD_COUNT)
    // Only the stale bit: the legacy "waiting" bit is never set by this phone side.
    XCTAssertEqual(Int(data[1]), WATCH_FRAME_FLAG_STALE)
    for index in 0..<WATCH_FRAME_FIELD_COUNT {
      XCTAssertEqual(lane(data, index), Float(index + 1), "lane \(index)")
    }
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

  /// Lanes are Float32 on the wire, so a Double that is not exactly representable comes back
  /// rounded. That is the contract, not a defect — the wrist renders one decimal place.
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

  /// A frame with no board and no navigation is the normal idle case, not an error: every lane rides
  /// as the `NaN` sentinel and decodes back to nil, which is how the wrist greys out.
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

  /// A phone and a wrist built from different commits can disagree about lane count. Misreading
  /// every lane is worse than showing nothing, so the mismatch is rejected rather than truncated.
  func testDecodeRejectsAFieldCountMismatch() {
    var data = WatchFrameBuilder.encode(WatchFrame(speed: 1, stale: false))
    data[0] = UInt8(WATCH_FRAME_FIELD_COUNT + 1)
    XCTAssertNil(WatchFrameBuilder.decode(data))
  }
}
