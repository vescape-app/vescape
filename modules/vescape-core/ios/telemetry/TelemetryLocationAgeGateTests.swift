import XCTest

@testable import VescapeCore

/// ADR 0034 "Recording never fabricates GPS": a frame records the fix only while it is fresh, so a
/// dead GPS produces honest gaps instead of thousands of samples repeating one frozen coordinate.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryMapper.kt `freshEnoughToRecord`
final class TelemetryLocationAgeGateTests: XCTestCase {
  private let capturedAtMs: Int64 = 1_700_000_000_000

  private func fix(agedMs: Int64) -> TelemetryLocationCapture {
    TelemetryLocationCapture(
      latitude: 52.23,
      longitude: 21.01,
      speedMps: 4.2,
      bearingDeg: 90,
      accuracyM: 5,
      altitudeM: 110,
      timestamp: capturedAtMs - agedMs,
      precise: true
    )
  }

  private func gated(agedMs: Int64) -> TelemetryLocationCapture? {
    telemetryLocationFreshEnoughToRecord(fix(agedMs: agedMs), capturedAtMs: capturedAtMs)
  }

  func testFixOlderThanTheGateIsNotRecorded() {
    XCTAssertNil(gated(agedMs: 11_000))
  }

  func testFreshFixIsRecorded() {
    XCTAssertEqual(gated(agedMs: 9_000)?.timestamp, capturedAtMs - 9_000)
  }

  func testGateBoundaryIsInclusive() {
    XCTAssertNotNil(gated(agedMs: telemetryLocationMaxAgeMs))
    XCTAssertNil(gated(agedMs: telemetryLocationMaxAgeMs + 1))
  }

  /// A fix stamped slightly ahead of the packet clock is skew, not staleness.
  func testFutureFixIsRecorded() {
    XCTAssertNotNil(gated(agedMs: -2_000))
  }

  func testMissingFixStaysMissing() {
    XCTAssertNil(telemetryLocationFreshEnoughToRecord(nil, capturedAtMs: capturedAtMs))
  }
}
