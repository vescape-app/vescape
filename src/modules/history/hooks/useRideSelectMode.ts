import { useMemo, useState } from 'react'
import {
  addRideExportProgressListener,
  countRideHistory,
  exportRides,
  type Favorite,
  type RideExportProgressEvent,
} from 'vescape-core'

import { errorMessage } from '@/helpers/error'
import { useAsyncRead } from '@/hooks/useAsyncRead'
import { toRideHistoryFilter, type RideFilterSelection } from '@/modules/history/lib/rideFilter'
import {
  isRideSelected,
  selectedRideCount,
  toRideSelection,
} from '@/modules/history/lib/rideSelect'
import type { HistorySession } from '@/modules/history/lib/sessions'
import { shareExportFile } from '@/modules/history/lib/shareRideExport'
import { useFavoriteStore } from '@/modules/history/store/favoriteStore'
import { useHistoryStore } from '@/modules/history/store/historyStore'
import { useRideSelectStore } from '@/modules/history/store/rideSelectStore'

interface RideSelectModeOptions {
  favoriteMode: boolean
  /** Rows as listed, after the filter. */
  sessions: HistorySession[]
  favoritesBySessionId: ReadonlyMap<string, Favorite>
  filterSelection: RideFilterSelection
  noun: { one: string; other: string }
}

/**
 * Select mode's counts and actions (#594). "Select all" counts natively, so it covers rides not
 * loaded yet; Favorites are all loaded and count here.
 */
export function useRideSelectMode({
  favoriteMode,
  sessions,
  favoritesBySessionId,
  filterSelection,
  noun,
}: RideSelectModeOptions) {
  const active = useRideSelectStore((state) => state.active)
  const select = useRideSelectStore((state) => state.select)
  const format = useRideSelectStore((state) => state.format)
  const rideFilter = useMemo(() => toRideHistoryFilter(filterSelection), [filterSelection])
  const { value: matchingTotal } = useAsyncRead(
    async () => (!active ? 0 : favoriteMode ? sessions.length : countRideHistory(rideFilter)),
    0,
    `${active}:${favoriteMode}:${favoriteMode ? sessions.length : JSON.stringify(rideFilter)}`,
  )
  const selectedCount = selectedRideCount(select, matchingTotal)
  const [exportProgress, setExportProgress] = useState<RideExportProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rideSelection = () =>
    toRideSelection(select, sessions, favoriteMode ? favoritesBySessionId : null, rideFilter)

  const runExport = async () => {
    setError(null)
    setExportProgress({ done: 0, total: selectedCount })
    const subscription = addRideExportProgressListener(setExportProgress)
    try {
      const file = await exportRides(rideSelection(), format)
      if (file) {
        useRideSelectStore.getState().exit()
        await shareExportFile(file, `Export ${noun.other}`)
      }
    } catch (err) {
      setError(errorMessage(err, `Could not export ${noun.other}`))
    } finally {
      subscription.remove()
      setExportProgress(null)
    }
  }

  const runDelete = async () => {
    setError(null)
    try {
      if (favoriteMode) {
        // Deleting a Favorite keeps its ride.
        for (const session of sessions) {
          const favorite = favoritesBySessionId.get(session.id)
          if (favorite && isRideSelected(select, session.id)) {
            await useFavoriteStore.getState().remove(favorite.id)
          }
        }
      } else await useHistoryStore.getState().removeRides(rideSelection())
      useRideSelectStore.getState().exit()
    } catch (err) {
      setError(errorMessage(err, `Could not delete ${noun.other}`))
    }
  }

  return {
    active,
    select,
    format,
    matchingTotal,
    selectedCount,
    exportProgress,
    error,
    runExport,
    runDelete,
  }
}
