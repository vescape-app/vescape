import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/AlertEngineTest.kt
final class AlertEngineTests: XCTestCase {
  private let engine = AlertEngine()

  private func rule(
    id: String = "r1",
    controlId: String = "duty",
    threshold: Double = 70.0,
    thresholdMax: Double? = nil,
    soundType: String = "default",
    repeatEverySeconds: Int64? = nil,
    beepCount: Int = alertBeepCountDefault
  ) -> AlertRule {
    AlertRule(
      boardId: "board-1",
      id: id,
      controlId: controlId,
      threshold: threshold,
      thresholdMax: thresholdMax,
      enabled: true,
      soundType: soundType,
      createdAt: 0,
      repeatEverySeconds: repeatEverySeconds,
      beepCount: beepCount,
      source: nil
    )
  }

  private func telemetry(
    dutyCycle: Double = 0.0,
    speed: Double = 0.0,
    batteryVoltage: Double = 60.0,
    motorCurrent: Double = 0.0,
    tempMotor: Double? = nil,
    tempMosfet: Double? = nil,
    pitch: Double = 0.0,
    adc1: Double = 0.0,
    batteryCurrent: Double = 0.0
  ) -> RefloatTelemetry {
    RefloatTelemetry(
      hasFault: false,
      faultCode: 0,
      pitch: pitch,
      roll: 0.0,
      balancePitch: 0.0,
      balanceCurrent: 0.0,
      speed: speed,
      batteryVoltage: batteryVoltage,
      motorCurrent: motorCurrent,
      batteryCurrent: batteryCurrent,
      erpm: 0,
      dutyCycle: dutyCycle,
      state: 0,
      switchState: 0,
      adc1: adc1,
      adc2: 0.0,
      odometer: nil,
      tempMosfet: tempMosfet,
      tempMotor: tempMotor,
      avgLatency: nil,
      pullRateHz: nil,
      lastPacketAt: 0
    )
  }

  func testLegalModeOverlayStaysAbsentWhenDisabled() {
    let rules = withLegalModeOverlay(
      [rule()],
      boardId: "board-2",
      enabled: false,
      warningSpeedKmh: 15,
      limitSpeedKmh: 20
    )

    XCTAssertEqual(1, rules.count)
  }

  func testLegalModeOverlaySynthesizesBoardAgnosticGeigerRule() {
    let rules = withLegalModeOverlay(
      [],
      boardId: "board-2",
      enabled: true,
      warningSpeedKmh: 15,
      limitSpeedKmh: 20
    )

    XCTAssertEqual(1, rules.count)
    XCTAssertEqual("board-2", rules[0].boardId)
    XCTAssertEqual("speed", rules[0].controlId)
    XCTAssertEqual(15, rules[0].threshold)
    XCTAssertEqual(20, rules[0].thresholdMax)
    XCTAssertEqual("preset:tick", rules[0].soundType)
    XCTAssertNil(rules[0].source)
  }

  func testLegalModeOverlayUsesLatestSpeedSettings() {
    let rules = withLegalModeOverlay(
      [],
      boardId: "board-1",
      enabled: true,
      warningSpeedKmh: 24,
      limitSpeedKmh: 30
    )

    XCTAssertEqual(24, rules[0].threshold)
    XCTAssertEqual(30, rules[0].thresholdMax)
  }

  // MARK: - Basic firing

