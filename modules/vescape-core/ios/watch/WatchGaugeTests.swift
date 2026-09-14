import XCTest
@testable import VescapeCore

/// The rectangular layout is an accepted visual difference from the circular Wear OS one
/// (docs/watchos.md); the numbers behind it are not. These run the Android replay fixtures — the
/// same files `bun run wear:replay` feeds the Wear OS mirror — through the watchOS arithmetic and
/// formatting, so a lane that reads 42% on one wrist cannot read 0.42 on the other.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/FrameGauges.kt
/// @parity /watch/wearos/src/test/java/app/vescape/wear/ReplayFixtureParserTest.kt
final class WatchGaugeTests: XCTestCase {
  /// Tests read fixtures straight off the repo tree — the convention `Package.swift` documents, and
  /// the reason these are the Wear OS assets rather than a copy that could drift from them.
  private static let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // watch
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // vescape-core
    .deletingLastPathComponent()  // modules
    .deletingLastPathComponent()  // repo root
    .appendingPathComponent("watch/wearos/src/main/assets")

  private func load(_ fixture: String) throws -> [ReplaySample] {
    let text = try String(contentsOf: Self.fixtures.appendingPathComponent(fixture), encoding: .utf8)
    return ReplayFixtureParser.parse(text: text)
  }

  // MARK: - Decoding the shared fixtures

  func testDecodesTheRecordedRideFixture() throws {
    let samples = try load("watch-ride.jsonl")

    XCTAssertGreaterThan(samples.count, 1_000)
    XCTAssertEqual(samples[0].atMs, 0)
    XCTAssertEqual(try XCTUnwrap(samples[0].frame.speed), 8.3, accuracy: 0.001)
    XCTAssertEqual(try XCTUnwrap(samples[0].frame.duty), 17, accuracy: 0.001)
    XCTAssertEqual(samples[1].atMs, 500)
    // Recorded time only ever moves forward; a replay that jumped backwards would stall the pacer.
    for (previous, next) in zip(samples, samples.dropFirst()) {
      XCTAssertLessThanOrEqual(previous.atMs, next.atMs)
    }
  }

  /// The sweep fixture exists to walk every lane across its whole range, which is exactly what the
  /// arcs have to survive: nothing may leave [0, 1] and pin an arc outside the rim.
  func testEveryLaneInTheSweepFixtureProducesADrawableFraction() throws {
    let samples = try load("watch-sweep.jsonl")
    XCTAssertFalse(samples.isEmpty)

    var sawFullBattery = false
    var sawEmptyBattery = false
    for sample in samples {
      let frame = sample.frame
      for fraction in [
        WatchGauge.speedFraction(frame.speed),
        WatchGauge.dutyFraction(frame.duty),
        WatchGauge.batteryFraction(frame.battery),
        WatchGauge.tempFraction(frame.motorTemp),
        WatchGauge.tempFraction(frame.ctrlTemp),
      ] {
        XCTAssertTrue((0...1).contains(fraction), "fraction \(fraction) at t=\(sample.atMs)")
      }
      let battery = WatchGauge.batteryFraction(frame.battery)
      if battery >= 1 { sawFullBattery = true }
      if battery <= 0 { sawEmptyBattery = true }
    }
    // Guards the guard: a fixture that never reached either end would make the clamp above vacuous.
    XCTAssertTrue(sawFullBattery)
    XCTAssertTrue(sawEmptyBattery)
  }

  // MARK: - Fraction contract

  func testFractionsClampRatherThanRescale() {
    XCTAssertEqual(WatchGauge.speedFraction(0), 0)
    XCTAssertEqual(WatchGauge.speedFraction(25), 0.5, accuracy: 0.0001)
    XCTAssertEqual(WatchGauge.speedFraction(120), 1)
    XCTAssertEqual(WatchGauge.dutyFraction(-20), 0)
    XCTAssertEqual(WatchGauge.dutyFraction(140), 1)
    // A temperature below the arc floor is an empty arc, never a negative one.
    XCTAssertEqual(WatchGauge.tempFraction(-40), 0)
    XCTAssertEqual(WatchGauge.tempFraction(WatchGauge.tempMax + 10), 1)
    XCTAssertEqual(WatchGauge.tempFraction(45), 0.5, accuracy: 0.0001)
  }

