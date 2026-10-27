import XCTest
@testable import VescapeCore

/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchMotionFactsTest.kt
final class WatchMotionFactsTests: XCTestCase {
  private func facts(_ sent: Double, source: Double = 1793100000001, fix: Double = 1793100000011) -> WatchMotionFacts {
    WatchMotionFacts(sourceId: source, fixTimestamp: fix, sentAt: sent, gpsAgeMs: 20, boardAgeMs: 30, accuracyM: 3)
  }
  func testFactsSurviveActualFloat32WireAndLegacyFallbackKeepsTrail() throws {
    let input = facts(1793100000999)
    let frame = WatchFrame(speed: 20, trail: [WatchTrailPoint(eastM: 1, northM: 2)], motionFacts: input, mapPosition: WatchMapPosition(latitude: 51, longitude: 17))
    let bytes = WatchFrameBuilder.encode(frame)
    let decoded = try XCTUnwrap(WatchFrameBuilder.decode(bytes))
    XCTAssertEqual(decoded.motionFacts, input)
    let legacy = WatchFrameBuilder.legacyFrame(bytes)
    XCTAssertEqual(legacy.first, 13)
    let old = try XCTUnwrap(WatchFrameBuilder.decode(legacy))
    XCTAssertNil(old.motionFacts)
    XCTAssertEqual(old.trail, frame.trail)
    XCTAssertEqual(old.mapPosition, frame.mapPosition)
    XCTAssertNil(WatchMotionFacts.decode([Double](repeating: .nan, count: 9)))
  }
  func testDifferentDeviceClocksDelayedFramesAndSourceReset() throws {
    let c = WatchMotionClock(), epoch = 1793100000000.0
    XCTAssertEqual(c.accept(facts(epoch), now: 10_000), 0)
    XCTAssertEqual(c.accept(facts(epoch + 250), now: 10_250), 0)
    XCTAssertEqual(c.accept(facts(epoch + 500), now: 11_000), 500)
    XCTAssertNil(c.accept(facts(epoch + 250), now: 11_100))
    XCTAssertEqual(c.accept(facts(epoch + 1250, source: 1793100000002), now: 12_000), 0)
    XCTAssertNil(c.accept(facts(epoch + 2000), now: 13_000))
  }
  func testSpeedFramesNeverRestartGpsCorrectionAndCameraLagsPoint() throws {
    let display = WatchDisplayMotion(), epoch = 1793100000000.0
    func feed(_ east: Double, _ fix: Double, _ now: Double, _ speed: Double) {
      var f = facts(epoch + now, fix: fix); f.gpsAgeMs = now - fix; f.boardAgeMs = 0
      XCTAssertTrue(display.accept(WatchMapPosition(latitude: 0, longitude: east / 111320), facts: f, speed: speed, now: now))
    }
    feed(0, 0, 0, 20)
    _ = display.offset(0)
    feed(10, 1000, 1000, 20)
    _ = display.offset(1000)
    for i in 1...18 { _ = display.offset(1000 + Double(i) * 1000 / 60) }
    feed(10, 1000, 1300, 10)
    for i in 1...18 { _ = display.offset(1300 + Double(i) * 1000 / 60) }
    feed(10, 1000, 1600, 0)
    XCTAssertEqual(try XCTUnwrap(display.model.position(2000)).longitude * 111320, 11.25, accuracy: 0.0001)
    XCTAssertGreaterThan(display.riderOffset(1900).eastM, 0)
    XCTAssertEqual(try XCTUnwrap(display.model.position(2500)).longitude * 111320, 11.25, accuracy: 0.0001)
  }
  func testResetWithoutFixRejectsAnOldFrameBeforeGeometryCanReturn() {
    var intake = WatchMirrorIntake()
    let first = WatchFrame(motionFacts: facts(1793100000000))
    let reset = WatchFrame(motionFacts: facts(1793100000100, source: 1793100000002))
    XCTAssertTrue(intake.acceptTelemetry(WatchFrameBuilder.encode(first), receivedAtMs: 0, appliedAtMs: 0))
    XCTAssertTrue(intake.acceptTelemetry(WatchFrameBuilder.encode(reset), receivedAtMs: 100, appliedAtMs: 100))
    XCTAssertFalse(intake.acceptTelemetry(WatchFrameBuilder.encode(first), receivedAtMs: 200, appliedAtMs: 200))
  }
  func testReplayRateChangesPreservePositionAndMeasuredTimestamps() throws {
    let display = WatchDisplayMotion(), epoch = 1793100000000.0
    var first = facts(epoch, fix: 100000); first.gpsAgeMs = 0; first.clockRate = 4
    XCTAssertTrue(display.accept(WatchMapPosition(latitude: 0, longitude: 0), facts: first, speed: nil, now: 0))
    var next = first; next.sentAt = epoch + 250; next.fixTimestamp = 101000
    let position = WatchMapPosition(latitude: 0, longitude: 10 / 111320)
    XCTAssertTrue(display.accept(position, facts: next, speed: nil, now: 250))
    XCTAssertEqual(try XCTUnwrap(display.position(375)).longitude * 111320, 5, accuracy: 0.0001)
    next.sentAt = epoch + 375; next.gpsAgeMs = 500; next.clockRate = 1
    XCTAssertTrue(display.accept(position, facts: next, speed: nil, now: 375))
    XCTAssertEqual(try XCTUnwrap(display.position(375)).longitude * 111320, 5, accuracy: 0.0001)
    XCTAssertEqual(try XCTUnwrap(display.position(875)).longitude * 111320, 10, accuracy: 0.0001)
  }

}