  func testSingleAlertFiresWhenAboveThreshold() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 70.0)],
      telemetry: telemetry(dutyCycle: 0.75)
    )
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual("r1", fired[0].ruleId)
  }

  func testSingleAlertDoesNotFireBelowThreshold() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 70.0)],
      telemetry: telemetry(dutyCycle: 0.60)
    )
    XCTAssertTrue(fired.isEmpty)
  }

  func testBatteryAlertFiresBelowThresholdVoltage() {
    let fired = engine.evaluate(
      rules: [rule(id: "bat", controlId: "battery", threshold: 50.0)],
      telemetry: telemetry(batteryVoltage: 45.0)
    )
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual("bat", fired[0].ruleId)
  }

  func testBatteryAlertDoesNotFireAboveThresholdVoltage() {
    let fired = engine.evaluate(
      rules: [rule(id: "bat", controlId: "battery", threshold: 50.0)],
      telemetry: telemetry(batteryVoltage: 55.0)
    )
    XCTAssertTrue(fired.isEmpty)
  }

  func testBatteryAlertFiresBelowThresholdPercent() {
    let fired = engine.evaluate(
      rules: [rule(id: "bat", controlId: "battery", threshold: 50.0)],
      telemetry: telemetry(batteryVoltage: 65.0),
      batteryPercent: 45.0
    )
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual("bat", fired[0].ruleId)
  }

  func testBatteryAlertDoesNotFireAboveThresholdPercent() {
    let fired = engine.evaluate(
      rules: [rule(id: "bat", controlId: "battery", threshold: 50.0)],
      telemetry: telemetry(batteryVoltage: 65.0),
      batteryPercent: 55.0
    )
    XCTAssertTrue(fired.isEmpty)
  }

  func testBatteryAlertFiredValueIsRawVoltage() {
    let fired = engine.evaluate(
      rules: [rule(id: "bat", controlId: "battery", threshold: 50.0)],
      telemetry: telemetry(batteryVoltage: 65.0),
      batteryPercent: 45.0
    )
    XCTAssertEqual(65.0, fired[0].value, accuracy: 0.01)
  }

  // MARK: - Geiger rangeDepth

  func testGeigerRangeDepthCalculatedCorrectly() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 70.0, thresholdMax: 80.0)],
      telemetry: telemetry(dutyCycle: 0.75)
    )
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual(0.5, fired[0].rangeDepth!, accuracy: 0.01)
  }

  func testGeigerRangeDepthClampedAtMax() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 70.0, thresholdMax: 80.0)],
      telemetry: telemetry(dutyCycle: 0.90)
    )
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual(1.0, fired[0].rangeDepth!, accuracy: 0.01)
  }

  func testSimpleThresholdAlertHasNullRangeDepth() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 60.0)],
      telemetry: telemetry(dutyCycle: 0.66)
    )
    XCTAssertEqual(1, fired.count)
    XCTAssertNil(fired[0].rangeDepth)
  }

  // MARK: - Priority ordering

  func testAt66PercentOnlyCFires() {
    let rules = [
      rule(id: "A", threshold: 70.0, thresholdMax: 80.0),
      rule(id: "B", threshold: 85.0, thresholdMax: 90.0),
      rule(id: "C", threshold: 60.0),
    ]
    let fired = engine.evaluate(rules: rules, telemetry: telemetry(dutyCycle: 0.66))
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual("C", fired[0].ruleId)
  }

  func testAt76PercentGeigerAWinsOverSimpleC() {
    let rules = [
      rule(id: "C", threshold: 60.0),
      rule(id: "A", threshold: 70.0, thresholdMax: 80.0),
    ]
    let fired = engine.evaluate(rules: rules, telemetry: telemetry(dutyCycle: 0.76))
    XCTAssertEqual(2, fired.count)
    XCTAssertEqual("A", fired[0].ruleId)
  }

  func testAt89PercentHigherThresholdGeigerBWinsOverA() {
    let rules = [
      rule(id: "A", threshold: 70.0, thresholdMax: 80.0),
      rule(id: "B", threshold: 85.0, thresholdMax: 90.0),
      rule(id: "C", threshold: 60.0),
    ]
    let fired = engine.evaluate(rules: rules, telemetry: telemetry(dutyCycle: 0.89))
    XCTAssertEqual(3, fired.count)
    XCTAssertEqual("B", fired[0].ruleId)
  }

  func testPriorityIndependentOfCreationOrder() {
    let rulesAFirst = [
      rule(id: "A", threshold: 70.0, thresholdMax: 80.0),
      rule(id: "B", threshold: 85.0, thresholdMax: 90.0),
    ]
    let rulesBFirst = [
      rule(id: "B", threshold: 85.0, thresholdMax: 90.0),
      rule(id: "A", threshold: 70.0, thresholdMax: 80.0),
    ]
    let t = telemetry(dutyCycle: 0.89)

    let firedA = engine.evaluate(rules: rulesAFirst, telemetry: t)
    engine.resetAlertState()
    let firedB = engine.evaluate(rules: rulesBFirst, telemetry: t)

    XCTAssertEqual("B", firedA[0].ruleId)
    XCTAssertEqual("B", firedB[0].ruleId)
  }

  // MARK: - Battery (below direction) priority

  func testBatteryLowerThresholdWinsWhenBothFire() {
    let rules = [
      rule(id: "high", controlId: "battery", threshold: 50.0, thresholdMax: 45.0),
      rule(id: "low", controlId: "battery", threshold: 42.0, thresholdMax: 38.0),
    ]
    let fired = engine.evaluate(
      rules: rules,
      telemetry: telemetry(batteryVoltage: 60.0),
      batteryPercent: 40.0
    )
    XCTAssertEqual(2, fired.count)
    XCTAssertEqual("low", fired[0].ruleId)
  }

  // MARK: - Debounce

  func testLatchPreventsDuplicateFiring() {
    let rules = [rule(threshold: 60.0)]
    let t = telemetry(dutyCycle: 0.66)

    let first = engine.evaluate(rules: rules, telemetry: t)
    let second = engine.evaluate(rules: rules, telemetry: t)

    XCTAssertEqual(1, first.count)
    XCTAssertTrue(second.isEmpty)
  }

  func testGeigerAlertReportsWhileStillActive() {
    let rules = [rule(threshold: 70.0, thresholdMax: 80.0)]
    let t = telemetry(dutyCycle: 0.75)

    let first = engine.evaluate(rules: rules, telemetry: t)
    let second = engine.evaluate(rules: rules, telemetry: t)

    XCTAssertEqual(1, first.count)
    XCTAssertEqual(1, second.count)
  }

  func testResetDebounceAllowsRefiring() {
    let rules = [rule(threshold: 60.0)]
    let t = telemetry(dutyCycle: 0.66)

    engine.evaluate(rules: rules, telemetry: t)
    engine.resetAlertState()
    let fired = engine.evaluate(rules: rules, telemetry: t)

    XCTAssertEqual(1, fired.count)
  }

  func testNormalizedTestValueUsesTheProductionEvaluationPath() {
    let fired = engine.evaluateValues(
      rules: [rule(threshold: 70.0, thresholdMax: 90.0)],
      values: ["duty": 80.0]
    )

    XCTAssertEqual(1, fired.count)
    XCTAssertEqual(0.5, fired[0].rangeDepth!, accuracy: 0.01)
  }

  func testIsolatedTestEngineDoesNotResetProductionDebounce() {
    let rules = [rule(threshold: 60.0)]
    let production = AlertEngine()
    let test = AlertEngine()

    XCTAssertEqual(1, production.evaluateValues(rules: rules, values: ["duty": 70.0]).count)
    XCTAssertEqual(1, test.evaluateValues(rules: rules, values: ["duty": 70.0]).count)
    XCTAssertTrue(production.evaluateValues(rules: rules, values: ["duty": 70.0]).isEmpty)
  }

  // MARK: - Speed / duty absolute

  func testSpeedAlertUsesAbsoluteValue() {
    let fired = engine.evaluate(
      rules: [rule(id: "spd", controlId: "speed", threshold: 20.0)],
      telemetry: telemetry(speed: -25.0)
    )
    XCTAssertEqual(1, fired.count)
  }

  func testDutyAlertUsesAbsPercentage() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 70.0)],
      telemetry: telemetry(dutyCycle: -0.75)
    )
    XCTAssertEqual(1, fired.count)
  }

  // MARK: - Cross-control geiger wins over simple

  func testCrossControlGeigerWinsOverSimple() {
    let rules = [
      rule(id: "spd", controlId: "speed", threshold: 10.0),
      rule(id: "duty", controlId: "duty", threshold: 70.0, thresholdMax: 90.0),
    ]
    let fired = engine.evaluate(
      rules: rules,
      telemetry: telemetry(dutyCycle: 0.75, speed: 15.0)
    )
    XCTAssertEqual(2, fired.count)
    XCTAssertEqual("duty", fired[0].ruleId)
  }

  // MARK: - Battery hysteresis

  func testBatteryHysteresisFiresOnce() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 50.0)]
    let fired = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    XCTAssertEqual(1, fired.count)
    XCTAssertEqual("bat", fired[0].ruleId)
  }

  func testBatteryHysteresisDoesNotRefireWhileDisarmed() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 50.0)]
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    let second = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 48.0)
    XCTAssertTrue(second.isEmpty)
  }

  func testBatteryHysteresisRearmsAfterPercentRecovery() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 50.0)]
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 61.0)
    let refired = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    XCTAssertEqual(1, refired.count)
  }

  func testBatteryHysteresisNoRearmsBeforeMargin() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 50.0)]
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 58.0)
    let second = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    XCTAssertTrue(second.isEmpty)
  }

  func testBatteryHysteresisResetClearsArmedState() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 50.0)]
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    engine.resetAlertState()
    let refired = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    XCTAssertEqual(1, refired.count)
  }

  func testBatteryHysteresisMultipleThresholdsIndependent() {
    let rules = [
      rule(id: "high", controlId: "battery", threshold: 50.0),
      rule(id: "low", controlId: "battery", threshold: 30.0),
    ]
    engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 45.0)
    let second = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 25.0)
    XCTAssertEqual(1, second.count)
    XCTAssertEqual("low", second[0].ruleId)
  }

  func testBatteryHysteresisMissingPercentFallsBackToDebounce() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 70.0)]
    let first = engine.evaluate(rules: rules, telemetry: telemetry(batteryVoltage: 68.0))
    let second = engine.evaluate(rules: rules, telemetry: telemetry(batteryVoltage: 68.0))
    XCTAssertEqual(1, first.count)
    XCTAssertTrue(second.isEmpty)
  }

  func testBatteryGeigerUnaffectedByHysteresis() {
    let rules = [rule(id: "bat", controlId: "battery", threshold: 50.0, thresholdMax: 30.0)]
    let first = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 40.0)
    let second = engine.evaluate(rules: rules, telemetry: telemetry(), batteryPercent: 40.0)
    XCTAssertEqual(1, first.count)
    XCTAssertEqual(1, second.count)
    XCTAssertNotNil(first[0].rangeDepth)
  }

  // MARK: - Re-arm + repeat (#348)

  func testParkedAboveThresholdNeverAnnouncesTwice() {
    let rules = [rule(controlId: "motor-temp", threshold: 70.0)]

    let fired = (1...50).map { _ in engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 71.0)) }

    XCTAssertEqual(1, fired.filter { !$0.isEmpty }.count)
  }

  func testDippingBelowThresholdWithinTheMarginDoesNotRearm() {
    let rules = [rule(controlId: "motor-temp", threshold: 70.0)]

    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 71.0))
    // Margin is 3°C, so 68 is a wobble around the threshold, not a recovery.
    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 68.0))
    let refired = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 71.0))

    XCTAssertTrue(refired.isEmpty)
  }

  func testCoolingPastTheMarginRearmsTheRule() {
    let rules = [rule(controlId: "motor-temp", threshold: 70.0)]

    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 71.0))
    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 66.0))
    let refired = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 71.0))

    XCTAssertEqual(1, refired.count)
  }

  func testRepeatingRuleAnnouncesOnItsCadenceWhileStillPast() {
    var clock: Int64 = 0
    let engine = AlertEngine(now: { clock })
    let rules = [rule(controlId: "motor-temp", threshold: 95.0, repeatEverySeconds: 10)]
    let hot = telemetry(tempMotor: 96.0)

    let first = engine.evaluate(rules: rules, telemetry: hot)
    clock += 9_000
    let tooSoon = engine.evaluate(rules: rules, telemetry: hot)
    clock += 1_000
    let onCadence = engine.evaluate(rules: rules, telemetry: hot)

    XCTAssertEqual(1, first.count)
    XCTAssertTrue(tooSoon.isEmpty)
    XCTAssertEqual(1, onCadence.count)
  }

  func testRepeatClockRestartsAfterRearming() {
    var clock: Int64 = 0
    let engine = AlertEngine(now: { clock })
    let rules = [rule(controlId: "motor-temp", threshold: 95.0, repeatEverySeconds: 10)]

    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 96.0))
    clock += 1_000
    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 90.0))
    clock += 1_000
    // Re-armed, so this is a fresh crossing rather than a repeat — no waiting out the cadence.
    let refired = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 96.0))

    XCTAssertEqual(1, refired.count)
  }

  func testOneMetricAnnouncesOnceWhenSeveralRungsCrossTogether() {
    let rules = [
      rule(id: "warn", controlId: "motor-temp", threshold: 70.0),
      rule(id: "high", controlId: "motor-temp", threshold: 85.0),
      rule(id: "nag", controlId: "motor-temp", threshold: 95.0),
    ]

    let fired = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 96.0))

    XCTAssertEqual(1, fired.count)
    XCTAssertEqual("nag", fired[0].ruleId)
  }

  func testRungsSuppressedByCoalescingAreSpentNotPending() {
    let rules = [
      rule(id: "warn", controlId: "motor-temp", threshold: 70.0),
      rule(id: "nag", controlId: "motor-temp", threshold: 95.0),
    ]

    _ = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 96.0))
    // Dropping back under the top rung must not hand the lower one a turn to speak.
    let onTheWayDown = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 80.0))

    XCTAssertTrue(onTheWayDown.isEmpty)
  }

  func testSeparateMetricsBothAnnounceInTheSameEvaluation() {
    let rules = [
      rule(id: "motor", controlId: "motor-temp", threshold: 70.0),
      rule(id: "controller", controlId: "controller-temp", threshold: 60.0),
    ]

    let fired = engine.evaluate(rules: rules, telemetry: telemetry(tempMotor: 75.0, tempMosfet: 65.0))

    XCTAssertEqual(2, fired.count)
  }

  func testBeepCountReachesTheFiredAlert() {
    let fired = engine.evaluate(
      rules: [rule(threshold: 60.0, beepCount: 2)],
      telemetry: telemetry(dutyCycle: 0.66)
    )

    XCTAssertEqual(2, fired[0].beepCount)
  }

  func testRepeatCadenceIsFlooredWhateverJsAsksFor() {
    XCTAssertEqual(alertRepeatMinSeconds, normalizedAlertRepeatSeconds(0.5))
    XCTAssertNil(normalizedAlertRepeatSeconds(0.0))
    XCTAssertNil(normalizedAlertRepeatSeconds(nil))
    XCTAssertEqual(30, normalizedAlertRepeatSeconds(30.0))
  }

  func testBeepCountIsClampedToItsRange() {
    XCTAssertEqual(alertBeepCountRange.upperBound, normalizedAlertBeepCount(99))
    XCTAssertEqual(alertBeepCountRange.lowerBound, normalizedAlertBeepCount(0))
    XCTAssertEqual(alertBeepCountDefault, normalizedAlertBeepCount(nil))
  }
}

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/alerts/AlertEngineTest.kt `VescAlertTemplateTest`
final class AlertTemplateTests: XCTestCase {
  private func alert(
    controlId: String = "duty",
    value: Double = 75.0,
    threshold: Double = 70.0,
    thresholdMax: Double? = nil
  ) -> FiredAlert {
    FiredAlert(
      ruleId: "r1",
      controlId: controlId,
      value: value,
      threshold: threshold,
      thresholdMax: thresholdMax,
      soundType: "tts:test",
      rangeDepth: nil,
      beepCount: alertBeepCountDefault,
      firedAt: 0
    )
  }

