package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.protocol.RefloatTelemetry

import expo.modules.vescapecore.telemetry.AlertRuleEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertEngineTest {
    private val engine = AlertEngine()

    private fun rule(
        id: String = "r1",
        controlId: String = "duty",
        threshold: Double = 70.0,
        thresholdMax: Double? = null,
        soundType: String = "default",
        repeatEverySeconds: Long? = null,
        beepCount: Int = ALERT_BEEP_COUNT_DEFAULT,
    ) = AlertRuleEntity(
        boardId = "board-1",
        id = id,
        controlId = controlId,
        threshold = threshold,
        thresholdMax = thresholdMax,
        enabled = true,
        soundType = soundType,
        createdAt = 0L,
        repeatEverySeconds = repeatEverySeconds,
        beepCount = beepCount,
        source = null,
    )

    private fun telemetry(
        dutyCycle: Double = 0.0,
        speed: Double = 0.0,
        batteryVoltage: Double = 60.0,
        motorCurrent: Double = 0.0,
        tempMotor: Double? = null,
        tempMosfet: Double? = null,
        pitch: Double = 0.0,
        adc1: Double = 0.0,
        batteryCurrent: Double = 0.0,
    ) = RefloatTelemetry(
        hasFault = false,
        faultCode = 0,
        pitch = pitch,
        roll = 0.0,
        balancePitch = 0.0,
        balanceCurrent = 0.0,
        speed = speed,
        batteryVoltage = batteryVoltage,
        motorCurrent = motorCurrent,
        batteryCurrent = batteryCurrent,
        erpm = 0,
        dutyCycle = dutyCycle,
        state = 0,
        switchState = 0,
        adc1 = adc1,
        adc2 = 0.0,
        odometer = null,
        tempMosfet = tempMosfet,
        tempMotor = tempMotor,
        avgLatency = null,
        pullRateHz = null,
        lastPacketAt = 0L,
        location = null,
    )

    @Test
    fun legalModeOverlayStaysAbsentWhenDisabled() {
        val rules = withLegalModeOverlay(
            listOf(rule()),
            "board-2",
            false,
            15.0,
            20.0,
        )

        assertEquals(1, rules.size)
    }

    @Test
    fun legalModeOverlaySynthesizesBoardAgnosticGeigerRule() {
        val rules = withLegalModeOverlay(
            emptyList(),
            "board-2",
            true,
            15.0,
            20.0,
        )

        assertEquals(1, rules.size)
        assertEquals("board-2", rules[0].boardId)
        assertEquals("speed", rules[0].controlId)
        assertEquals(15.0, rules[0].threshold, 0.0)
        assertEquals(20.0, rules[0].thresholdMax!!, 0.0)
        assertEquals("preset:tick", rules[0].soundType)
        assertNull(rules[0].source)
    }

    @Test
    fun legalModeOverlayUsesLatestSpeedSettings() {
        val rules = withLegalModeOverlay(
            emptyList(),
            "board-1",
            true,
            24.0,
            30.0,
        )

        assertEquals(24.0, rules[0].threshold, 0.0)
        assertEquals(30.0, rules[0].thresholdMax!!, 0.0)
    }

    // --- Basic firing ---

    @Test
    fun singleAlertFiresWhenAboveThreshold() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 70.0)),
            telemetry(dutyCycle = 0.75),
        )
        assertEquals(1, fired.size)
        assertEquals("r1", fired[0].ruleId)
    }

    @Test
    fun singleAlertDoesNotFireBelowThreshold() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 70.0)),
            telemetry(dutyCycle = 0.60),
        )
        assertTrue(fired.isEmpty())
    }

    @Test
    fun batteryAlertFiresBelowThresholdVoltage() {
        val fired = engine.evaluate(
            listOf(rule(id = "bat", controlId = "battery", threshold = 50.0)),
            telemetry(batteryVoltage = 45.0),
        )
        assertEquals(1, fired.size)
        assertEquals("bat", fired[0].ruleId)
    }

    @Test
    fun batteryAlertDoesNotFireAboveThresholdVoltage() {
        val fired = engine.evaluate(
            listOf(rule(id = "bat", controlId = "battery", threshold = 50.0)),
            telemetry(batteryVoltage = 55.0),
        )
        assertTrue(fired.isEmpty())
    }

    @Test
    fun batteryAlertFiresBelowThresholdPercent() {
        val fired = engine.evaluate(
            listOf(rule(id = "bat", controlId = "battery", threshold = 50.0)),
            telemetry(batteryVoltage = 65.0),
            batteryPercent = 45.0,
        )
        assertEquals(1, fired.size)
        assertEquals("bat", fired[0].ruleId)
    }

    @Test
    fun batteryAlertDoesNotFireAboveThresholdPercent() {
        val fired = engine.evaluate(
            listOf(rule(id = "bat", controlId = "battery", threshold = 50.0)),
            telemetry(batteryVoltage = 65.0),
            batteryPercent = 55.0,
        )
        assertTrue(fired.isEmpty())
    }

    @Test
    fun batteryAlertFiredValueIsRawVoltage() {
        val fired = engine.evaluate(
            listOf(rule(id = "bat", controlId = "battery", threshold = 50.0)),
            telemetry(batteryVoltage = 65.0),
            batteryPercent = 45.0,
        )
        assertEquals(65.0, fired[0].value, 0.01)
    }

    // --- Geiger rangeDepth ---

    @Test
    fun geigerRangeDepthCalculatedCorrectly() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 70.0, thresholdMax = 80.0)),
            telemetry(dutyCycle = 0.75),
        )
        assertEquals(1, fired.size)
        assertEquals(0.5, fired[0].rangeDepth!!, 0.01)
    }

    @Test
    fun geigerRangeDepthClampedAtMax() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 70.0, thresholdMax = 80.0)),
            telemetry(dutyCycle = 0.90),
        )
        assertEquals(1, fired.size)
        assertEquals(1.0, fired[0].rangeDepth!!, 0.01)
    }

    @Test
    fun simpleThresholdAlertHasNullRangeDepth() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 60.0)),
            telemetry(dutyCycle = 0.66),
        )
        assertEquals(1, fired.size)
        assertNull(fired[0].rangeDepth)
    }

    // --- Priority ordering: user scenario ---
    // A: duty 70-80 (geiger), B: duty 85-90 (geiger), C: duty 60 (simple)

    @Test
    fun at66PercentOnlyCFires() {
        val rules = listOf(
            rule(id = "A", threshold = 70.0, thresholdMax = 80.0),
            rule(id = "B", threshold = 85.0, thresholdMax = 90.0),
            rule(id = "C", threshold = 60.0),
        )
        val fired = engine.evaluate(rules, telemetry(dutyCycle = 0.66))
        assertEquals(1, fired.size)
        assertEquals("C", fired[0].ruleId)
    }

    @Test
    fun at76PercentGeigerAWinsOverSimpleC() {
        val rules = listOf(
            rule(id = "C", threshold = 60.0),
            rule(id = "A", threshold = 70.0, thresholdMax = 80.0),
        )
        val fired = engine.evaluate(rules, telemetry(dutyCycle = 0.76))
        assertEquals(2, fired.size)
        assertEquals("A", fired[0].ruleId)
    }

    @Test
    fun at89PercentHigherThresholdGeigerBWinsOverA() {
        val rules = listOf(
            rule(id = "A", threshold = 70.0, thresholdMax = 80.0),
            rule(id = "B", threshold = 85.0, thresholdMax = 90.0),
            rule(id = "C", threshold = 60.0),
        )
        val fired = engine.evaluate(rules, telemetry(dutyCycle = 0.89))
        assertEquals(3, fired.size)
        assertEquals("B", fired[0].ruleId)
    }

    @Test
    fun priorityIndependentOfCreationOrder() {
        val rulesAFirst = listOf(
            rule(id = "A", threshold = 70.0, thresholdMax = 80.0),
            rule(id = "B", threshold = 85.0, thresholdMax = 90.0),
        )
        val rulesBFirst = listOf(
            rule(id = "B", threshold = 85.0, thresholdMax = 90.0),
            rule(id = "A", threshold = 70.0, thresholdMax = 80.0),
        )
        val t = telemetry(dutyCycle = 0.89)

        val firedA = engine.evaluate(rulesAFirst, t)
        engine.resetAlertState()
        val firedB = engine.evaluate(rulesBFirst, t)

        assertEquals("B", firedA[0].ruleId)
        assertEquals("B", firedB[0].ruleId)
    }

    // --- Battery (below direction) priority ---

    @Test
    fun batteryLowerThresholdWinsWhenBothFire() {
        val rules = listOf(
            rule(id = "high", controlId = "battery", threshold = 50.0, thresholdMax = 45.0),
            rule(id = "low", controlId = "battery", threshold = 42.0, thresholdMax = 38.0),
        )
        val fired = engine.evaluate(rules, telemetry(batteryVoltage = 60.0), batteryPercent = 40.0)
        assertEquals(2, fired.size)
        assertEquals("low", fired[0].ruleId)
    }

    // --- Debounce ---

    @Test
    fun latchPreventsDuplicateFiring() {
        val rules = listOf(rule(threshold = 60.0))
        val t = telemetry(dutyCycle = 0.66)

        val first = engine.evaluate(rules, t)
        val second = engine.evaluate(rules, t)

        assertEquals(1, first.size)
        assertTrue(second.isEmpty())
    }

    @Test
    fun geigerAlertReportsWhileStillActive() {
        val rules = listOf(rule(threshold = 70.0, thresholdMax = 80.0))
        val t = telemetry(dutyCycle = 0.75)

        val first = engine.evaluate(rules, t)
        val second = engine.evaluate(rules, t)

        assertEquals(1, first.size)
        assertEquals(1, second.size)
    }

    @Test
    fun resetAlertStateAllowsRefiring() {
        val rules = listOf(rule(threshold = 60.0))
        val t = telemetry(dutyCycle = 0.66)

        engine.evaluate(rules, t)
        engine.resetAlertState()
        val fired = engine.evaluate(rules, t)

        assertEquals(1, fired.size)
    }

    // --- Re-arm + repeat (#348) ---

    @Test
    fun parkedAboveThresholdNeverAnnouncesTwice() {
        val rules = listOf(rule(controlId = "motor-temp", threshold = 70.0))

        val fired = (1..50).map { engine.evaluate(rules, telemetry(tempMotor = 71.0)) }

        assertEquals(1, fired.count { it.isNotEmpty() })
    }

    @Test
    fun dippingBelowThresholdWithinTheMarginDoesNotRearm() {
        val rules = listOf(rule(controlId = "motor-temp", threshold = 70.0))

        engine.evaluate(rules, telemetry(tempMotor = 71.0))
        // Margin is 3°C, so 68 is a wobble around the threshold, not a recovery.
        engine.evaluate(rules, telemetry(tempMotor = 68.0))
        val refired = engine.evaluate(rules, telemetry(tempMotor = 71.0))

        assertTrue(refired.isEmpty())
    }

    @Test
    fun coolingPastTheMarginRearmsTheRule() {
        val rules = listOf(rule(controlId = "motor-temp", threshold = 70.0))

        engine.evaluate(rules, telemetry(tempMotor = 71.0))
        engine.evaluate(rules, telemetry(tempMotor = 66.0))
        val refired = engine.evaluate(rules, telemetry(tempMotor = 71.0))

        assertEquals(1, refired.size)
    }

    @Test
    fun repeatingRuleAnnouncesOnItsCadenceWhileStillPast() {
        var clock = 0L
        val engine = AlertEngine { clock }
        val rules = listOf(rule(controlId = "motor-temp", threshold = 95.0, repeatEverySeconds = 10L))
        val hot = telemetry(tempMotor = 96.0)

        val first = engine.evaluate(rules, hot)
        clock += 9_000
        val tooSoon = engine.evaluate(rules, hot)
        clock += 1_000
        val onCadence = engine.evaluate(rules, hot)

        assertEquals(1, first.size)
        assertTrue(tooSoon.isEmpty())
        assertEquals(1, onCadence.size)
    }

    @Test
    fun repeatClockRestartsAfterRearming() {
        var clock = 0L
        val engine = AlertEngine { clock }
        val rules = listOf(rule(controlId = "motor-temp", threshold = 95.0, repeatEverySeconds = 10L))

        engine.evaluate(rules, telemetry(tempMotor = 96.0))
        clock += 1_000
        engine.evaluate(rules, telemetry(tempMotor = 90.0))
        clock += 1_000
        // Re-armed, so this is a fresh crossing rather than a repeat — no waiting out the cadence.
        val refired = engine.evaluate(rules, telemetry(tempMotor = 96.0))

        assertEquals(1, refired.size)
    }

    @Test
    fun oneMetricAnnouncesOnceWhenSeveralRungsCrossTogether() {
        val rules = listOf(
            rule(id = "warn", controlId = "motor-temp", threshold = 70.0),
            rule(id = "high", controlId = "motor-temp", threshold = 85.0),
            rule(id = "nag", controlId = "motor-temp", threshold = 95.0),
        )

        val fired = engine.evaluate(rules, telemetry(tempMotor = 96.0))

        assertEquals(1, fired.size)
        assertEquals("nag", fired[0].ruleId)
    }

    @Test
    fun rungsSuppressedByCoalescingAreSpentNotPending() {
        val rules = listOf(
            rule(id = "warn", controlId = "motor-temp", threshold = 70.0),
            rule(id = "nag", controlId = "motor-temp", threshold = 95.0),
        )

        engine.evaluate(rules, telemetry(tempMotor = 96.0))
        // Dropping back under the top rung must not hand the lower one a turn to speak.
        val onTheWayDown = engine.evaluate(rules, telemetry(tempMotor = 80.0))

        assertTrue(onTheWayDown.isEmpty())
    }

    @Test
    fun separateMetricsBothAnnounceInTheSameEvaluation() {
        val rules = listOf(
            rule(id = "motor", controlId = "motor-temp", threshold = 70.0),
            rule(id = "controller", controlId = "controller-temp", threshold = 60.0),
        )

        val fired = engine.evaluate(rules, telemetry(tempMotor = 75.0, tempMosfet = 65.0))

        assertEquals(2, fired.size)
    }

    @Test
    fun beepCountReachesTheFiredAlert() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 60.0, beepCount = 2)),
            telemetry(dutyCycle = 0.66),
        )

        assertEquals(2, fired[0].beepCount)
    }

    @Test
    fun repeatCadenceIsFlooredWhateverJsAsksFor() {
        assertEquals(ALERT_REPEAT_MIN_SECONDS, normalizedAlertRepeatSeconds(0.5))
        assertNull(normalizedAlertRepeatSeconds(0.0))
        assertNull(normalizedAlertRepeatSeconds(null))
        assertEquals(30L, normalizedAlertRepeatSeconds(30.0))
    }

    @Test
    fun beepCountIsClampedToItsRange() {
        assertEquals(ALERT_BEEP_COUNT_RANGE.last, normalizedAlertBeepCount(99))
        assertEquals(ALERT_BEEP_COUNT_RANGE.first, normalizedAlertBeepCount(0))
        assertEquals(ALERT_BEEP_COUNT_DEFAULT, normalizedAlertBeepCount(null))
    }

    @Test
    fun normalizedTestValueUsesTheProductionEvaluationPath() {
        val fired = engine.evaluateValues(
            rules = listOf(rule(threshold = 70.0, thresholdMax = 90.0)),
            values = mapOf("duty" to 80.0),
        )

        assertEquals(1, fired.size)
        assertEquals(0.5, fired[0].rangeDepth!!, 0.01)
    }

    @Test
    fun isolatedTestEngineDoesNotResetProductionDebounce() {
        val rules = listOf(rule(threshold = 60.0))
        val production = AlertEngine()
        val test = AlertEngine()

        assertEquals(1, production.evaluateValues(rules, mapOf("duty" to 70.0)).size)
        assertEquals(1, test.evaluateValues(rules, mapOf("duty" to 70.0)).size)
        assertTrue(production.evaluateValues(rules, mapOf("duty" to 70.0)).isEmpty())
    }

    // --- Speed uses abs value ---

    @Test
    fun speedAlertUsesAbsoluteValue() {
        val fired = engine.evaluate(
            listOf(rule(id = "spd", controlId = "speed", threshold = 20.0)),
            telemetry(speed = -25.0),
        )
        assertEquals(1, fired.size)
    }

    // --- Duty uses abs * 100 ---

    @Test
    fun dutyAlertUsesAbsPercentage() {
        val fired = engine.evaluate(
            listOf(rule(threshold = 70.0)),
            telemetry(dutyCycle = -0.75),
        )
        assertEquals(1, fired.size)
    }

    // --- Cross-control: geiger wins over simple ---

    @Test
    fun crossControlGeigerWinsOverSimple() {
        val rules = listOf(
            rule(id = "spd", controlId = "speed", threshold = 10.0),
            rule(id = "duty", controlId = "duty", threshold = 70.0, thresholdMax = 90.0),
        )
        val fired = engine.evaluate(rules, telemetry(speed = 15.0, dutyCycle = 0.75))
        assertEquals(2, fired.size)
        assertEquals("duty", fired[0].ruleId)
    }

    // --- Battery hysteresis (percent-based, margin = 10%) ---

    @Test
    fun batteryHysteresisFiresOnce() {
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 50.0))
        val fired = engine.evaluate(rules, telemetry(), batteryPercent = 45.0)
        assertEquals(1, fired.size)
        assertEquals("bat", fired[0].ruleId)
    }

    @Test
    fun batteryHysteresisDoesNotRefireWhileDisarmed() {
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 50.0))
        engine.evaluate(rules, telemetry(), batteryPercent = 45.0)
        val second = engine.evaluate(rules, telemetry(), batteryPercent = 48.0)
        assertTrue(second.isEmpty())
    }

    @Test
    fun batteryHysteresisRearmsAfterPercentRecovery() {
        // margin = 10%, re-arm needs > 60%
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 50.0))
        engine.evaluate(rules, telemetry(), batteryPercent = 45.0)

        engine.evaluate(rules, telemetry(), batteryPercent = 61.0)

        val refired = engine.evaluate(rules, telemetry(), batteryPercent = 45.0)
        assertEquals(1, refired.size)
    }

    @Test
    fun batteryHysteresisNoRearmsBeforeMargin() {
        // margin = 10%, threshold = 50%, re-arm needs > 60%
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 50.0))
        engine.evaluate(rules, telemetry(), batteryPercent = 45.0)

        // recovers to 58% — below margin (60%), stays disarmed
        engine.evaluate(rules, telemetry(), batteryPercent = 58.0)

        val second = engine.evaluate(rules, telemetry(), batteryPercent = 45.0)
        assertTrue(second.isEmpty())
    }

    @Test
    fun batteryHysteresisResetClearsArmedState() {
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 50.0))
        engine.evaluate(rules, telemetry(), batteryPercent = 45.0)
        engine.resetAlertState()
        val refired = engine.evaluate(rules, telemetry(), batteryPercent = 45.0)
        assertEquals(1, refired.size)
    }

    @Test
    fun batteryHysteresisMultipleThresholdsIndependent() {
        val rules = listOf(
            rule(id = "high", controlId = "battery", threshold = 50.0),
            rule(id = "low", controlId = "battery", threshold = 30.0),
        )
        // only "high" fires at 45%
        engine.evaluate(rules, telemetry(), batteryPercent = 45.0)

        // "high" disarmed; "low" still armed and fires now at 25%
        val second = engine.evaluate(rules, telemetry(), batteryPercent = 25.0)
        assertEquals(1, second.size)
        assertEquals("low", second[0].ruleId)
    }

    @Test
    fun batteryHysteresisMissingPercentFallsBackToDebounce() {
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 70.0))
        val first = engine.evaluate(rules, telemetry(batteryVoltage = 68.0))
        val second = engine.evaluate(rules, telemetry(batteryVoltage = 68.0))
        assertEquals(1, first.size)
        assertTrue(second.isEmpty())
    }

    @Test
    fun batteryGeigerUnaffectedByHysteresis() {
        val rules = listOf(rule(id = "bat", controlId = "battery", threshold = 50.0, thresholdMax = 30.0))
        val first = engine.evaluate(rules, telemetry(), batteryPercent = 40.0)
        val second = engine.evaluate(rules, telemetry(), batteryPercent = 40.0)
        assertEquals(1, first.size)
        assertEquals(1, second.size)
        assertNotNull(first[0].rangeDepth)
    }
}

