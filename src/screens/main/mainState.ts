import type { HistorySession } from '@/modules/history/store/historyStore'

export function getLatestSession(sessions: HistorySession[]): HistorySession | null {
  return sessions[0] ?? null
}

export function getPreviousRideSession(
  sessions: HistorySession[],
  selected: HistorySession | null,
): HistorySession | null {
  if (!selected) return null
  const index = findSessionIndex(sessions, selected)
  if (index < 0) return null
  return sessions[index + 1] ?? null
}

export function getNextRideSession(
  sessions: HistorySession[],
  selected: HistorySession | null,
): HistorySession | null {
  if (!selected) return null
  const index = findSessionIndex(sessions, selected)
  if (index <= 0) return null
  return sessions[index - 1] ?? null
}

export function findSessionIndex(sessions: HistorySession[], selected: HistorySession): number {
  const exact = sessions.findIndex((session) => session.id === selected.id)
  if (exact >= 0) return exact

  return sessions.findIndex(
    (session) =>
      session.boardId === selected.boardId &&
      session.startAtMs <= selected.endAtMs &&
      session.endAtMs >= selected.startAtMs,
  )
}
