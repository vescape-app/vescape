import { ScrollView, StyleSheet } from 'react-native'

import { theme } from '@/constants/theme'
import { RidePreviewCard } from '@/modules/history/components/RidePreviewCard'
import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { formatRideDate, formatRideTime } from '@/modules/history/lib/rideFormat'
import { isLiveRide, rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'

interface RidePreviewCardListProps {
  sessions: HistorySession[]
  onOpenRide: (session: HistorySession) => void
  /** Set on the first card, for tests. */
  firstTestID?: string
  /** How far the strip scrolls past its container's sides, to the screen edge. */
  bleed: number
}

/** A horizontal strip of ride cards, newest first. */
export function RidePreviewCardList({
  sessions,
  onOpenRide,
  firstTestID,
  bleed,
}: RidePreviewCardListProps) {
  const { formatRideDetails } = useRideFormat()
  return (
    <ScrollView
      horizontal
      style={{ marginHorizontal: -bleed }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingHorizontal: bleed }]}
    >
      {sessions.map((session, index) => {
        const window = rideMovingWindow(session) ?? {
          startMs: session.startAtMs,
          endMs: session.endAtMs,
        }
        return (
          <RidePreviewCard
            key={session.id}
            testID={index === 0 ? firstTestID : undefined}
            title={formatRideTime(window.startMs, window.endMs, isLiveRide(session, Date.now()))}
            date={formatRideDate(window.startMs, window.endMs)}
            subtitle={formatRideDetails(window.endMs - window.startMs, session.distanceM, null)}
            routePoints={session.routePoints}
            color={theme.palette.purple.color}
            weather={session.weather}
            onPress={() => onOpenRide(session)}
          />
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  list: { gap: 10 },
})
