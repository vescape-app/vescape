import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { theme } from '@/constants/theme'
import {
  RidePreviewCard,
  RidePreviewCardSkeleton,
} from '@/modules/history/components/RidePreviewCard'
import { useRideFormat } from '@/modules/history/hooks/useRideFormat'
import { formatRideDate, formatRideTime } from '@/modules/history/lib/rideFormat'
import { isLiveRide, rideMovingWindow, type HistorySession } from '@/modules/history/lib/sessions'

const SKELETON_COUNT = 3

interface RidePreviewStripProps {
  /** How far the strip scrolls past its container's sides, to the screen edge. */
  bleed: number
  children: ReactNode
}

/** Horizontal strip of ride tiles that scrolls out to the screen edge. */
export function RidePreviewStrip({ bleed, children }: RidePreviewStripProps) {
  return (
    <ScrollView
      horizontal
      style={{ marginHorizontal: -bleed }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingHorizontal: bleed }]}
    >
      {children}
    </ScrollView>
  )
}

interface RidePreviewStripSkeletonProps {
  bleed: number
  accessibilityLabel: string
}

/** Loading state of a RidePreviewStrip: pulsing tiles in the same slots. */
export function RidePreviewStripSkeleton({
  bleed,
  accessibilityLabel,
}: RidePreviewStripSkeletonProps) {
  return (
    <View
      style={[styles.list, styles.skeleton, { marginHorizontal: -bleed, paddingHorizontal: bleed }]}
      accessibilityLabel={accessibilityLabel}
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <RidePreviewCardSkeleton key={index} index={index} />
      ))}
    </View>
  )
}

interface RidePreviewCardListProps {
  sessions: HistorySession[]
  onOpenRide: (session: HistorySession) => void
  /** Set on the first card, for tests. */
  firstTestID?: string
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
    <RidePreviewStrip bleed={bleed}>
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
            subtitle={formatRideDetails(window.endMs - window.startMs, session.distanceM)}
            routePoints={session.routePoints}
            color={theme.palette.purple.color}
            weather={session.weather}
            onPress={() => onOpenRide(session)}
          />
        )
      })}
    </RidePreviewStrip>
  )
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  skeleton: { flexDirection: 'row', overflow: 'hidden' },
})
