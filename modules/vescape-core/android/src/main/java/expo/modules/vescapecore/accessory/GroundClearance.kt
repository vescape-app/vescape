package expo.modules.vescapecore.accessory

import expo.modules.vescapecore.RemoteInputArbiter
import expo.modules.vescapecore.RemoteInputOwner
import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import expo.modules.vescapecore.runtime.Cancellable
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
 */
object GroundClearance {
    const val MISSING_STREAM_FLOOR_MS = 300L

    const val MIN_STRENGTH_PERCENT = 1
    const val MAX_STRENGTH_PERCENT = 100

    fun staleAfterMs(rateHz: Double): Long {
        if (!rateHz.isFinite() || rateHz <= 0.0) return MISSING_STREAM_FLOOR_MS
        return max(MISSING_STREAM_FLOOR_MS, (3_000.0 / rateHz).roundToLong())
    }

    fun tiltCommand(tiltInput: Double): Int {
        if (!tiltInput.isFinite()) return REMOTE_TILT_CENTER
        val span = 255 - REMOTE_TILT_CENTER
        return (REMOTE_TILT_CENTER + tiltInput.coerceIn(-1.0, 1.0) * span).roundToInt().coerceIn(0, 255)
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceDirection`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceDirection`
 */
enum class GroundClearanceDirection(val wire: String) {
    NOSE("nose"),

    TAIL("tail");

    companion object {
        fun fromWire(value: String?): GroundClearanceDirection? =
            entries.firstOrNull { it.wire == value }
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceCalibration`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/database/DatabaseEntities.kt `AccessoryGroundClearanceEntity`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceCalibration`
 */
data class GroundClearanceCalibration(
    val nearCm: Double,
    val farCm: Double,
    val direction: String,
    val strengthPercent: Int,
) {
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

    fun isComplete(rangeMin: Double?, rangeMax: Double?): Boolean = problem(rangeMin, rangeMax) == null

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
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceProblem`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceProblem`
 */
enum class GroundClearanceProblem(val wire: String) {
    NOT_A_NUMBER("not-a-number"),

    NEAR_NOT_BELOW_FAR("near-not-below-far"),

    UNKNOWN_DIRECTION("unknown-direction"),

    STRENGTH_OUT_OF_BOUNDS("strength-out-of-bounds"),

    OUTSIDE_DECLARED_RANGE("outside-declared-range"),
}

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceRelease`
 * @parity /modules/vescape-core/src/index.ts `GroundClearanceRelease`
 */
enum class GroundClearanceRelease(val wire: String) {
    DISABLED("disabled"),
    NOT_RIDING("not-riding"),

    BOARD_UNTRUSTED("board-untrusted"),

    BOARD_STALE("board-stale"),

    CONTESTED("contested"),

    BOARD_MOVE("board-move"),

    MANUAL_TILT("manual-tilt"),

    NO_LINK("no-link"),

    NOT_CALIBRATED("not-calibrated"),

    STALE("stale"),

    OUT_OF_RANGE("out-of-range"),

    SENSOR_ERROR("sensor-error"),
}

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceInput`
 */
sealed class GroundClearanceInput {
    data class Drive(val tiltInput: Double, val valueCm: Double) : GroundClearanceInput()

    data class Release(val reason: GroundClearanceRelease) : GroundClearanceInput()
}

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `AccessoryReadingTracker`
 */
class AccessoryReadingTracker {
    var latest: AccessoryReading? = null
        private set

    var latestAtMs: Long? = null
        private set

    private var lastSeq: Int? = null
    private var lastSampleTimeMs: Long? = null

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

    fun reset() {
        latest = null
        latestAtMs = null
        lastSeq = null
        lastSampleTimeMs = null
    }

    fun isFresh(nowMs: Long, staleAfterMs: Long): Boolean {
        val at = latestAtMs ?: return false
        return nowMs - at < staleAfterMs
    }
}

/**
 * @parity /modules/vescape-core/ios/accessory/GroundClearance.swift `GroundClearanceRuntime`
 */
internal class GroundClearanceRuntime(val capabilityId: String) {
    var enabled: Boolean = true
    var calibration: GroundClearanceCalibration? = null

    var rangeMin: Double? = null
    var rangeMax: Double? = null

    var rateHz: Double = 0.0

    var previewOpen: Boolean = false

    var riding: Boolean = false

    val tracker = AccessoryReadingTracker()
    val previewLog = ClearancePreviewLog()

    val isCalibrated: Boolean
        get() = calibration?.isComplete(rangeMin, rangeMax) == true

    val measurementDemanded: Boolean
        get() = enabled && (previewOpen || (riding && isCalibrated))

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
                val value = reading.valueCm
                    ?: return GroundClearanceInput.Release(GroundClearanceRelease.SENSOR_ERROR)
                GroundClearanceInput.Drive(saved.tiltInput(value), value)
            }
        }
    }

    fun onSessionLost() {
        tracker.reset()
        previewLog.reset()
        rateHz = 0.0
    }
}

/**
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
