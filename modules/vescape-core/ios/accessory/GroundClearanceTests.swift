import XCTest

@testable import VescapeCore

/// The ground-clearance contract, driven by `shared/fixtures/accessory-protocol/session.json`: what
/// a sample decodes to, what the declared range does to it, which samples are accepted, and what a
/// saved calibration turns a distance into.
///
/// The property most of these cases exist to defend is one sentence: **a missing measurement is
/// never a distance.** Every way a reading can fail to be one — no value, a null value, a textual
/// value, a status from a newer firmware, a number outside the declared window — has a case here,
/// and all of them end at `error` or `outOfRange` with no value attached. None of them ends at the
/// top of the range, which is the reading that would tell a board it is safe to tilt.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/GroundClearanceTest.kt
final class GroundClearanceTests: XCTestCase {
  private func fixture() throws -> [String: Any] { try AccessoryFixtures.load("session.json") }
  private func readings() throws -> [String: Any] {
    try XCTUnwrap(fixture()["readings"] as? [String: Any])
  }
  private func groundClearance() throws -> [String: Any] {
    try XCTUnwrap(fixture()["groundClearance"] as? [String: Any])
  }

  private func declaredRange(_ owner: [String: Any]) throws -> (Double, Double) {
    let range = try XCTUnwrap(owner["declaredRange"] as? [String: Any])
    return (
      try XCTUnwrap((range["min"] as? NSNumber)?.doubleValue),
      try XCTUnwrap((range["max"] as? NSNumber)?.doubleValue)
    )
  }

