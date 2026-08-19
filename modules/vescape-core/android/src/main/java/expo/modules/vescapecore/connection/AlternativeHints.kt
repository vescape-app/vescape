package expo.modules.vescapecore.connection

import android.content.Context
import expo.modules.vescapecore.diagnostics.ConnectionTrace
import expo.modules.vescapecore.diagnostics.ConnectionTraceDecision
import expo.modules.vescapecore.diagnostics.ConnectionTraceEvent
import expo.modules.vescapecore.diagnostics.ConnectionTraceField
import expo.modules.vescapecore.diagnostics.ConnectionTraceOrigin
import expo.modules.vescapecore.diagnostics.ConnectionTraceOwner
import expo.modules.vescapecore.diagnostics.ConnectionTraceReason

/**
 * How long a Presence Scan observation stays worth offering, measured from the **last**
 * advertisement that refreshed it (ADR 0035, #408). Expiry is a clock comparison on read, exactly
 * like the Automatic Connection Pause, so no cleanup job exists.
 *
 * @parity /modules/vescape-core/ios/connection/AlternativeHints.swift `alternativeHintTtlMs`
 * @parity /src/modules/board/lib/alternativeHints.ts `ALTERNATIVE_HINT_TTL_MS`
 */
const val ALTERNATIVE_HINT_TTL_MS = 30_000L

/**
 * Advisory switch-and-connect hints, derived from Presence Scan observations of **non-selected**
 * linked Boards (ADR 0035, #408).
 *
 * Nothing here connects anything. The Presence Scan reports a non-selected Board from its
 * advertisement alone; these rules only decide how those reports are deduplicated and when they stop
 * existing. Which one is *offered* is JS presentation — dismissal is a local acknowledgement, so the
 * queue itself never becomes native truth.
 *
 * @parity /modules/vescape-core/ios/connection/AlternativeHints.swift
 * @parity /src/modules/board/lib/alternativeHints.ts
 */
object AlternativeHints {
    /** An observation dies [ALTERNATIVE_HINT_TTL_MS] after the advertisement that last refreshed it. */
    fun isExpired(observation: PresenceObservation, nowMs: Long): Boolean =
        nowMs - observation.observedAtMs >= ALTERNATIVE_HINT_TTL_MS

    /**
     * Record one advertisement. Deduplicates by saved Board id: a repeated advertisement refreshes
     * the existing observation's timestamp and RSSI **in place**, so discovery order survives and no
     * second hint is ever queued for the same Board.
     */
    fun upsert(
        observations: List<PresenceObservation>,
        observation: PresenceObservation,
    ): AlternativeHintUpsert {
        val index = observations.indexOfFirst { it.boardId == observation.boardId }
        if (index < 0) return AlternativeHintUpsert(observations + observation, isNew = true)
        val next = observations.toMutableList()
        next[index] = next[index].copy(
            bleId = observation.bleId,
            name = observation.name,
            rssi = observation.rssi,
            observedAtMs = observation.observedAtMs,
            selected = observation.selected,
        )
        return AlternativeHintUpsert(next, isNew = false)
    }

    /** Drop observations whose last advertisement aged out. Order of the survivors is untouched. */
    fun prune(observations: List<PresenceObservation>, nowMs: Long): List<PresenceObservation> =
        observations.filterNot { isExpired(it, nowMs) }

    /** [prune] applied to a whole published snapshot, so JS never renders an aged-out observation. */
    fun prune(state: PresenceScanState, nowMs: Long): PresenceScanState {
        val kept = prune(state.observations, nowMs)
        return if (kept.size == state.observations.size) state else state.copy(observations = kept)
    }
}

/** [AlternativeHints.upsert] result: the new list, plus whether this Board was seen for the first time. */
data class AlternativeHintUpsert(
    val observations: List<PresenceObservation>,
    val isNew: Boolean,
)

/**
 * Dismissing a switch hint is a local acknowledgement and **nothing else**: it reveals the next
 * queued Board, arms no Automatic Connection Pause, and changes no selection or ownership. It is
 * traced only so the Event Log shows why an offered hint went away (ADR 0035, #408).
 *
 * It needs no Board Session, so it deliberately does not live on the session controller.
 *
 * @parity /modules/vescape-core/ios/connection/AlternativeHints.swift `AlternativeHintTrace`
 */
object AlternativeHintTrace {
    fun dismissed(appCtx: Context, boardId: String) {
        if (boardId.isBlank()) return
        val workflow = ConnectionTrace.start(
            appCtx,
            ConnectionTraceOrigin.ALTERNATIVE_HINT_SWITCH,
            ConnectionTraceOwner.ALTERNATIVE_HINT,
            mapOf(ConnectionTraceField.BOARD_ID to boardId),
        )
        workflow.event(
            ConnectionTraceEvent.ALTERNATIVE_HINT_DISMISSED,
            mapOf(ConnectionTraceField.BOARD_ID to boardId),
        )
        workflow.finish(ConnectionTraceDecision.COMPLETED, ConnectionTraceReason.USER_CANCELLED)
    }
}
