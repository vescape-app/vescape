package expo.modules.vescapecore.connection

import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceEvent
import expo.modules.vescapecore.diagnostics.ConnectionTraceField
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason
import expo.modules.vescapecore.diagnostics.ConnectionWorkflow
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

/** Rider-visible Presence Scan phase. Mirrors `LiveStateEvent.presence.phase`. */
enum class PresenceScanPhase(val wireValue: String) {
    Idle("idle"),

    /** Started, but the radio is not usable yet. The five-second window has not begun. */
    WaitingForBluetooth("waiting_for_bluetooth"),
    Scanning("scanning"),
    Done("done"),
}

/** Everything JS renders about the current or last Presence Scan. Native owns every field. */
data class PresenceScanState(
    val phase: PresenceScanPhase = PresenceScanPhase.Idle,
    val purpose: ScanPurpose? = null,
    val owner: ConnectionOwner = ConnectionOwner.None,
    val startedAtMs: Long? = null,
    val deadlineAtMs: Long? = null,
    val observations: List<PresenceObservation> = emptyList(),
    val decision: String? = null,
    val reason: String? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "phase" to phase.wireValue,
        "purpose" to purpose?.wireValue,
        "owner" to owner.wireValue,
        "startedAt" to startedAtMs,
        "deadlineAt" to deadlineAtMs,
        "observations" to observations.map { it.toMap() },
        "decision" to decision,
        "reason" to reason,
    )
}

/**
 * The radio, as the Presence Scan needs it. Everything platform-specific lives behind this seam so
 * the scan's ordering, deadline, and decisions are unit-testable without Bluetooth.
 */
internal interface PresenceScanPort {
    fun bluetoothEnabled(): Boolean

    fun scanPermissionGranted(): Boolean

    fun scannerAvailable(): Boolean

    /**
     * Begin scanning. [onReady] fires when the radio is actually usable — the five-second deadline
     * starts there, not at foreground entry. Returns false when the scan could not be started.
     */
    fun startScan(
        onReady: () -> Unit,
        onObserved: (bleId: String, rssi: Int?) -> Unit,
        onFailed: (message: String) -> Unit,
    ): Boolean

    fun stopScan()
}

/**
 * Board Presence Scan (ADR 0035). One scan per foreground entry: it watches the saved BLE ids of
 * every linked Board for five seconds after the radio becomes usable, promotes the selected Board
 * into a Board Session when policy allows, and reports every non-selected Board it saw without ever
 * connecting it (#408 turns those into switch-and-connect hints).
 *
 * Stale BLE callbacks are rejected by the [ScannerCoordinator] operation token rather than by
 * guessing from surrounding state.
 *
 * @parity /modules/vescape-core/ios/connection/BoardPresenceScan.swift
 */
