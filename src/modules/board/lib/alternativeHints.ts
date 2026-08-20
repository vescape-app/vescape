import type { PresenceObservation } from 'vescape-core'

/**
 * How long a Presence Scan observation stays worth offering, measured from the **last**
 * advertisement that refreshed it (ADR 0035, #408). Native prunes on every snapshot; JS re-checks on
 * a ticking clock because a snapshot only arrives when native state changes.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/AlternativeHints.kt `ALTERNATIVE_HINT_TTL_MS`
 * @parity /modules/vescape-core/ios/connection/AlternativeHints.swift `alternativeHintTtlMs`
 */
export const ALTERNATIVE_HINT_TTL_MS = 30_000

export interface AlternativeHintInput {
  observations: PresenceObservation[]
  selectedBoardId: string | null
  /** Board id of the live Board Session, or `null`. A connection outranks every hint. */
  connectedBoardId: string | null
  /** Board ids the rider has already waved away this session. Dismissal is local, never a pause. */
  dismissedBoardIds: readonly string[]
  now: number
}

const isExpired = (observation: PresenceObservation, now: number): boolean =>
  now - observation.observedAt >= ALTERNATIVE_HINT_TTL_MS

/**
 * The Boards still worth offering a switch to, in discovery order.
 *
 * Native already deduplicates by saved Board id and prunes expired observations, so repeated
 * advertisements arrive as one refreshed entry. Which of the survivors is *offered* is presentation
 * — dismissal is a local acknowledgement — so this rule is deliberately JS-only and carries no
 * `@parity` peer.
 */
export function alternativeHints({
  observations,
  selectedBoardId,
  connectedBoardId,
  dismissedBoardIds,
  now,
}: AlternativeHintInput): PresenceObservation[] {
  // A Board Session is the highest connection owner and `alternative_hint` the lowest, so any
  // connection clears the queue rather than competing with it.
  if (connectedBoardId) return []
  return observations.filter(
    (o) =>
      !o.selected &&
      o.boardId !== selectedBoardId &&
      !dismissedBoardIds.includes(o.boardId) &&
      !isExpired(o, now),
  )
}

/** One hint at a time: the oldest queued Board the rider has not yet answered. */
export function nextAlternativeHint(input: AlternativeHintInput): PresenceObservation | null {
  return alternativeHints(input)[0] ?? null
}