  func testEverySampleDecodesExactlyAsTheFixturePinsIt() throws {
    let sessionId = try XCTUnwrap(fixture()["sessionId"] as? String)
    let cases = try XCTUnwrap(readings()["decode"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty, "fixture must carry reading decode cases")

    for entry in cases {
      let name = (entry["name"] as? String) ?? "?"
      let parsed = AccessoryResponse.parse(
        line: try XCTUnwrap(entry["line"] as? String, name), sessionId: sessionId)

      if (entry["ignored"] as? Bool) == true {
        XCTAssertEqual(parsed, .ignored, name)
        continue
      }
      let expected = try XCTUnwrap(entry["reading"] as? [String: Any], name)
      guard case .sample(let reading) = parsed else {
        XCTFail("\(name): expected a sample, got \(parsed)")
        continue
      }
      XCTAssertEqual(reading.capabilityId, expected["capabilityId"] as? String, name)
      XCTAssertEqual(reading.seq, expected["seq"] as? Int, name)
      XCTAssertEqual(reading.sampleTimeMs, (expected["sampleTimeMs"] as? NSNumber)?.int64Value, name)
      XCTAssertEqual(reading.status.rawValue, expected["status"] as? String, name)
      XCTAssertEqual(reading.valueCm, (expected["valueCm"] as? NSNumber)?.doubleValue, name)
    }
  }

  func testAValueOutsideTheDeclaredWindowIsOutOfRangeRatherThanClamped() throws {
    let readings = try readings()
    let (min, max) = try declaredRange(readings)
    let capabilityId = try XCTUnwrap(readings["capabilityId"] as? String)
    for entry in try XCTUnwrap(readings["rangeCheck"] as? [[String: Any]]) {
      let name = (entry["name"] as? String) ?? "?"
      let reading = AccessoryReading(
        capabilityId: capabilityId, seq: 1, sampleTimeMs: 100, status: .ok,
        valueCm: try XCTUnwrap((entry["valueCm"] as? NSNumber)?.doubleValue, name)
      ).withinDeclaredRange(rangeMin: min, rangeMax: max)

      XCTAssertEqual(reading.status.rawValue, entry["resolvedStatus"] as? String, name)
      // The whole point: a number the hardware no longer promises loses its value rather than being
      // squeezed to the nearest limit.
      XCTAssertEqual(reading.valueCm, (entry["resolvedValueCm"] as? NSNumber)?.doubleValue, name)
    }
  }

  func testOnlyASampleNewerThanTheOneHeldIsAccepted() throws {
    let readings = try readings()
    let capabilityId = try XCTUnwrap(readings["capabilityId"] as? String)
    for entry in try XCTUnwrap(readings["acceptance"] as? [[String: Any]]) {
      let name = (entry["name"] as? String) ?? "?"
      let tracker = AccessoryReadingTracker()
      if let previous = entry["previous"] as? [String: Any] {
        XCTAssertTrue(
          tracker.accept(
            AccessoryReading(
              capabilityId: capabilityId,
              seq: try XCTUnwrap(previous["seq"] as? Int, name),
              sampleTimeMs: try XCTUnwrap((previous["sampleTimeMs"] as? NSNumber)?.int64Value, name),
              status: .ok, valueCm: 10),
            receivedAtMs: 1_000),
          "\(name): seeding the previous sample must succeed")
      }
      let accepted = tracker.accept(
        AccessoryReading(
          capabilityId: capabilityId,
          seq: try XCTUnwrap(entry["seq"] as? Int, name),
          sampleTimeMs: try XCTUnwrap((entry["sampleTimeMs"] as? NSNumber)?.int64Value, name),
          status: .ok, valueCm: 11),
        receivedAtMs: 2_000)
      XCTAssertEqual(accepted, entry["accepted"] as? Bool, name)
    }
  }

  func testAFreshSessionKeepsNothingFromTheOldOne() {
    // Sequence numbers restart with the next hello. Without the reset the new session's first
    // samples would be refused as duplicates and the screen would sit on a distance measured before
    // the accessory rebooted.
    let tracker = AccessoryReadingTracker()
    let ok = AccessoryReading(
      capabilityId: "clearance", seq: 40, sampleTimeMs: 9_000, status: .ok, valueCm: 12)
    XCTAssertTrue(tracker.accept(ok, receivedAtMs: 1_000))
    tracker.reset()
    XCTAssertNil(tracker.latest)
    XCTAssertTrue(
      tracker.accept(
        AccessoryReading(
          capabilityId: "clearance", seq: 1, sampleTimeMs: 50, status: .ok, valueCm: 12),
        receivedAtMs: 2_000))
  }

  func testFreshnessIsJudgedOnTheRateTheAccessoryConfirmed() throws {
    for entry in try XCTUnwrap(readings()["staleAfterMs"] as? [[String: Any]]) {
      let name = (entry["name"] as? String) ?? "?"
      XCTAssertEqual(
        GroundClearance.staleAfterMs(
          rateHz: try XCTUnwrap((entry["rateHz"] as? NSNumber)?.doubleValue, name)),
        (entry["staleAfterMs"] as? NSNumber)?.int64Value, name)
    }
    // An unacknowledged rate is not a reason to widen the window; the floor still applies.
    XCTAssertEqual(GroundClearance.staleAfterMs(rateHz: 0), GroundClearance.missingStreamFloorMs)
    XCTAssertEqual(GroundClearance.staleAfterMs(rateHz: .nan), GroundClearance.missingStreamFloorMs)
  }

  func testACalibrationIsCompleteOnlyWhenEveryRuleHolds() throws {
    let groundClearance = try groundClearance()
    let (min, max) = try declaredRange(groundClearance)
    for entry in try XCTUnwrap(groundClearance["validity"] as? [[String: Any]]) {
      let name = (entry["name"] as? String) ?? "?"
      let spec = try XCTUnwrap(entry["calibration"] as? [String: Any], name)
      let calibration = GroundClearanceCalibration(
        nearCm: (spec["nearCm"] as? NSNumber)?.doubleValue ?? .nan,
        farCm: (spec["farCm"] as? NSNumber)?.doubleValue ?? .nan,
        direction: try XCTUnwrap(spec["direction"] as? String, name),
        strengthPercent: try XCTUnwrap(spec["strengthPercent"] as? Int, name))
      XCTAssertEqual(
        calibration.isComplete(rangeMin: min, rangeMax: max), entry["valid"] as? Bool, name)
      XCTAssertEqual(
        calibration.problem(rangeMin: min, rangeMax: max)?.rawValue, entry["problem"] as? String,
        name)
    }
  }

  func testOneDistanceBecomesTheSignedInputTheFixturePins() throws {
    for entry in try XCTUnwrap(groundClearance()["tilt"] as? [[String: Any]]) {
      let name = (entry["name"] as? String) ?? "?"
      let spec = try XCTUnwrap(entry["calibration"] as? [String: Any], name)
      let calibration = GroundClearanceCalibration(
        nearCm: try XCTUnwrap((spec["nearCm"] as? NSNumber)?.doubleValue, name),
        farCm: try XCTUnwrap((spec["farCm"] as? NSNumber)?.doubleValue, name),
        direction: try XCTUnwrap(spec["direction"] as? String, name),
        strengthPercent: try XCTUnwrap(spec["strengthPercent"] as? Int, name))
      XCTAssertEqual(
        calibration.tiltInput(
          valueCm: try XCTUnwrap((entry["valueCm"] as? NSNumber)?.doubleValue, name)),
        try XCTUnwrap((entry["tiltInput"] as? NSNumber)?.doubleValue, name),
        accuracy: 1e-9, name)
    }
  }

  func testMeasurementIsDemandedByAPreviewOrByRidingACalibratedBoard() {
    let runtime = GroundClearanceRuntime(capabilityId: "clearance")
    runtime.rangeMin = 3
    runtime.rangeMax = 100
    XCTAssertFalse(runtime.measurementDemanded, "nothing wants it")

    runtime.previewOpen = true
    XCTAssertTrue(
      runtime.measurementDemanded,
      "a preview measures even uncalibrated — that is how a calibration is made")

    runtime.previewOpen = false
    runtime.riding = true
    // Riding an uncalibrated sensor measures nothing: there is no binding to consume the samples, so
    // the accessory would burn power producing them for nobody.
    XCTAssertFalse(runtime.measurementDemanded, "riding without a calibration has no consumer")

    runtime.calibration = GroundClearanceCalibration(
      nearCm: 5, farCm: 20, direction: "nose", strengthPercent: 60)
    XCTAssertTrue(runtime.measurementDemanded)

    // A firmware that narrowed its range invalidates the saved numbers, and with them the demand.
    runtime.rangeMin = 8
    XCTAssertFalse(runtime.measurementDemanded, "a calibration that no longer fits drives nothing")
  }

  func testATiltBindingIsReleasedWithANamedReasonForEveryWayTheInputCanFail() {
    let runtime = GroundClearanceRuntime(capabilityId: "clearance")
    runtime.rangeMin = 3
    runtime.rangeMax = 100
    runtime.rateHz = 20

    XCTAssertEqual(runtime.input(nowMs: 1_000, linkConnected: true), .release(reason: .notRiding))
    runtime.riding = true
    XCTAssertEqual(runtime.input(nowMs: 1_000, linkConnected: false), .release(reason: .noLink))
    XCTAssertEqual(
      runtime.input(nowMs: 1_000, linkConnected: true), .release(reason: .notCalibrated))

    runtime.calibration = GroundClearanceCalibration(
      nearCm: 5, farCm: 20, direction: "nose", strengthPercent: 100)
    // Calibrated, connected, riding — and no sample has ever arrived. That is stale, not zero.
    XCTAssertEqual(runtime.input(nowMs: 1_000, linkConnected: true), .release(reason: .stale))

    runtime.tracker.accept(
      AccessoryReading(
        capabilityId: "clearance", seq: 1, sampleTimeMs: 100, status: .ok, valueCm: 12.5),
      receivedAtMs: 1_000)
    XCTAssertEqual(
      runtime.input(nowMs: 1_100, linkConnected: true), .drive(tiltInput: 0.5, valueCm: 12.5))
    // Past the missing-stream window the same sample is no longer evidence of anything.
    XCTAssertEqual(runtime.input(nowMs: 1_400, linkConnected: true), .release(reason: .stale))

    runtime.tracker.accept(
      AccessoryReading(
        capabilityId: "clearance", seq: 2, sampleTimeMs: 150, status: .outOfRange, valueCm: nil),
      receivedAtMs: 1_400)
    XCTAssertEqual(runtime.input(nowMs: 1_450, linkConnected: true), .release(reason: .outOfRange))

    runtime.tracker.accept(
      AccessoryReading(
        capabilityId: "clearance", seq: 3, sampleTimeMs: 200, status: .error, valueCm: nil),
      receivedAtMs: 1_500)
    XCTAssertEqual(runtime.input(nowMs: 1_550, linkConnected: true), .release(reason: .sensorError))
  }

  func testANonOkReadingCannotHoldAValue() {
    // The type refuses the pairing that would make a status and a number disagree, which is what
    // lets every consumer treat "has a value" as "is a measurement".
    let reading = AccessoryReading(
      capabilityId: "clearance", seq: 1, sampleTimeMs: 100, status: .outOfRange, valueCm: 12)
    XCTAssertNil(reading.valueCm)
  }

  func testBindingControllerPreservesDemandLimitsAndContestedOwnership() throws {
    let controller = GroundClearanceBindingController(nowMs: { 1_100 })
    func capability(_ id: String, min: Double = 3, max: Double = 100) -> AccessoryCapability {
      AccessoryCapability(
        id: id, type: AccessoryProtocol.typeGroundClearance, supported: true, unit: "cm",
        rangeMin: min, rangeMax: max, ratesHz: [20])
    }
    _ = controller.applyCapability(
      accessoryId: "front", capability: capability("clearance"), liveManifest: true, rateHz: 20)
    controller.applyCalibration(
      "front", "clearance",
      GroundClearanceCalibration(nearCm: 5, farCm: 30, direction: "nose", strengthPercent: 60))
    XCTAssertTrue(controller.setRiding(true))
    _ = controller.applyCapability(
      accessoryId: "front", capability: capability("clearance", min: 10, max: 20),
      liveManifest: false, rateHz: 20)
    let description = try XCTUnwrap(controller.describe("front", "clearance"))
    let calibration = try XCTUnwrap(description["calibration"] as? [String: Any?])
    XCTAssertNil(calibration["problem"] ?? nil)

    XCTAssertTrue(controller.setPreview("front", "clearance", open: true))
    XCTAssertTrue(controller.releasePreviews())
    XCTAssertEqual(controller.describe("front", "clearance")?["measuring"] as? Bool, true)

    _ = controller.applyCapability(
      accessoryId: "rear", capability: capability("clearance"), liveManifest: true, rateHz: 20)
    controller.applyCalibration(
      "rear", "clearance",
      GroundClearanceCalibration(nearCm: 5, farCm: 30, direction: "tail", strengthPercent: 60))
    _ = controller.applyCapability(
      accessoryId: "rear", capability: capability("clearance"), liveManifest: false, rateHz: 20)
    let connected = { (_: String, _: String) in
      GroundClearanceBindingController.LinkState(connected: true, appliedRateHz: 20)
    }
    XCTAssertTrue(controller.bound(connected))
    XCTAssertEqual(controller.tilt(connected), .release(reason: .contested))
  }

  func testBindingControllerEmitsOnlyForPreviewAndInvalidatesSessionReadings() {
    let controller = GroundClearanceBindingController(nowMs: { 1_100 })
    let capability = AccessoryCapability(
      id: "clearance", type: AccessoryProtocol.typeGroundClearance, supported: true, unit: "cm",
      rangeMin: 3, rangeMax: 100, ratesHz: [20])
    _ = controller.applyCapability(
      accessoryId: "sensor", capability: capability, liveManifest: true, rateHz: 20)
    controller.applyCalibration(
      "sensor", "clearance",
      GroundClearanceCalibration(nearCm: 5, farCm: 20, direction: "nose", strengthPercent: 100))
    _ = controller.setRiding(true)
    _ = controller.applyCapability(
      accessoryId: "sensor", capability: capability, liveManifest: false, rateHz: 20)
    let reading = AccessoryReading(
      capabilityId: "clearance", seq: 1, sampleTimeMs: 100, status: .ok, valueCm: 12.5)
    XCTAssertNil(controller.acceptReading("sensor", reading, receivedAtMs: 1_000, appliedRateHz: 20))
    _ = controller.setPreview("sensor", "clearance", open: true)
    let next = AccessoryReading(
      capabilityId: "clearance", seq: 2, sampleTimeMs: 110, status: .ok, valueCm: 12.5)
    XCTAssertNotNil(controller.acceptReading("sensor", next, receivedAtMs: 1_000, appliedRateHz: 20))
    controller.onSessionLost("sensor")
    XCTAssertEqual(
      controller.input(
        "sensor", "clearance",
        link: GroundClearanceBindingController.LinkState(connected: true, appliedRateHz: 20)),
      .release(reason: .stale))
  }
}
