import type { BoardConfigChangeDiff, BoardConfigRevision } from 'vescape-core'

export const TUNING_SESSION_GAP_MS = 10 * 60 * 1000

const NUMBER_TOLERANCE = 1e-6

export interface BoardConfigRevisionEntry {
  kind: 'revision'
  id: string
  revision: BoardConfigRevision
}

export interface BoardConfigTuningSessionEntry {
  kind: 'session'
  id: string
  boardId: string
  revisions: BoardConfigRevision[]
  startedAtMs: number
  endedAtMs: number
  preSessionRevisionId: number | null
  netChanges: BoardConfigChangeDiff[]
}

export type BoardConfigHistoryEntry = BoardConfigRevisionEntry | BoardConfigTuningSessionEntry

function valuesEqual(a: number | boolean | null, b: number | boolean | null): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= NUMBER_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return false
}

function summarizeSessionChanges(
  revisions: readonly BoardConfigRevision[],
): BoardConfigChangeDiff[] {
  const byField = new Map<string, BoardConfigChangeDiff>()
  for (let i = revisions.length - 1; i >= 0; i -= 1) {
    const rev = revisions[i]!
    for (const diff of rev.changes) {
      const existing = byField.get(diff.fieldId)
      if (!existing) {
        byField.set(diff.fieldId, { ...diff })
      } else {
        byField.set(diff.fieldId, {
          fieldId: diff.fieldId,
          label: diff.label,
          unit: diff.unit,
          oldValue: existing.oldValue,
          newValue: diff.newValue,
        })
      }
    }
  }
  return Array.from(byField.values()).filter((diff) => !valuesEqual(diff.oldValue, diff.newValue))
}

function isGroupableAppRevision(revision: BoardConfigRevision): boolean {
  return revision.source === 'app' && revision.changes.length > 0
}

export function groupBoardConfigRevisions(
  revisions: readonly BoardConfigRevision[],
  gapMs: number = TUNING_SESSION_GAP_MS,
): BoardConfigHistoryEntry[] {
  const entries: BoardConfigHistoryEntry[] = []
  let index = 0

  while (index < revisions.length) {
    const head = revisions[index]!
    if (!isGroupableAppRevision(head)) {
      entries.push({ kind: 'revision', id: `rev-${head.id}`, revision: head })
      index += 1
      continue
    }

    let end = index + 1
    while (end < revisions.length) {
      const prev = revisions[end - 1]!
      const next = revisions[end]!
      if (!isGroupableAppRevision(next) || next.boardId !== head.boardId) break
      const gap = prev.createdAtMs - next.createdAtMs
      if (gap < 0 || gap > gapMs) break
      end += 1
    }

    if (end - index >= 2) {
      const sessionRevisions = revisions.slice(index, end)
      const olderNeighbor = end < revisions.length ? revisions[end]! : null
      const preSessionRevisionId =
        olderNeighbor && olderNeighbor.boardId === head.boardId ? olderNeighbor.id : null
      const oldest = sessionRevisions[sessionRevisions.length - 1]!
      entries.push({
        kind: 'session',
        id: `session-${head.id}-${oldest.id}`,
        boardId: head.boardId,
        revisions: sessionRevisions,
        startedAtMs: oldest.createdAtMs,
        endedAtMs: head.createdAtMs,
        preSessionRevisionId,
        netChanges: summarizeSessionChanges(sessionRevisions),
      })
      index = end
    } else {
      entries.push({ kind: 'revision', id: `rev-${head.id}`, revision: head })
      index += 1
    }
  }

  return entries
}
