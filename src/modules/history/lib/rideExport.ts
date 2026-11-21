import type { Favorite, RideExportOptions, RideHistorySession } from 'vescape-core'

export function rideExportOptions(
  session: Pick<RideHistorySession, 'boardId' | 'startAtMs' | 'endAtMs' | 'boardName'>,
  favorite: Pick<Favorite, 'boardId' | 'startMs' | 'endMs' | 'name'> | null,
): RideExportOptions {
  return favorite
    ? {
        fromMs: favorite.startMs,
        toMs: favorite.endMs,
        boardId: favorite.boardId ?? undefined,
        name: favorite.name ?? 'Vescape Favorite',
      }
    : {
        fromMs: session.startAtMs,
        toMs: session.endAtMs,
        boardId: session.boardId ?? undefined,
        name: session.boardName,
      }
}
