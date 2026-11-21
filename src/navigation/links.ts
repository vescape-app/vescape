import type { Href } from 'expo-router'
import type { RideDay } from 'vescape-core'

import { calendarDayKey } from '@/helpers/calendarDay'
import { RIDE_FOCUSES, type RideFocus } from '@/modules/history/lib/chartFocus'
import { routes } from '@/navigation/routes'

export interface RideLink {
  rideId: string
  focus: RideFocus | null
}

type SearchParams = Partial<Record<string, string | string[]>>

export function rideHref({ rideId, focus }: RideLink): Href {
  return {
    pathname: routes.home,
    params: focus ? { ride: rideId, focus } : { ride: rideId },
  }
}

export function parseRideLink(params: SearchParams): RideLink | null {
  const rideId = single(params.ride)
  if (!rideId) return null
  const focus = single(params.focus)
  return {
    rideId,
    focus: RIDE_FOCUSES.find((known) => known === focus) ?? null,
  }
}

export const CLEARED_RIDE_LINK_PARAMS = { ride: undefined, focus: undefined }

export function riderProfileHref(accountId: string): Href {
  return { pathname: routes.riderProfile, params: { accountId } }
}

export function rideDayHref(day: RideDay): Href {
  return { pathname: routes.rideDay, params: { date: calendarDayKey(day) } }
}

export function parseRideDay(params: SearchParams): RideDay | null {
  const [year, month, day] = (single(params.date) ?? '').split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  return { year, month, day }
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
