package expo.modules.vescapecore.accessory

import kotlin.math.max
import kotlin.math.roundToLong

/**
 * The ground-clearance capability: the rider's calibration, the sample stream it reads, and the
 * one number a Remote Tilt binding is allowed to act on.
 *
 * Pure and clock-free on purpose — every timestamp arrives as a parameter — so the rules below can
 * be asserted against `shared/fixtures/accessory-protocol/session.json` without a radio, a sensor
 * or a board. [AccessorySessionManager] owns the wiring; this file owns the arithmetic.
 *
 * The property everything else rests on: **a missing measurement is never a distance.** Not the top
 * of the range, not the last good value, not zero. A sensor that stopped answering releases the
 * input, and so does one answering with something this app cannot read.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
 */
object GroundClearance {
    /** Floor under the missing-stream timeout, `docs/accessory-protocol.md` PoC defaults. */
    const val MISSING_STREAM_FLOOR_MS = 300L

    /** A binding that commands nothing is not a binding, so zero strength is not a calibration. */
    const val MIN_STRENGTH_PERCENT = 1
    const val MAX_STRENGTH_PERCENT = 100

    /**
     * How long a capability may go without a sample before its input is released.
     *
     * Three sample periods, floored: at 20 Hz the floor is what matters, and a slow rate gets room
     * for two dropped samples rather than being declared dead by a fixed 300 ms it never had a
     * chance to meet.
     */
    fun staleAfterMs(rateHz: Double): Long {
        if (!rateHz.isFinite() || rateHz <= 0.0) return MISSING_STREAM_FLOOR_MS
        return max(MISSING_STREAM_FLOOR_MS, (3_000.0 / rateHz).roundToLong())
    }
}

/**
 * Which way a mounted sensor corrects.
 *
 * Kept as a wire string in [GroundClearanceCalibration] rather than parsed on the way in: a saved
 * row written by a newer build must be *rejected* as incomplete, not crash the session that read
 * it, and an unparsed direction is exactly the incomplete calibration the rider needs to fix.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceDirection`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceDirection`
 */
enum class GroundClearanceDirection(val wire: String) {
    /** Sensor at the nose: losing clearance there is answered by lifting the nose. */
    NOSE("nose"),

    /** Sensor at the tail: the same loss is answered by lifting the tail. */
    TAIL("tail");

    companion object {
        fun fromWire(value: String?): GroundClearanceDirection? =
            entries.firstOrNull { it.wire == value }
    }
}

/**
 * What the rider calibrated for one ground-clearance capability.
 *
 * There is no partial state and no Save step: this is written when it is complete and valid, and a
 * calibration that is not both drives nothing. [farCm] is where correction starts and [nearCm] is
 * where it is at full strength, so `near < far` always — less clearance means more correction.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceCalibration`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryEntities.kt `AccessoryGroundClearanceEntity`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
 */
data class GroundClearanceCalibration(
    val nearCm: Double,
    val farCm: Double,
    /** Raw wire value. Anything [GroundClearanceDirection] does not know makes this incomplete. */
    val direction: String,
    val strengthPercent: Int,
) {
    /**
     * What is wrong with this calibration, or null when nothing is.
     *
     * A reason rather than a boolean because the same absence — nothing saved, nothing driving —
     * has to be explained differently depending on which rule it broke, and native is the only
     * place that knows the rules. A screen that re-derived them would be a second definition of
     * "valid" that could disagree with the one the binding actually uses.
     *
     * The declared window is part of the test, not just the numbers' own order. An accessory whose
     * firmware narrowed its range is still the same accessory, and a calibration made against the
     * old numbers has to stop driving rather than be silently squeezed into the new ones.
     */
    fun problem(rangeMin: Double?, rangeMax: Double?): GroundClearanceProblem? {
        if (!nearCm.isFinite() || !farCm.isFinite()) return GroundClearanceProblem.NOT_A_NUMBER
        if (nearCm >= farCm) return GroundClearanceProblem.NEAR_NOT_BELOW_FAR
        if (GroundClearanceDirection.fromWire(direction) == null) {
            return GroundClearanceProblem.UNKNOWN_DIRECTION
        }
        if (strengthPercent < GroundClearance.MIN_STRENGTH_PERCENT) {
            return GroundClearanceProblem.STRENGTH_OUT_OF_BOUNDS
        }
        if (strengthPercent > GroundClearance.MAX_STRENGTH_PERCENT) {
            return GroundClearanceProblem.STRENGTH_OUT_OF_BOUNDS
        }
        if (rangeMin != null && nearCm < rangeMin) return GroundClearanceProblem.OUTSIDE_DECLARED_RANGE
        if (rangeMax != null && farCm > rangeMax) return GroundClearanceProblem.OUTSIDE_DECLARED_RANGE
        return null
    }

    /** Whether this is a calibration the hardware in front of us can actually be driven to. */
    fun isComplete(rangeMin: Double?, rangeMax: Double?): Boolean = problem(rangeMin, rangeMax) == null

    /**
     * The signed Remote Tilt input one measured distance calls for, in -1..1.
     *
     * Positive lifts the nose. Outside `[near, far]` the value saturates rather than extrapolating:
     * a sensor reading closer than the near distance is already asking for everything there is, and
     * one reading past the far distance is asking for nothing.
     */
    fun tiltInput(valueCm: Double): Double {
        if (!valueCm.isFinite()) return 0.0
        val span = farCm - nearCm
        if (span <= 0.0) return 0.0
        val fraction = ((farCm - valueCm) / span).coerceIn(0.0, 1.0)
        val magnitude = fraction * (strengthPercent.toDouble() / 100.0)
        return when (GroundClearanceDirection.fromWire(direction)) {
            GroundClearanceDirection.NOSE -> magnitude
            GroundClearanceDirection.TAIL -> -magnitude
            null -> 0.0
        }
    }
}

