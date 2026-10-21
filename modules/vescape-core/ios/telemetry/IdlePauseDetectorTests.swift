import XCTest

@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/IdlePauseDetectorTest.kt
final class IdlePauseDetectorTests: XCTestCase {
  func testDisengagementPausesImmediatelyWithoutRepeatedTransitions() {
    let d = IdlePauseDetector()
    XCTAssertNil(d.onSample(state: 1))
    XCTAssertEqual(.paused, d.onSample(state: 9))
    XCTAssertTrue(d.isPaused)
    XCTAssertNil(d.onSample(state: 9))
    XCTAssertNil(d.onSample(state: 6))
    XCTAssertEqual(.resumed, d.onSample(state: 1))
    XCTAssertFalse(d.isPaused)
    XCTAssertNil(d.onSample(state: 1))
    XCTAssertNil(d.onSample(state: 2))
    XCTAssertNil(d.onSample(state: 3))
    XCTAssertEqual(.paused, d.onSample(state: 9))
  }

  func testAllPackedStatesUseOnlyEngagementNibble() {
    for sat in 0...15 {
      for state in 0...15 {
        let d = IdlePauseDetector()
        _ = d.onSample(state: 9)
        let transition = d.onSample(state: (sat << 4) | state)
        if (1...3).contains(state) {
          XCTAssertEqual(.resumed, transition)
          XCTAssertFalse(d.isPaused)
        } else {
          XCTAssertNil(transition)
          XCTAssertTrue(d.isPaused)
        }
      }
    }
  }

  func testResetClearsOldSessionAndNextDisengagedSamplePausesImmediately() {
    let d = IdlePauseDetector()
    XCTAssertEqual(.paused, d.onSample(state: 0))
    d.reset()
    XCTAssertFalse(d.isPaused)
    XCTAssertNil(d.onSample(state: 1))
    XCTAssertEqual(.paused, d.onSample(state: 15))
  }
}
