import { useCallback } from 'react'
import { DASH } from '@/helpers/format'
import { rideDistanceFromMeters, rideDistanceUnit } from '@/helpers/units'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  buildHistoryMarkerMessage,
  type SelectedHistoryMarker,
} from '@/modules/history/lib/historyMapMarkerInfo'
import {
  formatRideDate,
  formatRideListDetails,
  formatRideMeta,
  formatRideTime,
} from '@/modules/history/lib/rideFormat'

interface HistoryDistance {
  value: string
  unit?: string
}

export function useRideFormat() {
  const { distanceUnit, timeFormat, dateFormat } = useUserPreferences()
  const formatTime = useCallback(
    (startMs: number, endMs: number, live = false) =>
      formatRideTime(startMs, endMs, live, timeFormat),
    [timeFormat],
  )
  const formatDate = useCallback(
    (startMs: number, endMs: number) => formatRideDate(startMs, endMs, dateFormat),
    [dateFormat],
  )
  const formatMeta = useCallback(
    (startAtMs: number, endAtMs: number, boardName: string) =>
      formatRideMeta(startAtMs, endAtMs, boardName, dateFormat),
    [dateFormat],
  )
  const formatRideDetails = useCallback(
    (durationMs: number, distanceM: number | null) =>
      formatRideListDetails(durationMs, distanceM, distanceUnit),
    [distanceUnit],
  )
  const formatHistoryDistance = useCallback(
    (meters: number | null): HistoryDistance => {
      if (meters == null) return { value: DASH }
      if (distanceUnit === 'mi') {
        return {
          value: rideDistanceFromMeters(meters, distanceUnit).toFixed(1),
          unit: rideDistanceUnit(distanceUnit),
        }
      }
      if (meters < 1000) return { value: String(Math.round(meters)), unit: 'm' }
      return { value: (meters / 1000).toFixed(1), unit: 'km' }
    },
    [distanceUnit],
  )
  const formatHistoryMarker = useCallback(
    (selection: SelectedHistoryMarker) =>
      buildHistoryMarkerMessage(selection, distanceUnit, timeFormat, dateFormat),
    [dateFormat, distanceUnit, timeFormat],
  )
  return {
    formatRideTime: formatTime,
    formatRideDate: formatDate,
    formatRideMeta: formatMeta,
    formatRideDetails,
    formatHistoryDistance,
    formatHistoryMarker,
  }
}
