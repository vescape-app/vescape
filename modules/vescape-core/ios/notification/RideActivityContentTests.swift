import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/notification/NotificationPresenterTest.kt
final class RideActivityContentTests: XCTestCase {

  func testDeviceNameIsPartOfMutableContentState() {
    let renamed = RideActivityContent.state(
      deviceName: "Renamed ADV",
      phase: .connected,
      batteryPercent: 64,
      batteryVoltage: 75.13,
      faultCode: nil
    )

    XCTAssertEqual(renamed.deviceName, "Renamed ADV")
  }

  func testDeviceNameFallsBackToVesc() {
    let unnamed = RideActivityContent.state(
      deviceName: "",
      phase: .connecting,
      batteryPercent: nil,
      batteryVoltage: nil,
      faultCode: nil
    )

    XCTAssertEqual(unnamed.deviceName, "VESC")
  }

  func testStatusTextConnectedWithPercentIncludesVoltage() {
    XCTAssertEqual(
      RideActivityContent.statusText(
        phase: .connected, batteryPercent: 45, batteryVoltage: 75.13, faultCode: nil),
      "45% (75.1V)"
    )
  }

  func testStatusTextConnectedWithoutPercentFallsBackToVoltage() {
    XCTAssertEqual(
      RideActivityContent.statusText(
        phase: .connected, batteryPercent: nil, batteryVoltage: 75.13, faultCode: nil),
      "75.1V"
    )
  }

  func testStatusTextFaultTakesPrecedenceOverBattery() {
    XCTAssertEqual(
      RideActivityContent.statusText(
        phase: .connected, batteryPercent: 45, batteryVoltage: 75.13, faultCode: 7),
      "Fault detected (code 7)"
    )
  }

  func testShortCriticalConnectedPrefersPercent() {
    XCTAssertEqual(
      RideActivityContent.shortCritical(
        phase: .connected, batteryPercent: 45, batteryVoltage: 75.13, faultCode: nil),
      "45%"
    )
  }

  func testShortCriticalConnectedFallsBackToVoltage() {
    XCTAssertEqual(
      RideActivityContent.shortCritical(
        phase: .connected, batteryPercent: nil, batteryVoltage: 75.13, faultCode: nil),
      "75.1V"
    )
  }

  func testTopRideNoticeRidesInContentState() {
    let notice = RideNoticeContent(
      severity: .warning, title: "Rider stopped", details: "Details", postedAt: 0, location: nil, expiresAt: nil)
    let state = RideActivityContent.state(
      deviceName: "ADV", phase: .reconnecting, batteryPercent: nil, batteryVoltage: nil, faultCode: nil, notice: notice)

    XCTAssertEqual(state.noticeTitle, "Rider stopped")
    XCTAssertEqual(state.noticeSeverity, "warning")
  }

  /// An activity started by a build without notice fields must still decode.
  func testContentStateFromOlderBuildDecodesWithoutNotice() throws {
    let json = Data(
      #"{"deviceName":"ADV","phase":"connected","statusText":"Connected","shortCritical":"45%","batteryPercent":45}"#
        .utf8)
    let state = try JSONDecoder().decode(RideActivityAttributes.ContentState.self, from: json)

    XCTAssertEqual(state.deviceName, "ADV")
    XCTAssertNil(state.noticeTitle)
    XCTAssertNil(state.noticeSeverity)
  }
}