/**
 * Why a calibration is not one yet.
 *
 * The rider is mid-edit far more often than they are finished, so "not saved" is the normal state
 * of this screen and needs a sentence, not a silence.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceProblem`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceProblem`
 */
enum class GroundClearanceProblem(val wire: String) {
    /** A distance that is not a finite number. A row written by a broken build reads as this. */
    NOT_A_NUMBER("not-a-number"),

    /** Less clearance must mean more correction, so the near distance has to be the smaller one. */
    NEAR_NOT_BELOW_FAR("near-not-below-far"),

    /** A mounting position this build does not know. A newer build wrote it; this one cannot use it. */
    UNKNOWN_DIRECTION("unknown-direction"),

    /** Zero commands nothing and past full commands something the pad cannot express. */
    STRENGTH_OUT_OF_BOUNDS("strength-out-of-bounds"),

    /** Outside what the accessory currently says it can measure. Recalibrate against the new limits. */
    OUTSIDE_DECLARED_RANGE("outside-declared-range"),
}

/**
 * Why a ground-clearance binding is not commanding anything.
 *
 * Carried rather than collapsed to a bare null so the consumer — and the rider's screen — can say
 * which of these it is. "The sensor is reporting an error" and "the rider has not calibrated yet"
 * look identical as an absent number and are nothing alike to explain.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceRelease`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceRelease`
 */
enum class GroundClearanceRelease(val wire: String) {
    /** Sensor-driven tilt is for riding. A parked board is not corrected. */
    NOT_RIDING("not-riding"),

    /** No session, or a session that is not acknowledging commands. */
    NO_LINK("no-link"),

    /** Nothing saved, or what is saved no longer fits the limits the accessory declares. */
    NOT_CALIBRATED("not-calibrated"),

    /** Samples stopped arriving. The accessory may still be connected; it is not measuring. */
    STALE("stale"),

    /** The sensor answered, and the answer is not a distance. */
    OUT_OF_RANGE("out-of-range"),

    /** The sensor could not measure, or sent something this app cannot read as a measurement. */
    SENSOR_ERROR("sensor-error"),
}

/**
 * The only thing a tilt binding is allowed to see.
 *
 * Two cases and no third: either there is a calibrated, fresh, in-range measurement and a number
 * to command, or there is a reason to let go. Nothing here can be read as "hold the last value" —
 * the type has no way to express it.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceInput`
 */
sealed class GroundClearanceInput {
    /** A live measurement, already scaled by the rider's strength and mounting direction. */
    data class Drive(val tiltInput: Double, val valueCm: Double) : GroundClearanceInput()

    /** Release any held input, smoothly, and command nothing until a [Drive] arrives. */
    data class Release(val reason: GroundClearanceRelease) : GroundClearanceInput()
}

/**
 * Per-capability sample bookkeeping: what the newest accepted sample was, and when it landed here.
 *
 * Deliberately *not* a ring buffer. Nothing in this slice looks backwards — the screen shows the
 * newest number and a tilt binding acts on the newest number — so a history would be a buffer whose
 * only job is to grow. [AccessoryLink] already coalesces commands; readings need the same
 * treatment, which is one slot.
 *
 * Two clocks, kept apart on purpose. [AccessoryReading.sampleTimeMs] is the accessory's own uptime
 * and only ever compared to other samples from the same session; freshness is judged on
 * [latestAtMs], this phone's monotonic receipt time. Subtracting one from the other would be a
 * latency measurement across two unsynchronised clocks.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `AccessoryReadingTracker`
 */
class AccessoryReadingTracker {
    /** Newest accepted sample, already range-checked. Null until one arrives in this session. */
    var latest: AccessoryReading? = null
        private set

    /** Local monotonic receipt time of [latest]. */
    var latestAtMs: Long? = null
        private set

    private var lastSeq: Int? = null
    private var lastSampleTimeMs: Long? = null

