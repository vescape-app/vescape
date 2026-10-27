import { useCallback } from 'react'
import { DASH } from '@/helpers/format'
import { rideDistanceFromMeters, rideDistanceUnit } from '@/helpers/units'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
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
  const distanceUnit = useDistanceUnit()
  const formatRideDetails = useCallback(
    (durationMs: number, distanceM: number | null, boardName: string | null) =>
      formatRideListDetails(durationMs, distanceM, boardName, distanceUnit),
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
    (selection: SelectedHistoryMarker) => buildHistoryMarkerMessage(selection, distanceUnit),
    [distanceUnit],
  )
  return { formatRideDetails, formatHistoryDistance, formatHistoryMarker }
}
