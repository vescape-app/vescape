package expo.modules.vescapecore.accessory

import expo.modules.vescapecore.RemoteInputArbiter
import expo.modules.vescapecore.RemoteInputOwner
import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import expo.modules.vescapecore.runtime.Cancellable
import kotlin.math.max
import kotlin.math.roundToInt
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

    /**
     * The Refloat remote-input byte one signed correction asks for.
     *
     * The scale is the pad's: 128 is neutral and 255 is full nose-up, so a correction of 1.0 is the
     * same command a rider dragging the pad to its right edge would send. Defined here rather than
     * at the call site because both platforms and the tests have to agree on it byte for byte.
     *
     * A non-finite input is neutral, not a clamp to an extreme. Nothing should be able to produce
     * one — [GroundClearanceCalibration.tiltInput] returns 0.0 for a non-finite distance — but the
     * one place that decides what a board is told is not where to find out.
     */
    fun tiltCommand(tiltInput: Double): Int {
        if (!tiltInput.isFinite()) return REMOTE_TILT_CENTER
        val span = 255 - REMOTE_TILT_CENTER
        return (REMOTE_TILT_CENTER + tiltInput.coerceIn(-1.0, 1.0) * span).roundToInt().coerceIn(0, 255)
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
    DISABLED("disabled"),
    /** Sensor-driven tilt is for riding. A parked board is not corrected. */
    NOT_RIDING("not-riding"),

    /**
     * The Board is not connected, or its link is not Trusted.
     *
     * Decided by the Board Session, not here: this file knows what the sensor is saying and nothing
     * about whether the thing on the other end is the Board the rider thinks it is.
     */
    BOARD_UNTRUSTED("board-untrusted"),

    /**
     * The Board is connected but has stopped answering.
     *
     * Riding is read off telemetry, so telemetry that stopped is evidence that has stopped being
     * evidence. Holding the last engaged frame's worth of permission would let a sensor keep tilting
     * a Board nobody can hear.
     */
    BOARD_STALE("board-stale"),

    /**
     * More than one calibrated ground-clearance capability wants the tilt channel.
     *
     * The PoC deliberately has no arbitration between a nose sensor and a tail sensor, and picking
     * one of them arbitrarily would be picking a correction direction arbitrarily. Two claimants is
     * a configuration the rider has to resolve, not one this app guesses its way through.
     */
    CONTESTED("contested"),

    /** Board Move holds the remote-input slot. Both cannot write it, and a jog is the parked one. */
    BOARD_MOVE("board-move"),

    /**
     * A rider-commanded tilt still holds the slot.
     *
     * Only reachable in the moment a binding arms under a tilt that was started before it: the pad
     * refuses new manual input for as long as a binding is bound, and the arming itself cancels
     * whatever was held. It is named because an unexplained silent second is worse than a sentence.
     */
    MANUAL_TILT("manual-tilt"),

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
    var enabled: Boolean = true
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
    val previewLog = ClearancePreviewLog()

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
        get() = enabled && (previewOpen || (riding && isCalibrated))

    /**
     * What a tilt binding may do right now.
     *
     * Ordered by what the rider most needs to hear. Not riding comes first because it is the normal
     * resting state and not a fault; the sensor's own problems come last, when everything that
     * would have consumed them is in place.
     */
    fun input(nowMs: Long, linkConnected: Boolean): GroundClearanceInput {
        if (!enabled) return GroundClearanceInput.Release(GroundClearanceRelease.DISABLED)
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
        previewLog.reset()
        rateHz = 0.0
    }
}

/**
 * Owns every live ground-clearance binding across enrolled Accessories.
 *
 * The generic session coordinator supplies connection facts and carries protocol commands; this
 * controller owns capability state, demand, readings, calibration application, and claimant
 * selection. Keeping those decisions here prevents a new capability from growing another parallel
 * subsystem inside `AccessorySessionManager`.
 *
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceBindingController`
 */