    /**
     * Takes one sample if it is newer than what is held, and says whether it was taken.
     *
     * Sequence numbers increase across measurement pauses inside a session, so a jump is normal and
     * only a repeat or a step backwards is a duplicate. A sample time that went backwards is refused
     * even when the sequence advanced: the two disagree, and a disagreeing accessory is not one to
     * take a distance from.
     */
    fun accept(reading: AccessoryReading, receivedAtMs: Long): Boolean {
        val previousSeq = lastSeq
        if (previousSeq != null && reading.seq <= previousSeq) return false
        val previousTime = lastSampleTimeMs
        if (previousTime != null && reading.sampleTimeMs < previousTime) return false
        lastSeq = reading.seq
        lastSampleTimeMs = reading.sampleTimeMs
        latest = reading
        latestAtMs = receivedAtMs
        return true
    }

    /** A new protocol session restarts sequence numbers, so nothing from the old one may survive. */
    fun reset() {
        latest = null
        latestAtMs = null
        lastSeq = null
        lastSampleTimeMs = null
    }

    /** Whether a sample landed recently enough to still describe the ground under the board. */
    fun isFresh(nowMs: Long, staleAfterMs: Long): Boolean {
        val at = latestAtMs ?: return false
        return nowMs - at < staleAfterMs
    }
}

/**
 * One enrolled ground-clearance capability's live state: what is saved for it, who wants it
 * measuring, and what its samples currently amount to.
 *
 * Demand is arbitrated here rather than anywhere a screen can reach. Two independent reasons to
 * measure — the rider is riding a calibrated board, or the rider has the configuration screen open
 * — and their union is what the accessory is told. Neither of them alone is permission to *tilt*:
 * [input] refuses on anything but riding, which is what keeps a preview from moving a parked board.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceRuntime`
 */
internal class GroundClearanceRuntime(val capabilityId: String) {
    /** Saved calibration, or null while the rider has not finished one. */
    var calibration: GroundClearanceCalibration? = null

    /** Limits from the live manifest. Null while no session is established. */
    var rangeMin: Double? = null
    var rangeMax: Double? = null

    /** Rate actually acknowledged for this capability, which sets the stale window. */
    var rateHz: Double = 0.0

    /** The configuration screen is open and wants to show live numbers. */
    var previewOpen: Boolean = false

    /** The Board is connected and engaged. Set from the Board session, never from JS. */
    var riding: Boolean = false

    val tracker = AccessoryReadingTracker()

    /** Whether what is saved still fits what the accessory currently declares. */
    val isCalibrated: Boolean
        get() = calibration?.isComplete(rangeMin, rangeMax) == true

    /**
     * Whether the accessory should be measuring at all.
     *
     * Riding without a calibration measures nothing, because nothing could act on the result: the
     * sensor would burn power to produce samples with no binding behind them. Preview measures
     * regardless — that is how the rider *gets* a calibration.
     */
    val measurementDemanded: Boolean
        get() = previewOpen || (riding && isCalibrated)

    /**
     * What a tilt binding may do right now.
     *
     * Ordered by what the rider most needs to hear. Not riding comes first because it is the normal
     * resting state and not a fault; the sensor's own problems come last, when everything that
     * would have consumed them is in place.
     */
    fun input(nowMs: Long, linkConnected: Boolean): GroundClearanceInput {
        if (!riding) return GroundClearanceInput.Release(GroundClearanceRelease.NOT_RIDING)
        if (!linkConnected) return GroundClearanceInput.Release(GroundClearanceRelease.NO_LINK)
        val saved = calibration?.takeIf { it.isComplete(rangeMin, rangeMax) }
            ?: return GroundClearanceInput.Release(GroundClearanceRelease.NOT_CALIBRATED)
        val reading = tracker.latest
        if (reading == null || !tracker.isFresh(nowMs, GroundClearance.staleAfterMs(rateHz))) {
            return GroundClearanceInput.Release(GroundClearanceRelease.STALE)
        }
        return when (reading.status) {
            AccessoryReadingStatus.OUT_OF_RANGE ->
                GroundClearanceInput.Release(GroundClearanceRelease.OUT_OF_RANGE)

            AccessoryReadingStatus.ERROR ->
                GroundClearanceInput.Release(GroundClearanceRelease.SENSOR_ERROR)

            AccessoryReadingStatus.OK -> {
                // Unreachable by construction — an `ok` without a value cannot be built — but a
                // release is the honest answer to a reading that somehow has none, and it costs one
                // branch to never have to trust that.
                val value = reading.valueCm
                    ?: return GroundClearanceInput.Release(GroundClearanceRelease.SENSOR_ERROR)
                GroundClearanceInput.Drive(saved.tiltInput(value), value)
            }
        }
    }

    /** Everything a fresh protocol session invalidates. Calibration is durable and stays. */
    fun onSessionLost() {
        tracker.reset()
        rateHz = 0.0
    }
}
