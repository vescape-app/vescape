import type { ProfileStatsMonth } from 'vescape-core'
import { DASH } from '@/helpers/format'

export type ProfileMonth = ProfileStatsMonth

function sameMonth(a: ProfileMonth, b: ProfileMonth): boolean {
  return a.year === b.year && a.month === b.month
}

function currentProfileMonth(date = new Date()): ProfileMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

export function formatMonthLabel(month: ProfileMonth, locale?: string): string {
  return new Date(month.year, month.month - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })
}

export function getAdjacentMonths(
  months: ProfileMonth[],
  selected: ProfileMonth,
): {
  previous: ProfileMonth | null
  next: ProfileMonth | null
} {
  const index = months.findIndex((month) => sameMonth(month, selected))
  return {
    previous: index >= 0 ? (months[index + 1] ?? null) : null,
    next: index > 0 ? months[index - 1] : null,
  }
}

export function selectInitialMonth(months: ProfileMonth[], now = new Date()): ProfileMonth {
  const current = currentProfileMonth(now)
  return months.find((month) => sameMonth(month, current)) ?? months[0] ?? current
}

export function formatDistance(valueM: number | null): string {
  if (valueM == null) return DASH
  if (valueM < 1000) return `${Math.round(valueM)} m`
  return `${(valueM / 1000).toFixed(1)} km`
}

export function formatDuration(valueMs: number): string {
  const totalMinutes = Math.round(valueMs / 60_000)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

export function formatSpeed(valueKmh: number): string {
  return `${Math.round(valueKmh)} km/h`
}

export function formatEnergy(valueWh: number | null): string {
  if (valueWh == null) return DASH
  if (valueWh < 1000) return `${Math.round(valueWh)} Wh`
  return `${(valueWh / 1000).toFixed(1)} kWh`
}
