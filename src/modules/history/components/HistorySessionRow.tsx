import { forwardRef } from 'react'
import type { View } from 'react-native'
import type { Favorite } from 'vescape-core'

import { HistoryRideRow } from '@/modules/history/components/HistoryRideRow'
import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { formatFavoriteName, formatRideListDateTime } from '@/modules/history/lib/rideFormat'
import { isLiveRide, rideMovingWindow } from '@/modules/history/lib/sessions'
import type { HistorySession } from '@/modules/history/store/historyStore'

interface HistorySessionRowProps {
  session: HistorySession
  /** The Favorite this session stands for; it is then titled by its name. */
  favorite?: Favorite
  selected?: boolean
  onPress: () => void
  testID?: string
}

/** A History session as a list row, titled and described the same in every ride list. */
export const HistorySessionRow = forwardRef<View, HistorySessionRowProps>(
  function HistorySessionRow({ session, favorite, selected, onPress, testID }, ref) {
    const { formatRideDetails } = useRideFormat()
    const rideWindow = rideMovingWindow(session) ?? {
      startMs: session.startAtMs,
      endMs: session.endAtMs,
    }
    const dateTime = formatRideListDateTime(
      rideWindow.startMs,
      rideWindow.endMs,
      !favorite && isLiveRide(session, Date.now()),
    )
    const details = formatRideDetails(
      rideWindow.endMs - rideWindow.startMs,
      session.distanceM,
      favorite?.boardName ?? session.boardName,
    )
    return (
      <HistoryRideRow
        ref={ref}
        testID={testID}
        title={
          favorite ? formatFavoriteName(favorite.name, favorite.startMs, favorite.endMs) : dateTime
        }
        subtitle={favorite ? dateTime : details}
        details={favorite ? details : undefined}
        routePoints={session.routePoints}
        selected={selected}
        onPress={onPress}
      />
    )
  },
)
