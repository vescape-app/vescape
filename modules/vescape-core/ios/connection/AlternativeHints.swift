import Foundation

/// How long a Presence Scan observation stays worth offering, measured from the **last**
/// advertisement that refreshed it (ADR 0035, #408). Expiry is a clock comparison on read, exactly
/// like the Automatic Connection Pause, so no cleanup job exists.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/AlternativeHints.kt `ALTERNATIVE_HINT_TTL_MS`
/// @parity /src/modules/board/lib/alternativeHints.ts `ALTERNATIVE_HINT_TTL_MS`
internal let alternativeHintTtlMs: Int64 = 30_000

/// `AlternativeHints.upsert` result: the new list, plus whether this Board was seen for the first time.
internal struct AlternativeHintUpsert {
  let observations: [PresenceObservation]
  let isNew: Bool
}

/// Advisory switch-and-connect hints, derived from Presence Scan observations of **non-selected**
/// linked Boards (ADR 0035, #408).
///
/// Nothing here connects anything. The Presence Scan reports a non-selected Board from its
/// advertisement alone; these rules only decide how those reports are deduplicated and when they stop
/// existing. Which one is *offered* is JS presentation — dismissal is a local acknowledgement, so the
/// queue itself never becomes native truth.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/AlternativeHints.kt
/// @parity /src/modules/board/lib/alternativeHints.ts
internal enum AlternativeHints {
  /// An observation dies `alternativeHintTtlMs` after the advertisement that last refreshed it.
  static func isExpired(_ observation: PresenceObservation, nowMs: Int64) -> Bool {
    nowMs - observation.observedAtMs >= alternativeHintTtlMs
  }

  /// Record one advertisement. Deduplicates by saved Board id: a repeated advertisement refreshes
  /// the existing observation's timestamp and RSSI **in place**, so discovery order survives and no
  /// second hint is ever queued for the same Board.
  static func upsert(
    _ observations: [PresenceObservation],
    _ observation: PresenceObservation
  ) -> AlternativeHintUpsert {
    guard let index = observations.firstIndex(where: { $0.boardId == observation.boardId }) else {
      return AlternativeHintUpsert(observations: observations + [observation], isNew: true)
    }
    var next = observations
    next[index] = observation
    return AlternativeHintUpsert(observations: next, isNew: false)
  }

  /// Drop observations whose last advertisement aged out. Order of the survivors is untouched.
  static func prune(_ observations: [PresenceObservation], nowMs: Int64) -> [PresenceObservation] {
    observations.filter { !isExpired($0, nowMs: nowMs) }
  }

  /// `prune` applied to a whole published snapshot, so JS never renders an aged-out observation.
  static func prune(_ state: PresenceScanState, nowMs: Int64) -> PresenceScanState {
    let kept = prune(state.observations, nowMs: nowMs)
    guard kept.count != state.observations.count else { return state }
    var next = state
    next.observations = kept
    return next
  }
}

/// Dismissing a switch hint is a local acknowledgement and **nothing else**: it reveals the next
/// queued Board, arms no Automatic Connection Pause, and changes no selection or ownership. It is
/// traced only so the Event Log shows why an offered hint went away (ADR 0035, #408).
///
/// It needs no Board Session, so it deliberately does not live on the session controller.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/AlternativeHints.kt `AlternativeHintTrace`
internal enum AlternativeHintTrace {
  static func dismissed(boardId: String) {
    guard !boardId.isEmpty else { return }
    let workflow = ConnectionTrace.start(
      origin: ConnectionTraceOrigin.alternativeHintSwitch,
      owner: ConnectionTraceOwner.alternativeHint,
      fields: [ConnectionTraceField.boardId: boardId]
    )
    workflow.event(
      ConnectionTraceEvent.alternativeHintDismissed,
      fields: [ConnectionTraceField.boardId: boardId]
    )
    workflow.finish(decision: ConnectionTraceDecision.completed, reason: ConnectionTraceReason.userCancelled)
  }
}