class VescAlertTemplateTest {
    private fun alert(
        controlId: String = "duty",
        value: Double = 75.0,
        threshold: Double = 70.0,
        thresholdMax: Double? = null,
    ) = FiredAlert(
        ruleId = "r1",
        controlId = controlId,
        value = value,
        threshold = threshold,
        thresholdMax = thresholdMax,
        soundType = "tts:test",
        rangeDepth = null,
        beepCount = ALERT_BEEP_COUNT_DEFAULT,
        firedAt = 0L,
    )

    @Test
    fun basicPlaceholdersRendered() {
        val result = renderAlertMessageTemplate(
            "{value} {unit} over {threshold} {unit}",
            alert(controlId = "duty", value = 75.0, threshold = 70.0),
            batteryPercent = null,
        )
        assertEquals("75 % over 70 %", result)
    }

    @Test
    fun batteryVoltagePlaceholderRendered() {
        val result = renderAlertMessageTemplate(
            "Battery {voltage} volts, {percent}%",
            alert(controlId = "battery", value = 48.5, threshold = 50.0),
            batteryPercent = 42.0,
        )
        assertEquals("Battery 48.5 volts, 42%", result)
    }

    @Test
    fun batteryPercentMissingRecordsDiagnostic() {
        val diagnostics = mutableListOf<String>()
        val result = renderAlertMessageTemplate(
            "Battery {voltage} volts, {percent}%",
            alert(controlId = "battery", value = 48.5, threshold = 50.0),
            batteryPercent = null,
            onDiagnostic = { name, _ -> diagnostics.add(name) },
        )
        assertEquals("Battery 48.5 volts, %", result)
        assertTrue(diagnostics.any { it == "alert_template_placeholder_unavailable" })
    }

