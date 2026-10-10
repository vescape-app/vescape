import { useCallback } from 'react'
import { DASH } from '@/helpers/format'
import { rideDistanceFromMeters, rideDistanceUnit } from '@/helpers/units'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import {
  buildHistoryMarkerMessage,
  type SelectedHistoryMarker,
} from '@/modules/history/lib/historyMapMarkerInfo'
import { formatRideListDetails } from '@/modules/history/lib/rideFormat'

interface HistoryDistance {
  value: string
  unit?: string
}

/** Bind ride-list presentation to the rider's current units. */
export function useRideFormat() {
  const units = useUnitSystem()
  const formatRideDetails = useCallback(
    (durationMs: number, distanceM: number | null, boardName: string | null) =>
      formatRideListDetails(durationMs, distanceM, boardName, units),
    [units],
  )
  const formatHistoryDistance = useCallback(
    (meters: number | null): HistoryDistance => {
      if (meters == null) return { value: DASH }
      if (units === 'imperial') {
        return {
          value: rideDistanceFromMeters(meters, units).toFixed(1),
          unit: rideDistanceUnit(units),
        }
      }
      if (meters < 1000) return { value: String(Math.round(meters)), unit: 'm' }
      return { value: (meters / 1000).toFixed(1), unit: 'km' }
    },
    [units],
  )
  const formatHistoryMarker = useCallback(
    (selection: SelectedHistoryMarker) => buildHistoryMarkerMessage(selection, units),
    [units],
  )
  return { formatRideDetails, formatHistoryDistance, formatHistoryMarker }
}