  /// An unreported lane parks its arc at the floor. It must not be confused with a real reading of
  /// zero, which is what the dash in the readout is for.
  func testAnUnreportedLaneParksAtTheFloor() {
    XCTAssertEqual(WatchGauge.speedFraction(nil), 0)
    XCTAssertEqual(WatchGauge.dutyFraction(nil), 0)
    XCTAssertEqual(WatchGauge.batteryFraction(nil), 0)
    XCTAssertEqual(WatchGauge.tempFraction(nil), 0)
  }

  // MARK: - Formatting contract

  func testFormattingMatchesTheAndroidReadouts() {
    XCTAssertEqual(WatchGauge.hero(0), "0")
    XCTAssertEqual(WatchGauge.hero(18.4), "18")
    XCTAssertEqual(WatchGauge.temp(51.4), "51°")
    XCTAssertEqual(WatchGauge.batteryPercent(83.7), "84%")
  }

  /// Java rounds HALF_UP and C's `printf` rounds half to even, so an exact half is the one input
  /// where the two wrists would disagree if the watchOS side just called `%.0f`.
  func testExactHalvesRoundAwayFromZeroLikeAndroid() {
    XCTAssertEqual(WatchGauge.hero(18.5), "19")
    XCTAssertEqual(WatchGauge.hero(17.5), "18")
    XCTAssertEqual(WatchGauge.temp(0.5), "1°")
    XCTAssertEqual(WatchGauge.batteryPercent(2.5), "3%")
  }

  /// A lane that arrived as an infinity is not a reading. It must not print as "inf" across a hero.
  func testANonFiniteLaneReadsAsADash() {
    XCTAssertEqual(WatchGauge.hero(.infinity), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.temp(.nan), WatchGauge.dash)
  }

  func testAnAbsentLaneReadsAsADashAndNeverAsZero() {
    XCTAssertEqual(WatchGauge.hero(nil), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.temp(nil), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.batteryPercent(nil), WatchGauge.dash)
  }

  /// Ambient keeps every lane's last reading, except when the stream itself has stopped: that is
  /// the one case with nothing to say, and it empties every lane at once rather than showing a
  /// frozen number in ambient's own colour.
  func testAmbientBlindEmptiesEveryReadout() {
    XCTAssertEqual(WatchGauge.hero(42, blind: true), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.temp(42, blind: true), WatchGauge.dash)
    XCTAssertEqual(WatchGauge.batteryPercent(42, blind: true), WatchGauge.dash)
  }

  // MARK: - Fixture parsing

  func testNullLanesStayNullSoTheGaugesRenderThemAsUnreported() {
    let samples = ReplayFixtureParser.parse([
      #"{"t":0,"speed":12,"duty":null,"battery":null,"motorTemp":null,"ctrlTemp":null}"#
    ])

    XCTAssertNil(samples[0].frame.duty)
    XCTAssertNil(samples[0].frame.battery)
    XCTAssertNil(samples[0].frame.motorTemp)
    XCTAssertNil(samples[0].frame.ctrlTemp)
  }

  func testStaleDefaultsToFalseAndIsHonouredWhenSet() {
    let samples = ReplayFixtureParser.parse([
      #"{"t":0,"speed":12,"duty":1,"battery":1,"motorTemp":1,"ctrlTemp":1}"#,
      #"{"t":500,"speed":12,"duty":1,"battery":1,"motorTemp":1,"ctrlTemp":1,"stale":true}"#,
    ])

    XCTAssertFalse(samples[0].frame.stale)
    XCTAssertTrue(samples[1].frame.stale)
  }

  func testMalformedAndBlankLinesAreSkippedNotFatal() {
    let samples = ReplayFixtureParser.parse([
      "",
      "not json",
      #"{"t":0,"duty":17}"#,  // no speed lane
      #"{"t":1000,"speed":20,"duty":30,"battery":50,"motorTemp":40,"ctrlTemp":30}"#,
    ])

    XCTAssertEqual(samples.count, 1)
    XCTAssertEqual(samples[0].atMs, 1_000)
  }
}
