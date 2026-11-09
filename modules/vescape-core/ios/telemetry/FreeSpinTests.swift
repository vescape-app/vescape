import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/sanitizers/FreeSpinMetricSanitizerTest.kt
final class FreeSpinTests: XCTestCase {
  /// A wheel in the air: 20 → 40 km/h in half a second on a few amps.
  private lazy var spinUp = [sample(0, 20, 10), sample(500, 40, 5)]

  func testSpinUpOnLittleCurrentIsExcludedFromEverySpeedMetric() {
    let result = sanitizeTelemetrySamples(spinUp)

    XCTAssertEqual(freeSpin(result), [false, true])
    let spin = result.samples[1]
    XCTAssertTrue(spin.excludedFromAvgSpeed && spin.excludedFromMaxSpeed && spin.excludedFromMaxDuty)
    XCTAssertEqual(result.exclusions.filter { $0.reason == EXCLUSION_REASON_FREE_SPIN }.map(\.startMs), [500])
  }

  func testTheSameClimbWithARiderOnBoardIsKept() {
    let result = sanitizeTelemetrySamples([sample(0, 20, 100), sample(500, 40, 120)])

    XCTAssertEqual(freeSpin(result), [false, false])
  }

  func testSpinUpWhileRidingBackwardsIsExcluded() {
    let result = sanitizeTelemetrySamples([sample(0, -20, -10), sample(500, -40, -5)])

    XCTAssertEqual(freeSpin(result), [false, true])
  }

  func testSamplesTooFarApartAreNotReadAsAClimb() {
    let result = sanitizeTelemetrySamples([sample(0, 20, 5), sample(1_600, 45, 5)])

    XCTAssertEqual(freeSpin(result), [false, false])
  }

  func testSteadySpinningAfterASpinUpStaysExcludedUntilThreeLoadedSamples() {
    let result = sanitizeTelemetrySamples(spinUp + [
      sample(1_000, 40, 10),
      sample(1_500, 40, 10),
      // Landed: braking that takes a rider's worth of current.
      sample(2_000, 38, -60),
      sample(2_500, 36, -60),
      sample(3_000, 34, -60),
      sample(3_500, 34, 10),
    ])

    XCTAssertEqual(freeSpin(result), [false, true, true, true, true, true, false, false])
  }

  func testOneLoadedLookingSampleDoesNotEndTheSpin() {
    let result = sanitizeTelemetrySamples(spinUp + [
      sample(1_000, 38, -60),
      sample(1_500, 38, 10),
      sample(2_000, 36, -60),
    ])

    XCTAssertEqual(freeSpin(result), [false, true, true, true, true])
  }

  func testSpinEndsWhenSpeedReturnsToWhereItStarted() {
    let result = sanitizeTelemetrySamples(spinUp + [sample(1_000, 30, 0), sample(1_500, 24, 0)])

    XCTAssertEqual(freeSpin(result), [false, true, true, false])
  }

  func testSpinTimesOutAfterFifteenSecondsWhileTheMotorWorks() {
    let result = sanitizeTelemetrySamples(spinUp + (1...17).map { sample(500 + Int64($0) * 1_000, 40, 10) })

    XCTAssertTrue(freeSpin(result)[1..<16].allSatisfy { $0 })
    XCTAssertEqual(Array(freeSpin(result).suffix(2)), [false, false])
  }

  func testWheelHeldAtTheSpeedLimitInTheAirStaysExcludedPastTheTimeout() {
    let result = sanitizeTelemetrySamples(spinUp + (1...30).map { sample(500 + Int64($0) * 1_000, 40, 1) })

    XCTAssertTrue(freeSpin(result).dropFirst().allSatisfy { $0 })
  }

  func testASpinCrossingTwoBatchesStaysExcluded() {
    let first = sanitizeTelemetrySamples(spinUp)
    let second = sanitizeTelemetrySamples(
      [sample(1_000, 40, 10), sample(1_500, 40, 10)],
      freeSpinCarry: first.freeSpinCarry
    )

    XCTAssertEqual(freeSpin(second), [true, true])
  }

  func testBoardsAreReadSeparately() {
    let result = sanitizeTelemetrySamples([
      sample(0, 20, 10, board: "a"),
      sample(250, 0, 0, board: "b"),
      sample(500, 40, 5, board: "a"),
      sample(750, 0, 0, board: "b"),
    ])

    XCTAssertEqual(freeSpin(result), [false, false, true, false])
  }

  private func freeSpin(_ result: SanitizationResult) -> [Bool] {
    result.samples.map(\.excludedFromMaxSpeed)
  }

  private func sample(_ atMs: Int64, _ speedKmh: Double, _ motorCurrentA: Double, board: String = "board-1") -> BucketTelemetryPoint {
    BucketTelemetryPoint(
      capturedAtMs: atMs,
      boardId: board,
      speedCentiKmh: Int(speedKmh * 100),
      batteryVoltageMv: 80_000,
      motorCurrentMa: Int(motorCurrentA * 1_000),
      batteryCurrentMa: 0,
      dutyPermille: 500,
      odometerCm: nil,
      tempMosfetDeciC: nil,
      tempMotorDeciC: nil
    )
  }
}