internal class GroundClearanceBindingController(
    private val nowMs: () -> Long,
) {
    data class Key(val accessoryId: String, val capabilityId: String)

    data class LinkState(val connected: Boolean, val appliedRateHz: Double)

    private val runtimes = LinkedHashMap<Key, GroundClearanceRuntime>()

    @Volatile private var riding = false

    fun reset(calibrations: Iterable<Pair<Key, GroundClearanceCalibration>>) {
        runtimes.clear()
        calibrations.forEach { (key, calibration) -> runtime(key).calibration = calibration }
    }

    private fun runtime(accessoryId: String, capabilityId: String): GroundClearanceRuntime =
        runtime(Key(accessoryId, capabilityId))

    private fun runtime(key: Key): GroundClearanceRuntime =
        runtimes.getOrPut(key) { GroundClearanceRuntime(key.capabilityId) }

    fun applyCapability(
        accessoryId: String,
        capability: AccessoryCapability,
        liveManifest: Boolean,
        rateHz: Double,
        enabled: Boolean = true,
    ): AccessoryCommand.Configure {
        val state = runtime(accessoryId, capability.id)
        if (state.enabled != enabled) state.onSessionLost()
        state.enabled = enabled
        if (liveManifest) {
            state.rangeMin = capability.rangeMin
            state.rangeMax = capability.rangeMax
        }
        state.riding = riding
        return AccessoryCommand.Configure(capability.id, state.measurementDemanded, rateHz)
    }

    fun setPreview(accessoryId: String, capabilityId: String, open: Boolean): Boolean {
        val state = runtime(accessoryId, capabilityId)
        if (state.previewOpen == open) return false
        state.previewLog.reset()
        state.previewOpen = open
        return true
    }

    fun releasePreviews(): Boolean {
        var changed = false
        runtimes.values.forEach { state ->
            if (state.previewOpen) {
                state.previewOpen = false
                changed = true
            }
        }
        return changed
    }

    fun setRiding(value: Boolean): Boolean {
        if (riding == value) return false
        riding = value
        return true
    }

    fun validate(
        accessoryId: String,
        capabilityId: String,
        calibration: GroundClearanceCalibration,
    ): GroundClearanceProblem? {
        val state = runtime(accessoryId, capabilityId)
        return calibration.problem(state.rangeMin, state.rangeMax)
    }

    fun applyCalibration(accessoryId: String, capabilityId: String, calibration: GroundClearanceCalibration) {
        runtime(accessoryId, capabilityId).calibration = calibration
    }

    fun clearCalibration(accessoryId: String, capabilityId: String) {
        runtime(accessoryId, capabilityId).calibration = null
    }

    fun describe(accessoryId: String, capabilityId: String): Map<String, Any?>? {
        val state = runtimes[Key(accessoryId, capabilityId)] ?: return null
        return mapOf(
            "calibration" to state.calibration?.let {
                mapOf(
                    "nearCm" to it.nearCm,
                    "farCm" to it.farCm,
                    "direction" to it.direction,
                    "strengthPercent" to it.strengthPercent,
                    "problem" to it.problem(state.rangeMin, state.rangeMax)?.wire,
                )
            },
            "measuring" to state.measurementDemanded,
        )
    }

    fun input(accessoryId: String, capabilityId: String, link: LinkState): GroundClearanceInput {
        val state = runtimes[Key(accessoryId, capabilityId)]
            ?: return GroundClearanceInput.Release(GroundClearanceRelease.NOT_CALIBRATED)
        state.rateHz = link.appliedRateHz
        return state.input(nowMs(), link.connected)
    }

    private fun boundCapabilities(link: (String, String) -> LinkState): List<Key> =
        runtimes.entries
            .filter { (key, state) -> state.enabled && state.isCalibrated && link(key.accessoryId, key.capabilityId).connected }
            .map { it.key }

    fun bound(link: (String, String) -> LinkState): Boolean = boundCapabilities(link).isNotEmpty()

    fun tilt(link: (String, String) -> LinkState): GroundClearanceInput {
        val bound = boundCapabilities(link)
        if (bound.size > 1) return GroundClearanceInput.Release(GroundClearanceRelease.CONTESTED)
        val key = bound.firstOrNull()
            ?: return GroundClearanceInput.Release(
                if (runtimes.isNotEmpty() && runtimes.values.none { it.enabled }) GroundClearanceRelease.DISABLED
                else if (runtimes.values.any { it.enabled && it.isCalibrated }) GroundClearanceRelease.NO_LINK
                else GroundClearanceRelease.NOT_CALIBRATED,
            )
        return input(key.accessoryId, key.capabilityId, link(key.accessoryId, key.capabilityId))
    }

    fun acceptReading(
        accessoryId: String,
        reading: AccessoryReading,
        receivedAtMs: Long,
        appliedRateHz: Double?,
    ): Map<String, Any?>? {
        val state = runtimes[Key(accessoryId, reading.capabilityId)] ?: return null
        if (!state.enabled) return null
        if (appliedRateHz != null) state.rateHz = appliedRateHz
        val checked = reading.withinDeclaredRange(state.rangeMin, state.rangeMax)
        if (!state.tracker.accept(checked, receivedAtMs) || !state.previewOpen) return null
        state.previewLog.record(receivedAtMs, checked.sampleTimeMs, checked.seq.toLong(), checked.valueCm)
        if (!state.previewLog.shouldEmit(receivedAtMs)) return null
        return mapOf(
            "diagnostics" to state.previewLog.snapshot(receivedAtMs),
            "accessoryId" to accessoryId,
            "capabilityId" to checked.capabilityId,
            "seq" to checked.seq,
            "sampleTimeMs" to checked.sampleTimeMs,
            "status" to checked.status.wire,
            "valueCm" to checked.valueCm,
            "staleAfterMs" to GroundClearance.staleAfterMs(state.rateHz),
            // Preview the same mapping as riding, without granting permission to drive.
            "tiltPreviewPercent" to checked.valueCm?.let { value ->
                state.calibration?.takeIf { state.isCalibrated }?.tiltInput(value)?.times(100.0)
            },
        )
    }

    fun onSessionLost(accessoryId: String) {
        runtimes.forEach { (key, state) -> if (key.accessoryId == accessoryId) state.onSessionLost() }
    }

    fun forget(accessoryId: String) {
        runtimes.keys.removeAll { it.accessoryId == accessoryId }
    }
}