  func testBasicPlaceholdersRendered() {
    let result = renderAlertMessageTemplate(
      "{value} {unit} over {threshold} {unit}",
      alert: alert(controlId: "duty", value: 75.0, threshold: 70.0),
      batteryPercent: nil
    )
    XCTAssertEqual("75 % over 70 %", result)
  }

  func testBatteryVoltagePlaceholderRendered() {
    let result = renderAlertMessageTemplate(
      "Battery {voltage} volts, {percent}%",
      alert: alert(controlId: "battery", value: 48.5, threshold: 50.0),
      batteryPercent: 42.0
    )
    XCTAssertEqual("Battery 48.5 volts, 42%", result)
  }

  func testBatteryPercentMissingRecordsDiagnostic() {
    var diagnostics: [String] = []
    let result = renderAlertMessageTemplate(
      "Battery {voltage} volts, {percent}%",
      alert: alert(controlId: "battery", value: 48.5, threshold: 50.0),
      batteryPercent: nil,
      onDiagnostic: { name, _ in diagnostics.append(name) }
    )
    XCTAssertEqual("Battery 48.5 volts, %", result)
    XCTAssertTrue(diagnostics.contains("alert_template_placeholder_unavailable"))
  }

  func testBatteryPlaceholdersUnavailableForNonBattery() {
    var diagnostics: [String] = []
    let result = renderAlertMessageTemplate(
      "Speed {value} {unit} voltage={voltage} pct={percent}",
      alert: alert(controlId: "speed", value: 25.0, threshold: 20.0),
      batteryPercent: 80.0,
      onDiagnostic: { name, _ in diagnostics.append(name) }
    )
    XCTAssertEqual("Speed 25 km/h voltage= pct=", result)
    XCTAssertEqual(2, diagnostics.filter { $0 == "alert_template_placeholder_unavailable" }.count)
  }

