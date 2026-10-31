import type { Href } from 'expo-router'

import { routes } from '@/navigation/routes'

/**
 * App links: typed hrefs into a screen's state, so any screen (or, later, a URL) can point at one
 * without reaching into that screen's stores. Each link has one builder and one parser here; the
 * target screen reads its params, opens the thing, then clears them.
 */

/** A moment a linked ride opens on, instead of its start. */
export type RideFocus = 'topSpeed'

const RIDE_FOCUSES: readonly RideFocus[] = ['topSpeed']

export interface RideLink {
  /** `RideHistorySession.id`. */
  rideId: string
  focus: RideFocus | null
}

/** Route search params as `useLocalSearchParams` returns them. */
type SearchParams = Partial<Record<string, string | string[]>>

/** Home with one ride open in History. */
export function rideHref({ rideId, focus }: RideLink): Href {
  return {
    pathname: routes.home,
    params: focus ? { ride: rideId, focus } : { ride: rideId },
  }
}

/** The ride link in the home route's params, or null. An unknown focus opens the ride plainly. */
export function parseRideLink(params: SearchParams): RideLink | null {
  const rideId = single(params.ride)
  if (!rideId) return null
  const focus = single(params.focus)
  return {
    rideId,
    focus: RIDE_FOCUSES.find((known) => known === focus) ?? null,
  }
}

/** Params that clear a consumed {@link RideLink}, so going back to home does not reopen it. */
export const CLEARED_RIDE_LINK_PARAMS = { ride: undefined, focus: undefined }

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
