import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/LiveWindowPeakTest.kt
final class LiveWindowPeakTests: XCTestCase {

  private func row(_ speed: Double?) -> [String: Any?] { ["speed": speed] }
  private func peak() -> LiveWindowPeak { LiveWindowPeak { $0["speed"] as? Double } }

  func testTracksTheHighestSampleAdded() {
    let p = peak()
    let window = [row(10), row(30), row(nil), row(20)]
    window.forEach(p.add)
    XCTAssertEqual(p.value(window), 30)
  }

  func testFallsBackToTheNextHighestWhenThePeakRollsOff() {
    let p = peak()
    var window = [row(30), row(10), row(20)]
    window.forEach(p.add)
    p.evict(window.removeFirst())
    XCTAssertEqual(p.value(window), 20)
  }

  func testResetForgetsThePeak() {
    let p = peak()
    p.add(row(30))
    p.reset()
    XCTAssertNil(p.value([]))
  }
}