  func testUnknownPlaceholderStrippedWithDiagnostic() {
    var diagnostics: [String] = []
    let result = renderAlertMessageTemplate(
      "Alert {value} {unknown}",
      alert: alert(controlId: "speed", value: 25.0, threshold: 20.0),
      batteryPercent: nil,
      onDiagnostic: { name, _ in diagnostics.append(name) }
    )
    XCTAssertEqual("Alert 25", result)
    XCTAssertTrue(diagnostics.contains("alert_template_unknown_placeholder"))
  }

  func testNoBracesInOutputWhenAllPlaceholdersResolved() {
    let result = renderAlertMessageTemplate(
      "{value} {unit}",
      alert: alert(controlId: "motor-temp", value: 65.3, threshold: 60.0),
      batteryPercent: nil
    )
    XCTAssertFalse(result.contains("{"))
  }

  func testUnitMapCorrect() {
    XCTAssertEqual("km/h", alertControlUnit("speed"))
    XCTAssertEqual("V", alertControlUnit("battery"))
    XCTAssertEqual("%", alertControlUnit("duty"))
    XCTAssertEqual("°C", alertControlUnit("motor-temp"))
    XCTAssertEqual("A", alertControlUnit("motor-current"))
    XCTAssertEqual("°C", alertControlUnit("controller-temp"))
    XCTAssertEqual("A", alertControlUnit("batt-current"))
    XCTAssertEqual("°", alertControlUnit("imu"))
    XCTAssertEqual("", alertControlUnit("footpad"))
  }
}
