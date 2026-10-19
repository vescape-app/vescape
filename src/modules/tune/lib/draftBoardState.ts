import type { TuneProfileFieldValue } from 'vescape-core'

/** Equality requires current confirmed knowledge of every draft field. */
export function draftBoardState(
  draft: Record<string, TuneProfileFieldValue>,
  board: Record<string, TuneProfileFieldValue>,
  confirmed: boolean,
  encodingScales: Record<string, number | null | undefined> = {},
): 'match' | 'different' | 'unknown' {
  const entries = Object.entries(draft)
  if (!confirmed || entries.length === 0 || entries.some(([id]) => board[id] == null))
    return 'unknown'
  return entries.every(([id, value]) => {
    const other = board[id]
    if (typeof value === 'number' && typeof other === 'number')
      return (
        Number.isFinite(value) &&
        Number.isFinite(other) &&
        (encodingScales[id] && encodingScales[id]! > 0
          ? Math.floor(value * encodingScales[id]! + 0.5) ===
            Math.floor(other * encodingScales[id]! + 0.5)
          : Math.fround(value) === Math.fround(other))
      )
    return value === other
  })
    ? 'match'
    : 'different'
}

export function tuneBoardActions(input: {
  connected: boolean
  trusted: boolean
  snapshotReady: boolean
  schemaMismatch: boolean
  compatibilityIssue: boolean
  busy: boolean
  error: boolean
}) {
  const canRead = input.connected && input.trusted && !input.compatibilityIssue
  const canSend = canRead && input.snapshotReady && !input.schemaMismatch
  return { canRead, canSend, confirmed: canSend && !input.busy && !input.error }
}
