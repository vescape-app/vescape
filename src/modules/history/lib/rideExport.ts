import type { Favorite, RideExportOptions, RideHistorySession } from 'vescape-core'

/** Capture the selected durable range before the menu dismisses; never use chart state. */
export function rideExportOptions(
  session: Pick<
    RideHistorySession,
    'boardId' | 'recordingId' | 'startAtMs' | 'endAtMs' | 'boardName'
  >,
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
        recordingId: session.recordingId ?? undefined,
        name: session.boardName,
      }
}
