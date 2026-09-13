package expo.modules.vescapecore.accessory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The ground-clearance contract, driven by `shared/fixtures/accessory-protocol/session.json`: what
 * a sample decodes to, what the declared range does to it, which samples are accepted, and what a
 * saved calibration turns a distance into.
 *
 * The property most of these cases exist to defend is one sentence: **a missing measurement is
 * never a distance.** Every way a reading can fail to be one — no value, a null value, a textual
 * value, a status from a newer firmware, a number outside the declared window — has a case here,
 * and all of them end at `error` or `out_of_range` with no value attached. None of them ends at the
 * top of the range, which is the reading that would tell a board it is safe to tilt.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearanceTests.swift
 */
class GroundClearanceTest {
    private val fixture = AccessoryFixtures.load("session.json")
    private val sessionId = fixture.getString("sessionId")
    private val readings = fixture.getJSONObject("readings")
    private val groundClearance = fixture.getJSONObject("groundClearance")

    private fun declaredRange(owner: org.json.JSONObject): Pair<Double, Double> {
        val range = owner.getJSONObject("declaredRange")
        return range.getDouble("min") to range.getDouble("max")
    }

    @Test
    fun everySampleDecodesExactlyAsTheFixturePinsIt() {
        val cases = readings.getJSONArray("decode")
        assertTrue("fixture must carry reading decode cases", cases.length() > 0)
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val parsed = AccessoryResponse.parse(case.getString("line"), sessionId)

            if (case.optBoolean("ignored")) {
                assertEquals(name, AccessoryResponse.Ignored, parsed)
                continue
            }
            val expected = case.getJSONObject("reading")
            val sample = parsed as? AccessoryResponse.Sample ?: error("$name: expected a sample, got $parsed")
            val reading = sample.reading
            assertEquals(name, expected.getString("capabilityId"), reading.capabilityId)
            assertEquals(name, expected.getInt("seq"), reading.seq)
            assertEquals(name, expected.getLong("sampleTimeMs"), reading.sampleTimeMs)
            assertEquals(name, expected.getString("status"), reading.status.wire)
            if (expected.isNull("valueCm")) {
                assertNull(name, reading.valueCm)
            } else {
                assertEquals(name, expected.getDouble("valueCm"), reading.valueCm!!, 1e-9)
            }
        }
    }

    @Test
    fun aValueOutsideTheDeclaredWindowIsOutOfRangeRatherThanClamped() {
        val (min, max) = declaredRange(readings)
        val capabilityId = readings.getString("capabilityId")
        val cases = readings.getJSONArray("rangeCheck")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val reading = AccessoryReading(
                capabilityId = capabilityId,
                seq = 1,
                sampleTimeMs = 100,
                status = AccessoryReadingStatus.OK,
                valueCm = case.getDouble("valueCm"),
            ).withinDeclaredRange(min, max)
            assertEquals(name, case.getString("resolvedStatus"), reading.status.wire)
            if (case.isNull("resolvedValueCm")) {
                // The whole point: a number the hardware no longer promises loses its value rather
                // than being squeezed to the nearest limit.
                assertNull(name, reading.valueCm)
            } else {
                assertEquals(name, case.getDouble("resolvedValueCm"), reading.valueCm!!, 1e-9)
            }
        }
    }

    @Test
    fun onlyASampleNewerThanTheOneHeldIsAccepted() {
        val capabilityId = readings.getString("capabilityId")
        val cases = readings.getJSONArray("acceptance")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val tracker = AccessoryReadingTracker()
            if (!case.isNull("previous")) {
                val previous = case.getJSONObject("previous")
                assertTrue(
                    "$name: seeding the previous sample must succeed",
                    tracker.accept(
                        AccessoryReading(
                            capabilityId, previous.getInt("seq"), previous.getLong("sampleTimeMs"),
                            AccessoryReadingStatus.OK, 10.0,
                        ),
                        receivedAtMs = 1_000,
                    ),
                )
            }
            val accepted = tracker.accept(
                AccessoryReading(
                    capabilityId, case.getInt("seq"), case.getLong("sampleTimeMs"),
                    AccessoryReadingStatus.OK, 11.0,
                ),
                receivedAtMs = 2_000,
            )
            assertEquals(name, case.getBoolean("accepted"), accepted)
        }
    }

    @Test
    fun aFreshSessionKeepsNothingFromTheOldOne() {
        // Sequence numbers restart with the next hello. Without the reset the new session's first
        // samples would be refused as duplicates and the screen would sit on a distance measured
        // before the accessory rebooted.
        val tracker = AccessoryReadingTracker()
        val ok = AccessoryReading("clearance", 40, 9_000, AccessoryReadingStatus.OK, 12.0)
        assertTrue(tracker.accept(ok, receivedAtMs = 1_000))
        tracker.reset()
        assertNull(tracker.latest)
        assertTrue(tracker.accept(ok.copy(seq = 1, sampleTimeMs = 50), receivedAtMs = 2_000))
    }

    @Test
    fun freshnessIsJudgedOnTheRateTheAccessoryConfirmed() {
        val cases = readings.getJSONArray("staleAfterMs")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            assertEquals(
                case.getString("name"),
                case.getLong("staleAfterMs"),
                GroundClearance.staleAfterMs(case.getDouble("rateHz")),
            )
        }
        // An unacknowledged rate is not a reason to widen the window; the floor still applies.
        assertEquals(GroundClearance.MISSING_STREAM_FLOOR_MS, GroundClearance.staleAfterMs(0.0))
        assertEquals(GroundClearance.MISSING_STREAM_FLOOR_MS, GroundClearance.staleAfterMs(Double.NaN))
    }

    @Test
    fun aCalibrationIsCompleteOnlyWhenEveryRuleHolds() {
        val (min, max) = declaredRange(groundClearance)
        val cases = groundClearance.getJSONArray("validity")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val name = case.getString("name")
            val spec = case.getJSONObject("calibration")
            val calibration = GroundClearanceCalibration(
                nearCm = if (spec.isNull("nearCm")) Double.NaN else spec.getDouble("nearCm"),
                farCm = if (spec.isNull("farCm")) Double.NaN else spec.getDouble("farCm"),
                direction = spec.getString("direction"),
                strengthPercent = spec.getInt("strengthPercent"),
            )
            assertEquals(name, case.getBoolean("valid"), calibration.isComplete(min, max))
            val problem = calibration.problem(min, max)?.wire
            if (case.isNull("problem")) assertNull(name, problem) else {
                assertEquals(name, case.getString("problem"), problem)
            }
        }
    }

    @Test
    fun oneDistanceBecomesTheSignedInputTheFixturePins() {
        val cases = groundClearance.getJSONArray("tilt")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val spec = case.getJSONObject("calibration")
            val calibration = GroundClearanceCalibration(
                nearCm = spec.getDouble("nearCm"),
                farCm = spec.getDouble("farCm"),
                direction = spec.getString("direction"),
                strengthPercent = spec.getInt("strengthPercent"),
            )
            assertEquals(
                case.getString("name"),
                case.getDouble("tiltInput"),
                calibration.tiltInput(case.getDouble("valueCm")),
                1e-9,
            )
        }
    }

    @Test
    fun measurementIsDemandedByAPreviewOrByRidingACalibratedBoard() {
        val runtime = GroundClearanceRuntime("clearance")
        runtime.rangeMin = 3.0
        runtime.rangeMax = 100.0
        assertFalse("nothing wants it", runtime.measurementDemanded)

        runtime.previewOpen = true
        assertTrue("a preview measures even uncalibrated — that is how a calibration is made", runtime.measurementDemanded)

        runtime.previewOpen = false
        runtime.riding = true
        // Riding an uncalibrated sensor measures nothing: there is no binding to consume the samples,
        // so the accessory would burn power producing them for nobody.
        assertFalse("riding without a calibration has no consumer", runtime.measurementDemanded)

        runtime.calibration = GroundClearanceCalibration(5.0, 20.0, "nose", 60)
        assertTrue(runtime.measurementDemanded)

        // A firmware that narrowed its range invalidates the saved numbers, and with them the demand.
        runtime.rangeMin = 8.0
        assertFalse("a calibration that no longer fits drives nothing", runtime.measurementDemanded)
    }

    @Test
    fun aTiltBindingIsReleasedWithANamedReasonForEveryWayTheInputCanFail() {
        val runtime = GroundClearanceRuntime("clearance")
        runtime.rangeMin = 3.0
        runtime.rangeMax = 100.0
        runtime.rateHz = 20.0

        fun input(now: Long = 1_000, connected: Boolean = true) = runtime.input(now, connected)

        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.NOT_RIDING),
            input(),
        )
        runtime.riding = true
        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.NO_LINK),
            input(connected = false),
        )
        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.NOT_CALIBRATED),
            input(),
        )

        runtime.calibration = GroundClearanceCalibration(5.0, 20.0, "nose", 100)
        // Calibrated, connected, riding — and no sample has ever arrived. That is stale, not zero.
        assertEquals(GroundClearanceInput.Release(GroundClearanceRelease.STALE), input())

        runtime.tracker.accept(
            AccessoryReading("clearance", 1, 100, AccessoryReadingStatus.OK, 12.5),
            receivedAtMs = 1_000,
        )
        assertEquals(GroundClearanceInput.Drive(0.5, 12.5), input(now = 1_100))
        // Past the missing-stream window the same sample is no longer evidence of anything.
        assertEquals(GroundClearanceInput.Release(GroundClearanceRelease.STALE), input(now = 1_400))

        runtime.tracker.accept(
            AccessoryReading("clearance", 2, 150, AccessoryReadingStatus.OUT_OF_RANGE, null),
            receivedAtMs = 1_400,
        )
        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.OUT_OF_RANGE),
            input(now = 1_450),
        )

        runtime.tracker.accept(
            AccessoryReading("clearance", 3, 200, AccessoryReadingStatus.ERROR, null),
            receivedAtMs = 1_500,
        )
        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.SENSOR_ERROR),
            input(now = 1_550),
        )
    }

    @Test
    fun anOkReadingWithoutAValueCannotBeConstructed() {
        // The type refuses the pairing that would make a status and a number disagree, which is what
        // lets every consumer treat "has a value" as "is a measurement".
        val thrown = runCatching {
            AccessoryReading("clearance", 1, 100, AccessoryReadingStatus.OUT_OF_RANGE, 12.0)
        }
        assertTrue("a non-ok reading must not carry a value", thrown.isFailure)
    }

    @Test
    fun bindingControllerPreservesDemandLimitsAndContestedOwnership() {
        val controller = GroundClearanceBindingController { 1_100 }
        fun capability(id: String, min: Double = 3.0, max: Double = 100.0) = AccessoryCapability(
            id, AccessoryProtocol.TYPE_GROUND_CLEARANCE, true, "cm", min, max, listOf(20.0),
        )
        controller.applyCapability("front", capability("clearance"), liveManifest = true, rateHz = 20.0)
        controller.applyCalibration("front", "clearance", GroundClearanceCalibration(5.0, 30.0, "nose", 60))
        controller.setRiding(true)
        controller.applyCapability("front", capability("clearance", 10.0, 20.0), liveManifest = false, rateHz = 20.0)
        assertEquals(null, (controller.describe("front", "clearance")?.get("calibration") as Map<*, *>)["problem"])

        assertTrue(controller.setPreview("front", "clearance", true))
        assertTrue(controller.releasePreviews())
        assertEquals(true, controller.describe("front", "clearance")?.get("measuring"))

        controller.applyCapability("rear", capability("clearance"), liveManifest = true, rateHz = 20.0)
        controller.applyCalibration("rear", "clearance", GroundClearanceCalibration(5.0, 30.0, "tail", 60))
        controller.applyCapability("rear", capability("clearance"), liveManifest = false, rateHz = 20.0)
        val connected = { _: String, _: String -> GroundClearanceBindingController.LinkState(true, 20.0) }
        assertTrue(controller.bound(connected))
        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.CONTESTED),
            controller.tilt(connected),
        )
    }

    @Test
    fun bindingControllerEmitsReadingsOnlyForPreviewAndInvalidatesThemWithTheSession() {
        val controller = GroundClearanceBindingController { 1_100 }
        val capability = AccessoryCapability(
            "clearance", AccessoryProtocol.TYPE_GROUND_CLEARANCE, true, "cm", 3.0, 100.0, listOf(20.0),
        )
        controller.applyCapability("sensor", capability, liveManifest = true, rateHz = 20.0)
        controller.applyCalibration("sensor", "clearance", GroundClearanceCalibration(5.0, 20.0, "nose", 100))
        controller.setRiding(true)
        controller.applyCapability("sensor", capability, liveManifest = false, rateHz = 20.0)
        val reading = AccessoryReading("clearance", 1, 100, AccessoryReadingStatus.OK, 12.5)
        assertNull(controller.acceptReading("sensor", reading, 1_000, 20.0))
        controller.setPreview("sensor", "clearance", true)
        assertTrue(controller.acceptReading("sensor", reading.copy(seq = 2), 1_000, 20.0) != null)
        controller.onSessionLost("sensor")
        assertEquals(
            GroundClearanceInput.Release(GroundClearanceRelease.STALE),
            controller.input("sensor", "clearance", GroundClearanceBindingController.LinkState(true, 20.0)),
        )
    }
}