    @Test
    fun batteryPlaceholdersUnavailableForNonBattery() {
        val diagnostics = mutableListOf<String>()
        val result = renderAlertMessageTemplate(
            "Speed {value} {unit} voltage={voltage} pct={percent}",
            alert(controlId = "speed", value = 25.0, threshold = 20.0),
            batteryPercent = 80.0,
            onDiagnostic = { name, _ -> diagnostics.add(name) },
        )
        assertEquals("Speed 25 km/h voltage= pct=", result)
        assertEquals(2, diagnostics.count { it == "alert_template_placeholder_unavailable" })
    }

    @Test
    fun unknownPlaceholderStrippedWithDiagnostic() {
        val diagnostics = mutableListOf<String>()
        val result = renderAlertMessageTemplate(
            "Alert {value} {unknown}",
            alert(controlId = "speed", value = 25.0, threshold = 20.0),
            batteryPercent = null,
            onDiagnostic = { name, _ -> diagnostics.add(name) },
        )
        assertEquals("Alert 25", result)
        assertTrue(diagnostics.any { it == "alert_template_unknown_placeholder" })
    }

    @Test
    fun noBracesInOutputWhenAllPlaceholdersResolved() {
        val result = renderAlertMessageTemplate(
            "{value} {unit}",
            alert(controlId = "motor-temp", value = 65.3, threshold = 60.0),
            batteryPercent = null,
        )
        assertFalse(result.contains('{'))
    }

    @Test
    fun unitMapCorrect() {
        assertEquals("km/h", alertControlUnit("speed"))
        assertEquals("V", alertControlUnit("battery"))
        assertEquals("%", alertControlUnit("duty"))
        assertEquals("°C", alertControlUnit("motor-temp"))
        assertEquals("A", alertControlUnit("motor-current"))
        assertEquals("°C", alertControlUnit("controller-temp"))
        assertEquals("A", alertControlUnit("batt-current"))
        assertEquals("°", alertControlUnit("imu"))
        assertEquals("", alertControlUnit("footpad"))
    }
}
