import type { Favorite, RideExportOptions, RideHistoryFilter, RideSelection } from 'vescape-core'

import { rideExportOptions } from '@/modules/history/lib/rideExport'
import type { HistorySession } from '@/modules/history/lib/sessions'

/**
 * Rides ticked in select mode: a set of ids, or every ride matching the filter minus the ones
 * unticked since "Select all". History is paged, so "all" can name rides not loaded yet.
 */
export type RideSelect =
  { all: false; ids: ReadonlySet<string> } | { all: true; excluded: ReadonlySet<string> }

export const EMPTY_RIDE_SELECT: RideSelect = { all: false, ids: new Set() }

export function isRideSelected(select: RideSelect, id: string): boolean {
  return select.all ? !select.excluded.has(id) : select.ids.has(id)
}

/** Ticks every ride in `ids` unless all of them already are, then unticks them (day headers). */
export function toggleRides(select: RideSelect, ids: readonly string[]): RideSelect {
  const tick = !ids.every((id) => isRideSelected(select, id))
  const next = new Set(select.all ? select.excluded : select.ids)
  // "All" tracks the unticked rides, so ticking removes from the set and unticking adds.
  for (const id of ids) {
    if (tick !== select.all) next.add(id)
    else next.delete(id)
  }
  return select.all ? { all: true, excluded: next } : { all: false, ids: next }
}

export type RideDayState = 'all' | 'some' | 'none'

export function rideDayState(select: RideSelect, ids: readonly string[]): RideDayState {
  const ticked = ids.filter((id) => isRideSelected(select, id)).length
  return ticked === 0 ? 'none' : ticked === ids.length ? 'all' : 'some'
}

/** `total` is every ride the filter matches; only used once "Select all" is on. */
export function selectedRideCount(select: RideSelect, total: number): number {
  return select.all ? Math.max(0, total - select.excluded.size) : select.ids.size
}

/**
 * What native exports or deletes. History "all" stays a filter so native resolves unloaded rides;
 * Favorites are all loaded, so they always name their saved windows.
 */
export function toRideSelection(
  select: RideSelect,
  sessions: readonly HistorySession[],
  favoritesBySessionId: ReadonlyMap<string, Favorite> | null,
  filter: RideHistoryFilter,
): RideSelection {
  if (select.all && !favoritesBySessionId) {
    return { filter, excludeIds: [...select.excluded] }
  }
  const rides: RideExportOptions[] = sessions
    .filter((session) => isRideSelected(select, session.id))
    .map((session) => rideExportOptions(session, favoritesBySessionId?.get(session.id) ?? null))
  return { rides }
}
