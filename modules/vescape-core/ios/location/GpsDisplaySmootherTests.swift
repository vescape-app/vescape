import XCTest
@testable import VescapeCore

final class GpsDisplaySmootherTests: XCTestCase {
  let metersPerDegree = Double.pi / 180 * 6_371_000
  private func fix(_ s: GpsDisplaySmoother, _ time: Int64, _ meters: Double, speed: Double = 10) -> GpsDisplayMotion {
    s.update(latitude: 0, longitude: meters / (Double.pi / 180 * 6_371_000), timestamp: time,
      precise: true, accuracyM: 5, gpsSpeedMps: speed, courseDeg: 180, courseTimestamp: time,
      boardSpeedMps: speed, boardSpeedTimestamp: time, now: time)!
  }
  func testFullPredictionMovesContinuouslyAndGpsZeroSmoothingSnaps() {
    let s = GpsDisplaySmoother(smoothingPercent: 0, predictionPercent: 100)
    _ = fix(s, 10_000, 0)
    let m = fix(s, 11_000, 10)
    XCTAssertTrue(m.resetPosition)
    for elapsed in stride(from: Int64(0), through: 1_000, by: 100) {
      XCTAssertEqual(m.position(at: 11_000 + elapsed).longitude * metersPerDegree, 10 + Double(elapsed) / 100, accuracy: 0.00001)
    }
    let next = fix(s, 12_000, 19)
    XCTAssertEqual(next.position(at: 12_000).longitude * metersPerDegree, 19, accuracy: 0.00001)
    XCTAssertEqual(next.position(at: 12_500).longitude * metersPerDegree, 24, accuracy: 0.00001)
  }
  func testBrakingBeforeGpsAndTelemetryLossFreeze() {
    let s = GpsDisplaySmoother(smoothingPercent: 0, predictionPercent: 100)
    _ = fix(s, 10_000, 0)
    _ = fix(s, 11_000, 10)
    let before = s.motion!.position(at: 11_400)
    let stopped = s.updateSpeed(speedMps: 0, timestamp: 11_400, now: 11_400)!
    XCTAssertFalse(stopped.resetPosition)
    XCTAssertEqual(stopped.position(at: 11_400).longitude, before.longitude, accuracy: 1e-12)
    XCTAssertEqual(stopped.position(at: 11_900).longitude, before.longitude, accuracy: 1e-12)
    let restarted = s.updateSpeed(speedMps: 10, timestamp: 11_900, now: 11_900)!
    XCTAssertEqual(restarted.position(at: 12_900).longitude, restarted.position(at: 99_000).longitude, accuracy: 1e-12)
  }
  func testGpsLossDoesNotDriftForeverEvenWithFreshTelemetry() {
    let s = GpsDisplaySmoother(smoothingPercent: 0, predictionPercent: 100)
    _ = fix(s, 10_000, 0)
    _ = fix(s, 11_000, 10)
    for t in stride(from: Int64(11_500), through: 18_000, by: 500) { _ = s.updateSpeed(speedMps: 10, timestamp: t, now: t) }
    XCTAssertEqual(s.motion!.position(at: 18_000).longitude * metersPerDegree, 60, accuracy: 0.00001)
  }
  func testCorrectionContinuesWhileVelocityChangesAndSettingsPreservePosition() {
    let s = GpsDisplaySmoother(smoothingPercent: 100, predictionPercent: 25)
    _ = fix(s, 10_000, 0)
    let m = fix(s, 11_000, 10)
    XCTAssertFalse(m.resetPosition)
    XCTAssertEqual(m.position(at: 11_000).longitude * metersPerDegree, 0, accuracy: 0.00001)
    XCTAssertEqual(m.position(at: 11_500).longitude * metersPerDegree, 6.25, accuracy: 0.00001)
    let changed = s.updateSpeed(speedMps: 0, timestamp: 11_500, now: 11_500)!
    XCTAssertEqual(changed.position(at: 11_500).longitude, m.position(at: 11_500).longitude, accuracy: 1e-12)
    XCTAssertEqual(changed.position(at: 12_000).longitude * metersPerDegree, 11.25, accuracy: 0.00001)
    let settings = s.configure(smoothingPercent: 0, predictionPercent: 100, now: 11_750)!
    XCTAssertEqual(settings.position(at: 11_750).longitude, changed.position(at: 11_750).longitude, accuracy: 1e-12)
    XCTAssertFalse(settings.resetPosition)
  }
  func testPoorFixAndFirstAcquisitionDoNotInventDirection() {
    let s = GpsDisplaySmoother(smoothingPercent: 0, predictionPercent: 100)
    let first = fix(s, 10_000, 0)
    XCTAssertEqual(first.position(at: 10_500).longitude, first.toLongitude)
    let accepted = fix(s, 11_000, 10)
    let poor = s.update(latitude: 50, longitude: 50, timestamp: 11_500, precise: false, accuracyM: 200,
      gpsSpeedMps: 20, courseDeg: 0, courseTimestamp: 11_500, boardSpeedMps: 20, boardSpeedTimestamp: 11_500, now: 11_500)
    XCTAssertEqual(accepted, poor)
    s.reset()
    XCTAssertNil(s.motion)
  }
  func testAntimeridian() {
    let m = GpsDisplayMotion(fromLatitude: 0, fromLongitude: 179, toLatitude: 0, toLongitude: -179, startsAtMs: 0, endsAtMs: 1_000)
    XCTAssertEqual(m.position(at: 500).longitude, -180)
  }
}