internal class BoardPresenceScan(
    private val port: PresenceScanPort,
    private val scanner: ScannerCoordinator,
    private val ownership: ConnectionOwnership,
    private val scheduler: Scheduler,
    private val nowMs: () -> Long,
    private val windowMs: Long = PRESENCE_SCAN_WINDOW_MS,
    private val onStateChanged: (PresenceScanState) -> Unit = {},
    private val onPromote: (PresenceTarget, ConnectionWorkflow?) -> Unit = { _, _ -> },
) {
    var state: PresenceScanState = PresenceScanState()
        private set

    private var operation: ScanOperation? = null
    private var deadlineHandle: Cancellable? = null
    private var targets: List<PresenceTarget> = emptyList()
    private var workflow: ConnectionWorkflow? = null
    private var promotionInput: (() -> PresencePromotionInput)? = null

    val isRunning: Boolean get() = operation != null

    /**
     * Run one Presence Scan. [promotionInput] is read at match time rather than now, so a setting or
     * Automatic Connection Pause that changes mid-scan still decides the outcome.
     */
    fun start(
        environment: PresenceScanEnvironment,
        targets: List<PresenceTarget>,
        workflow: ConnectionWorkflow? = null,
        promotionInput: () -> PresencePromotionInput,
    ): PresenceScanDecision {
        if (isRunning) return finishNow(workflow, ConnectionTraceReason.SCANNER_BUSY, ConnectionTraceDecision.SKIPPED)

        val eligibility = PresenceScanPolicy.evaluate(environment)
        if (!eligibility.proceed) {
            return refuse(workflow, eligibility)
        }

        val acquisition = scanner.acquire(ScanPurpose.Presence)
        if (acquisition is ScanAcquisition.Denied) {
            return refuse(
                workflow,
                PresenceScanDecision(false, ConnectionTraceDecision.SKIPPED, acquisition.reason),
            )
        }
        val granted = (acquisition as ScanAcquisition.Granted).operation

        val ownershipDecision = ownership.request(ConnectionOwner.AutoConnect)
        if (!ownershipDecision.granted) {
            scanner.release(granted)
            workflow?.event(
                ConnectionTraceEvent.OWNER_DENIED,
                mapOf(
                    ConnectionTraceField.OWNER_REQUESTED to ConnectionOwner.AutoConnect.wireValue,
                    ConnectionTraceField.OWNER_PREVIOUS to ownershipDecision.previousOwner.wireValue,
                ),
            )
            return refuse(
                workflow,
                PresenceScanDecision(false, ConnectionTraceDecision.DENIED, ownershipDecision.reason),
            )
        }
        workflow?.handoff(ConnectionOwner.AutoConnect.wireValue)
        workflow?.event(
            ConnectionTraceEvent.OWNER_GRANTED,
            mapOf(ConnectionTraceField.OWNER_PREVIOUS to ownershipDecision.previousOwner.wireValue),
        )

        this.operation = granted
        this.targets = targets
        this.workflow = workflow
        this.promotionInput = promotionInput
        publish(
            PresenceScanState(
                phase = PresenceScanPhase.WaitingForBluetooth,
                purpose = ScanPurpose.Presence,
                owner = ConnectionOwner.AutoConnect,
                startedAtMs = nowMs(),
            )
        )
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_STARTED,
            mapOf(
                ConnectionTraceField.SCAN_PURPOSE to ScanPurpose.Presence.wireValue,
                ConnectionTraceField.DEADLINE_MS to windowMs,
                ConnectionTraceField.BOARD_ID to environment.selectedBoardId,
            ),
        )

        val started = port.startScan(
            onReady = { guarded(granted) { onReady() } },
            onObserved = { bleId, rssi -> guarded(granted) { onObserved(bleId, rssi) } },
            onFailed = { message -> guarded(granted) { onFailed(message) } },
        )
        if (!started) {
            fail(ConnectionTraceReason.SCANNER_UNAVAILABLE, "scan start refused")
            return PresenceScanDecision(false, ConnectionTraceDecision.FAILED, ConnectionTraceReason.SCANNER_UNAVAILABLE)
        }
        return PresenceScanDecision(true, ConnectionTraceDecision.GRANTED, null)
    }

    /** Radio usable: the five-second window starts here, never at foreground entry. */
    private fun onReady() {
        val readyAt = nowMs()
        val deadlineAt = PresenceScanPolicy.deadlineAt(readyAt, windowMs)
        publish(state.copy(phase = PresenceScanPhase.Scanning, deadlineAtMs = deadlineAt))
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_READY,
            mapOf(
                ConnectionTraceField.DEADLINE_AT to deadlineAt,
                ConnectionTraceField.DEADLINE_MS to windowMs,
            ),
        )
        deadlineHandle?.cancel()
        deadlineHandle = scheduler.postDelayed(windowMs) { onDeadline() }
    }

    private fun onObserved(bleId: String, rssi: Int?) {
        val target = targets.firstOrNull { it.bleId.equals(bleId, ignoreCase = true) } ?: return
        val observation = PresenceObservation(
            boardId = target.boardId,
            bleId = target.bleId,
            name = target.name,
            rssi = rssi,
            observedAtMs = nowMs(),
            selected = target.selected,
        )
        // Deduplicate by saved Board id. A repeated advertisement refreshes the existing observation
        // in place — that is what makes expiry "thirty seconds after the *last* advertisement" — and
        // never queues a second hint for the same Board.
        val upsert = AlternativeHints.upsert(state.observations, observation)
        publish(state.copy(observations = upsert.observations))
        if (!upsert.isNew) return
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_OBSERVED,
            mapOf(
                ConnectionTraceField.BOARD_ID to observation.boardId,
                ConnectionTraceField.BLE_ID to observation.bleId,
                ConnectionTraceField.RSSI to observation.rssi,
                ConnectionTraceField.OBSERVATION_COUNT to state.observations.size,
            ),
        )
        // A non-selected Board is reported, never connected. The scan keeps running so its own
        // Board can still turn up before the deadline.
        if (target.selected) {
            resolveMatch(target)
        } else {
            workflow?.event(
                ConnectionTraceEvent.ALTERNATIVE_HINT_OFFERED,
                mapOf(
                    ConnectionTraceField.BOARD_ID to observation.boardId,
                    ConnectionTraceField.BLE_ID to observation.bleId,
                    ConnectionTraceField.BOARD_NICKNAME to observation.name,
                    ConnectionTraceField.RSSI to observation.rssi,
                ),
            )
        }
    }

    private fun resolveMatch(target: PresenceTarget) {
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_MATCHED,
            mapOf(
                ConnectionTraceField.BOARD_ID to target.boardId,
                ConnectionTraceField.BLE_ID to target.bleId,
            ),
        )
        val input = promotionInput?.invoke() ?: return
        val promotion = PresenceScanPolicy.promotion(input.copy(selectedObserved = true))
        stopScanning()
        publish(
            state.copy(
                phase = PresenceScanPhase.Done,
                decision = promotion.decision,
                reason = promotion.reason,
            )
        )
        if (promotion.proceed) {
            workflow?.event(
                ConnectionTraceEvent.AUTO_CONNECT_PROMOTED,
                mapOf(ConnectionTraceField.BOARD_ID to target.boardId),
            )
            // Hand ownership straight to the Board Session; the session's teardown releases it.
            ownership.release(ConnectionOwner.AutoConnect)
            ownership.request(ConnectionOwner.BoardSession)
            workflow?.handoff(ConnectionOwner.BoardSession.wireValue)
            // The workflow deliberately stays open across the handoff: the Board Session is still
            // being built off-thread, and its own terminal branch (started, refused, or failed to
            // build) is what actually ends this foreground-entry workflow (#414).
            onPromote(target, workflow)
        } else {
            workflow?.event(
                ConnectionTraceEvent.AUTO_CONNECT_SKIPPED,
                mapOf(
                    ConnectionTraceField.BOARD_ID to target.boardId,
                    ConnectionTraceField.REASON to promotion.reason,
                ),
            )
            releaseOwnership()
            workflow?.finish(promotion.decision, promotion.reason ?: ConnectionTraceReason.BOARD_NOT_PRESENT)
        }
        workflow = null
    }

    private fun onDeadline() {
        stopScanning()
        publish(
            state.copy(
                phase = PresenceScanPhase.Done,
                decision = ConnectionTraceDecision.TIMEOUT,
                reason = ConnectionTraceReason.BOARD_NOT_PRESENT,
            )
        )
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_TIMEOUT,
            mapOf(ConnectionTraceField.OBSERVATION_COUNT to state.observations.size),
        )
        releaseOwnership()
        workflow?.finish(ConnectionTraceDecision.TIMEOUT, ConnectionTraceReason.DEADLINE_EXPIRED)
        workflow = null
    }

    private fun onFailed(message: String) = fail(ConnectionTraceReason.PLATFORM_ERROR, message)

    /** Give the scanner up for an exclusive owner, an explicit Connect, or app teardown. */
    fun cancel(reason: String = ConnectionTraceReason.USER_CANCELLED) {
        if (!isRunning) return
        stopScanning()
        publish(
            state.copy(
                phase = PresenceScanPhase.Done,
                decision = ConnectionTraceDecision.CANCELLED,
                reason = reason,
            )
        )
        workflow?.event(ConnectionTraceEvent.PRESENCE_SCAN_CANCELLED, mapOf(ConnectionTraceField.REASON to reason))
        releaseOwnership()
        workflow?.finish(ConnectionTraceDecision.CANCELLED, reason)
        workflow = null
    }

    private fun fail(reason: String, message: String) {
        stopScanning()
        publish(
            state.copy(
                phase = PresenceScanPhase.Done,
                decision = ConnectionTraceDecision.FAILED,
                reason = reason,
            )
        )
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_FAILED,
            mapOf(ConnectionTraceField.REASON to reason, "message" to message),
        )
        releaseOwnership()
        workflow?.finish(ConnectionTraceDecision.FAILED, reason)
        workflow = null
    }

    private fun refuse(workflow: ConnectionWorkflow?, decision: PresenceScanDecision): PresenceScanDecision {
        publish(
            PresenceScanState(
                phase = PresenceScanPhase.Idle,
                purpose = ScanPurpose.Presence,
                decision = decision.decision,
                reason = decision.reason,
            )
        )
        workflow?.event(
            ConnectionTraceEvent.PRESENCE_SCAN_SKIPPED,
            mapOf(ConnectionTraceField.REASON to decision.reason),
        )
        workflow?.finish(decision.decision, decision.reason ?: ConnectionTraceReason.PLATFORM_ERROR)
        return decision
    }

    private fun finishNow(
        workflow: ConnectionWorkflow?,
        reason: String,
        decision: String,
    ): PresenceScanDecision = refuse(workflow, PresenceScanDecision(false, decision, reason))

    /** Run [block] only while [expected] still owns the scanner. Late BLE callbacks die here. */
    private fun guarded(expected: ScanOperation, block: () -> Unit) {
        scheduler.post {
            if (!scanner.isCurrent(expected) || operation?.token != expected.token) return@post
            block()
        }
    }

    private fun stopScanning() {
        deadlineHandle?.cancel()
        deadlineHandle = null
        port.stopScan()
        scanner.release(operation)
        operation = null
        promotionInput = null
    }

    private fun releaseOwnership() {
        if (ownership.release(ConnectionOwner.AutoConnect)) {
            workflow?.event(
                ConnectionTraceEvent.OWNER_RELEASED,
                mapOf(ConnectionTraceField.OWNER_PREVIOUS to ConnectionOwner.AutoConnect.wireValue),
            )
        }
    }

    private fun publish(next: PresenceScanState) {
        state = next
        onStateChanged(next)
    }
}