/**
 * Board-side lifecycle and arbitration for the ground-clearance Accessory Binding.
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `BoardGroundClearanceBinding`
 */
internal class BoardGroundClearanceBinding(
    private val remoteInput: RemoteInputArbiter,
    private val boundInput: () -> Boolean,
    private val tiltInput: () -> GroundClearanceInput,
) {
    /** @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `tickMs` */
    companion object {
        const val TICK_MS = 100L
    }

    data class BoardInput(val commandsTrusted: Boolean, val telemetryFresh: Boolean)

    private var scheduled: Cancellable? = null
    private var schedule: (((() -> Unit)) -> Cancellable)? = null
    private var boardInput: (() -> BoardInput)? = null
    private var bound = false
    private var release: GroundClearanceRelease? = GroundClearanceRelease.NOT_CALIBRATED

    fun start(schedule: ((() -> Unit)) -> Cancellable, boardInput: () -> BoardInput) {
        if (scheduled != null) return
        this.schedule = schedule
        this.boardInput = boardInput
        scheduleNext()
    }

    private fun scheduleNext() {
        scheduled = schedule?.invoke {
            tick(requireNotNull(boardInput).invoke())
            scheduleNext()
        }
    }

    fun stop() {
        scheduled?.cancel()
        scheduled = null
        schedule = null
        boardInput = null
        remoteInput.sensorRelease()
        bound = false
        release = GroundClearanceRelease.BOARD_UNTRUSTED
    }

    internal fun tick(board: BoardInput) {
        bound = boundInput()
        // Every tick, not just the arming one. A manual tilt that survives into a bound session —
        // one taken in the window before the pad learned it was read-only, or one whose arming-time
        // cancel failed on a transport that blinked — is a lock that never ends by itself, and the
        // read-only pad has no Cancel for the rider to press. `releaseManual` no-ops once the ease
        // is running, so repeating it costs nothing.
        if (bound) remoteInput.releaseManual()

        val input = when {
            !board.commandsTrusted -> GroundClearanceInput.Release(GroundClearanceRelease.BOARD_UNTRUSTED)
            !board.telemetryFresh -> GroundClearanceInput.Release(GroundClearanceRelease.BOARD_STALE)
            remoteInput.owner == RemoteInputOwner.MOVE -> GroundClearanceInput.Release(GroundClearanceRelease.BOARD_MOVE)
            remoteInput.owner == RemoteInputOwner.MANUAL -> GroundClearanceInput.Release(GroundClearanceRelease.MANUAL_TILT)
            else -> tiltInput()
        }
        when (input) {
            is GroundClearanceInput.Drive -> {
                release = if (remoteInput.sensorDrive(GroundClearance.tiltCommand(input.tiltInput))) {
                    null
                } else {
                    GroundClearanceRelease.BOARD_UNTRUSTED
                }
            }
            is GroundClearanceInput.Release -> {
                remoteInput.sensorRelease()
                release = input.reason
            }
        }
    }

    fun state(): Map<String, Any?> = mapOf(
        "bound" to bound,
        "driving" to (remoteInput.owner == RemoteInputOwner.SENSOR),
        "release" to release?.wire,
    )
}
